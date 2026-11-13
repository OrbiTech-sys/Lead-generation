import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";

const { leadActivities, leads, users } = schema;

/** Outreach tracker: recent outreach activity, call outcomes and leads due for follow-up. */
export const GET = api(async (req, ctx) => {
  const type = new URL(req.url).searchParams.get("type");
  const db = await getDb();
  const outreachTypes = ["call", "email", "sms", "meeting"];
  const recent = await db
    .select({ id: leadActivities.id, leadId: leadActivities.leadId, leadName: leads.name, type: leadActivities.type, body: leadActivities.body, outcome: leadActivities.outcome, followUpAt: leadActivities.followUpAt, createdAt: leadActivities.createdAt, userName: users.name })
    .from(leadActivities)
    .innerJoin(leads, eq(leads.id, leadActivities.leadId))
    .leftJoin(users, eq(users.id, leadActivities.userId))
    .where(and(eq(leadActivities.orgId, ctx.orgId), type && outreachTypes.includes(type) ? eq(leadActivities.type, type) : inArray(leadActivities.type, outreachTypes)))
    .orderBy(desc(leadActivities.createdAt))
    .limit(100);
  const followUps = await db
    .select({ id: leads.id, name: leads.name, followUpAt: leads.followUpAt, status: leads.status, phone: leads.phone, email: leads.email })
    .from(leads)
    .where(and(eq(leads.orgId, ctx.orgId), sql`${leads.followUpAt} is not null`, sql`${leads.status} not in ('converted','not_interested')`))
    .orderBy(asc(leads.followUpAt))
    .limit(100);
  const outcomes = await db
    .select({ outcome: sql<string>`coalesce(${leadActivities.outcome}, 'none recorded')`, n: sql<number>`count(*)::int` })
    .from(leadActivities)
    .where(and(eq(leadActivities.orgId, ctx.orgId), inArray(leadActivities.type, outreachTypes)))
    .groupBy(sql`1`);
  return { recent, followUps, outcomes };
});
