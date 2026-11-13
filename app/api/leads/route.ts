import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { leadFilterSchema, leadPageSchema, listLeads } from "@/lib/services/leads";

const { leads, leadActivities, listItems, lists, pipelineStages, auditLogs } = schema;

export const GET = api(async (req, ctx) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const filter = leadFilterSchema.parse(params);
  const page = leadPageSchema.parse(params);
  const res = await listLeads(ctx.orgId, filter, page);
  return {
    ...res,
    rows: res.rows.map((l) => ({
      id: l.id, name: l.name, industry: l.industry, subcategory: l.subcategory, nicheId: l.nicheId, country: l.country, state: l.state, city: l.city, address: l.address,
      phone: l.phone, phoneStatus: l.phoneStatus, email: l.email, emailStatus: l.emailStatus, website: l.website, websiteStatus: l.websiteStatus, mapsUrl: l.mapsUrl,
      rating: l.rating, reviewCount: l.reviewCount, score: l.score, classification: l.classification, verificationStatus: l.verificationStatus,
      status: l.status, tags: l.tags, sourcePrimary: l.sourcePrimary, sourceCount: l.sourceCount, lat: l.lat, lng: l.lng,
      opportunities: l.opportunities, doNotContact: l.doNotContact, followUpAt: l.followUpAt, createdAt: l.createdAt, lastVerifiedAt: l.lastVerifiedAt,
    })),
  };
});

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
  set: z
    .object({
      status: z.string().max(40).optional(),
      assignedTo: z.string().uuid().nullable().optional(),
      doNotContact: z.boolean().optional(),
    })
    .optional(),
  addTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  removeTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  addToList: z.string().uuid().optional(),
});

export const PATCH = api(async (req, ctx) => {
  const b = bulkSchema.parse(await req.json());
  const db = await getDb();
  const owned = await db.select({ id: leads.id, status: leads.status }).from(leads).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, b.ids)));
  const ids = owned.map((o) => o.id);
  if (!ids.length) return { updated: 0 };

  if (b.set?.status) {
    const [stage] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.orgId, ctx.orgId), eq(pipelineStages.key, b.set.status)));
    if (!stage) return Response.json({ error: "Unknown pipeline stage." }, { status: 400 });
  }
  if (b.set?.assignedTo) {
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, ctx.orgId), eq(schema.memberships.userId, b.set.assignedTo)));
    if (!m) return Response.json({ error: "Assignee is not a member of this workspace." }, { status: 400 });
  }
  const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (b.set?.status) patch.status = b.set.status;
  if (b.set && "assignedTo" in b.set) patch.assignedTo = b.set.assignedTo ?? null;
  if (b.set?.doNotContact !== undefined) patch.doNotContact = b.set.doNotContact;
  await db.update(leads).set(patch).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, ids)));

  if (b.addTags?.length) await db.update(leads).set({ tags: sql`(select array(select distinct unnest(${leads.tags} || ${b.addTags}::text[])))` }).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, ids)));
  if (b.removeTags?.length) await db.update(leads).set({ tags: sql`(select coalesce(array(select t from unnest(${leads.tags}) t where t <> all(${b.removeTags}::text[])), '{}'))` }).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, ids)));
  if (b.addToList) {
    const [l] = await db.select().from(lists).where(and(eq(lists.id, b.addToList), eq(lists.orgId, ctx.orgId)));
    if (!l) return Response.json({ error: "List not found." }, { status: 404 });
    await db.insert(listItems).values(ids.map((leadId) => ({ listId: l.id, leadId }))).onConflictDoNothing();
  }
  if (b.set?.status) {
    const changed = owned.filter((o) => o.status !== b.set!.status);
    if (changed.length) {
      await db.insert(leadActivities).values(changed.map((o) => ({ leadId: o.id, orgId: ctx.orgId, userId: ctx.userId, type: "status_change", body: `${o.status} → ${b.set!.status}` })));
    }
  }
  return { updated: ids.length };
});

export const DELETE = api(async (req, ctx) => {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000) }).parse(await req.json());
  const db = await getDb();
  const res = await db.delete(leads).where(and(eq(leads.orgId, ctx.orgId), inArray(leads.id, b.ids))).returning({ id: leads.id });
  await db.insert(auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "leads.delete", detail: { count: res.length } });
  return { deleted: res.length };
});

