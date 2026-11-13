import { desc, eq } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getDb, schema } from "@/lib/db";
import { recoverOrphanedSearches, startSearch } from "@/lib/search/runner";

export const GET = api(async (req, ctx) => {
  await recoverOrphanedSearches();
  const db = await getDb();
  const saved = new URL(req.url).searchParams.get("saved") === "1";
  const rows = await db.select().from(schema.searches).where(eq(schema.searches.orgId, ctx.orgId)).orderBy(desc(schema.searches.createdAt)).limit(200);
  return { searches: saved ? rows.filter((r) => r.saved) : rows };
});

export const POST = api(async (req, ctx) => {
  const rl = rateLimit(`search:${ctx.userId}`, 10, 60_000);
  if (!rl.ok) return Response.json({ error: `Slow down — try again in ${rl.retryAfterSec}s.` }, { status: 429 });
  const body = await req.json();
  const id = await startSearch(ctx.orgId, ctx.userId, body);
  return { id };
});
