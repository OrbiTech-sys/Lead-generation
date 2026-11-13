import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";

const { savedNiches } = schema;

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  return { saved: await db.select().from(savedNiches).where(eq(savedNiches.orgId, ctx.orgId)).orderBy(desc(savedNiches.createdAt)).limit(50) };
});

export const POST = api(async (req, ctx) => {
  const b = z.object({ name: z.string().trim().min(1).max(80), nicheIds: z.array(z.string().max(120)).min(1).max(25) }).parse(await req.json());
  const db = await getDb();
  const [row] = await db.insert(savedNiches).values({ orgId: ctx.orgId, name: b.name, nicheIds: b.nicheIds }).returning();
  return { saved: row };
});

export const DELETE = api(async (req, ctx) => {
  const b = z.object({ id: z.string().uuid() }).parse(await req.json());
  const db = await getDb();
  await db.delete(savedNiches).where(and(eq(savedNiches.id, b.id), eq(savedNiches.orgId, ctx.orgId)));
  return { ok: true };
});
