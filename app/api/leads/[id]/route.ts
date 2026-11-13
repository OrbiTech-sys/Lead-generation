import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";

const { leads, leadSources, leadActivities, listItems, lists, pipelineStages, users } = schema;
type Params = { params: Promise<{ id: string }> };
const idOf = async (p: Params["params"]) => z.string().uuid().parse((await p).id);

export const GET = api(async (_req, ctx, { params }: Params) => {
  const id = await idOf(params);
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });
  const [sources, activities, memberOf] = await Promise.all([
    db.select({ id: leadSources.id, source: leadSources.source, sourceUrl: leadSources.sourceUrl, sourceRecordId: leadSources.sourceRecordId, collectedAt: leadSources.collectedAt }).from(leadSources).where(eq(leadSources.leadId, id)).orderBy(asc(leadSources.collectedAt)),
    db.select({ id: leadActivities.id, type: leadActivities.type, body: leadActivities.body, outcome: leadActivities.outcome, followUpAt: leadActivities.followUpAt, createdAt: leadActivities.createdAt, userName: users.name }).from(leadActivities).leftJoin(users, eq(users.id, leadActivities.userId)).where(eq(leadActivities.leadId, id)).orderBy(desc(leadActivities.createdAt)).limit(100),
    db.select({ id: lists.id, name: lists.name }).from(listItems).innerJoin(lists, eq(lists.id, listItems.listId)).where(eq(listItems.leadId, id)),
  ]);
  return { lead, sources, activities, lists: memberOf };
});

const patchSchema = z.object({
  status: z.string().max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  contactPosition: z.string().trim().max(120).nullable().optional(),
  doNotContact: z.boolean().optional(),
});

export const PATCH = api(async (req, ctx, { params }: Params) => {
  const id = await idOf(params);
  const body = patchSchema.parse(await req.json());
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  if (!lead) return Response.json({ error: "Lead not found." }, { status: 404 });
  if (body.status) {
    const [st] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.orgId, ctx.orgId), eq(pipelineStages.key, body.status)));
    if (!st) return Response.json({ error: "Unknown pipeline stage." }, { status: 400 });
  }
  if (body.assignedTo) {
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, ctx.orgId), eq(schema.memberships.userId, body.assignedTo)));
    if (!m) return Response.json({ error: "Assignee is not a member of this workspace." }, { status: 400 });
  }
  const { followUpAt, ...rest } = body;
  await db.update(leads).set({ ...rest, ...(followUpAt !== undefined ? { followUpAt: followUpAt ? new Date(followUpAt) : null } : {}), updatedAt: new Date() }).where(eq(leads.id, id));
  if (body.status && body.status !== lead.status) {
    await db.insert(leadActivities).values({ leadId: id, orgId: ctx.orgId, userId: ctx.userId, type: "status_change", body: `${lead.status} → ${body.status}` });
  }
  return { ok: true };
});

export const DELETE = api(async (_req, ctx, { params }: Params) => {
  const id = await idOf(params);
  const db = await getDb();
  await db.delete(leads).where(and(eq(leads.id, id), eq(leads.orgId, ctx.orgId)));
  await db.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "lead.delete", detail: { id } });
  return { ok: true };
});
