import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";

const { lists, listItems } = schema;

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const rows = await db
    .select({ id: lists.id, name: lists.name, description: lists.description, createdAt: lists.createdAt, count: sql<number>`count(${listItems.leadId})::int` })
    .from(lists)
    .leftJoin(listItems, eq(listItems.listId, lists.id))
    .where(eq(lists.orgId, ctx.orgId))
    .groupBy(lists.id)
    .orderBy(desc(lists.createdAt));
  return { lists: rows };
});

export const POST = api(async (req, ctx) => {
  const b = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(300).optional() }).parse(await req.json());
  const db = await getDb();
  const [l] = await db.insert(lists).values({ orgId: ctx.orgId, name: b.name, description: b.description ?? null }).returning();
  return { list: l };
});

export const DELETE = api(async (req, ctx) => {
  const b = z.object({ id: z.string().uuid() }).parse(await req.json());
  const db = await getDb();
  await db.delete(lists).where(and(eq(lists.id, b.id), eq(lists.orgId, ctx.orgId)));
  return { ok: true };
}, { role: "admin" });

export const PATCH = api(async (req, ctx) => {
  // remove leads from a list
  const b = z.object({ id: z.string().uuid(), removeLeadIds: z.array(z.string().uuid()).max(5000) }).parse(await req.json());
  const db = await getDb();
  const [l] = await db.select().from(lists).where(and(eq(lists.id, b.id), eq(lists.orgId, ctx.orgId)));
  if (!l) return Response.json({ error: "List not found." }, { status: 404 });
  for (const leadId of b.removeLeadIds) await db.delete(listItems).where(and(eq(listItems.listId, b.id), eq(listItems.leadId, leadId)));
  return { ok: true };
});
