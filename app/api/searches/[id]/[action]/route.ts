import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import { getDb, schema } from "@/lib/db";
import { cancelSearch, startSearch } from "@/lib/search/runner";

type Params = { params: Promise<{ id: string; action: string }> };

async function leadSet(orgId: string, searchId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.leads.id, name: schema.leads.name, city: schema.leads.city })
    .from(schema.leadSources)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.leadSources.leadId))
    .where(and(eq(schema.leadSources.searchId, searchId), eq(schema.leads.orgId, orgId)));
  return new Map(rows.map((r) => [r.id, r]));
}

export const POST = api(async (req, ctx, { params }: Params) => {
  const { id: rawId, action } = await params;
  const id = z.string().uuid().parse(rawId);
  const db = await getDb();
  const [s] = await db.select().from(schema.searches).where(and(eq(schema.searches.id, id), eq(schema.searches.orgId, ctx.orgId)));
  if (!s) return Response.json({ error: "Search not found." }, { status: 404 });

  if (action === "cancel") {
    const ok = await cancelSearch(ctx.orgId, id);
    return { cancelled: ok };
  }
  if (action === "rerun") {
    const rl = rateLimit(`search:${ctx.userId}`, 10, 60_000);
    if (!rl.ok) return Response.json({ error: `Slow down — try again in ${rl.retryAfterSec}s.` }, { status: 429 });
    const newId = await startSearch(ctx.orgId, ctx.userId, s.config);
    return { id: newId };
  }
  if (action === "compare") {
    // Compare which businesses each run touched: what's new vs. the other run, what dropped out.
    const withId = z.string().uuid().parse((await req.json()).with);
    const [other] = await db.select({ id: schema.searches.id }).from(schema.searches).where(and(eq(schema.searches.id, withId), eq(schema.searches.orgId, ctx.orgId)));
    if (!other) return Response.json({ error: "Comparison search not found." }, { status: 404 });
    const [a, b] = await Promise.all([leadSet(ctx.orgId, id), leadSet(ctx.orgId, withId)]);
    const onlyA = [...a.values()].filter((x) => !b.has(x.id));
    const onlyB = [...b.values()].filter((x) => !a.has(x.id));
    return { newInThis: onlyA.slice(0, 200), missingFromThis: onlyB.slice(0, 200), common: [...a.keys()].filter((k) => b.has(k)).length, totals: { this: a.size, other: b.size } };
  }
  return Response.json({ error: "Unknown action." }, { status: 404 });
});

