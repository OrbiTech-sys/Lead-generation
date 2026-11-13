import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

export const GET = api(async (_req, ctx, { params }: Params) => {
  const id = idSchema.parse((await params).id);
  const db = await getDb();
  const [s] = await db.select().from(schema.searches).where(and(eq(schema.searches.id, id), eq(schema.searches.orgId, ctx.orgId)));
  if (!s) return Response.json({ error: "Search not found." }, { status: 404 });
  const events = await db.select().from(schema.searchEvents).where(eq(schema.searchEvents.searchId, id)).orderBy(desc(schema.searchEvents.createdAt)).limit(200);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(and(eq(schema.leads.orgId, ctx.orgId), eq(schema.leads.searchId, id)));
  return { search: s, events: events.reverse(), leadCount: n };
});

const patchSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), saved: z.boolean().optional() });
export const PATCH = api(async (req, ctx, { params }: Params) => {
  const id = idSchema.parse((await params).id);
  const body = patchSchema.parse(await req.json());
  const db = await getDb();
  const res = await db.update(schema.searches).set(body).where(and(eq(schema.searches.id, id), eq(schema.searches.orgId, ctx.orgId))).returning({ id: schema.searches.id });
  if (!res.length) return Response.json({ error: "Search not found." }, { status: 404 });
  return { ok: true };
});

export const DELETE = api(async (_req, ctx, { params }: Params) => {
  const id = idSchema.parse((await params).id);
  const db = await getDb();
  await db.delete(schema.searches).where(and(eq(schema.searches.id, id), eq(schema.searches.orgId, ctx.orgId)));
  await db.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "search.delete", detail: { id } });
  return { ok: true };
}, { role: "admin" });

