import { and, desc, eq, gte, sql } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { DISCOVERY_CONNECTORS } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";

const { leads, searches, mergeCandidates, apiUsage, leadActivities } = schema;

// Every number returned here is computed from this organization's stored data. Nothing is estimated or seeded.
export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const org = eq(leads.orgId, ctx.orgId);
  const count = sql<number>`count(*)::int`;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000);

  const rows = async <T,>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;

  const [
    [totals], byClass, byStatus, byVerification, byNiche, byCountry, byCity, bySource, recent, searchActivity, dupRow, pendingReview, usage, followUps, scoreBuckets, opps, phoneS, emailS, activity30,
  ] = await Promise.all([
    db.select({
      total: count,
      verified: sql<number>`count(*) filter (where ${leads.verificationStatus} = 'verified')::int`,
      partial: sql<number>`count(*) filter (where ${leads.verificationStatus} = 'partial')::int`,
      highPriority: sql<number>`count(*) filter (where ${leads.classification} = 'high_priority')::int`,
      newThisWeek: sql<number>`count(*) filter (where ${leads.createdAt} >= ${weekAgo})::int`,
      avgScore: sql<number>`coalesce(round(avg(${leads.score})), 0)::int`,
      withEmail: sql<number>`count(*) filter (where ${leads.email} is not null and ${leads.email} <> '')::int`,
      withPhone: sql<number>`count(*) filter (where ${leads.phone} is not null and ${leads.phone} <> '')::int`,
      withWebsite: sql<number>`count(*) filter (where ${leads.website} is not null and ${leads.website} <> '')::int`,
    }).from(leads).where(org),
    db.select({ k: leads.classification, n: count }).from(leads).where(org).groupBy(leads.classification),
    db.select({ k: leads.status, n: count }).from(leads).where(org).groupBy(leads.status),
    db.select({ k: leads.verificationStatus, n: count }).from(leads).where(org).groupBy(leads.verificationStatus),
    db.select({ k: sql<string>`coalesce(${leads.subcategory}, 'Unknown')`, n: count }).from(leads).where(org).groupBy(leads.subcategory).orderBy(desc(count)).limit(10),
    db.select({ k: sql<string>`coalesce(${leads.country}, 'Unknown')`, n: count }).from(leads).where(org).groupBy(leads.country).orderBy(desc(count)).limit(10),
    db.select({ k: sql<string>`coalesce(${leads.city}, 'Unknown')`, n: count }).from(leads).where(org).groupBy(leads.city).orderBy(desc(count)).limit(10),
    db.select({ k: leads.sourcePrimary, n: count }).from(leads).where(org).groupBy(leads.sourcePrimary).orderBy(desc(count)),
    db.select().from(searches).where(eq(searches.orgId, ctx.orgId)).orderBy(desc(searches.createdAt)).limit(6),
    db.select({ day: sql<string>`to_char(${searches.createdAt}, 'YYYY-MM-DD')`, n: count }).from(searches).where(and(eq(searches.orgId, ctx.orgId), gte(searches.createdAt, twoWeeksAgo))).groupBy(sql`1`).orderBy(sql`1`),
    db.select({ n: sql<number>`coalesce(sum((${searches.stats}->>'duplicatesMerged')::int), 0)::int` }).from(searches).where(eq(searches.orgId, ctx.orgId)),
    db.select({ n: count }).from(mergeCandidates).where(and(eq(mergeCandidates.orgId, ctx.orgId), eq(mergeCandidates.status, "pending"))),
    db.select().from(apiUsage).where(eq(apiUsage.orgId, ctx.orgId)).orderBy(desc(apiUsage.day)).limit(60),
    db.select({ n: count }).from(leads).where(and(org, sql`${leads.followUpAt} is not null and ${leads.followUpAt} <= now()`, sql`${leads.status} not in ('converted','not_interested')`)),
    rows<{ b: number; n: number }>(sql`select (least(${leads.score}, 99) / 10)::int as b, count(*)::int as n from ${leads} where ${leads.orgId} = ${ctx.orgId} group by 1 order by 1`),
    rows<{ key: string; label: string; n: number }>(sql`select o->>'key' as key, max(o->>'label') as label, count(*)::int as n from ${leads}, jsonb_array_elements(${leads.opportunities}) o where ${leads.orgId} = ${ctx.orgId} group by 1 order by 3 desc`),
    db.select({ k: leads.phoneStatus, n: count }).from(leads).where(org).groupBy(leads.phoneStatus),
    db.select({ k: leads.emailStatus, n: count }).from(leads).where(org).groupBy(leads.emailStatus),
    db.select({ day: sql<string>`to_char(${leadActivities.createdAt}, 'YYYY-MM-DD')`, n: count }).from(leadActivities).where(and(eq(leadActivities.orgId, ctx.orgId), gte(leadActivities.createdAt, new Date(Date.now() - 30 * 86_400_000)))).groupBy(sql`1`).orderBy(sql`1`),
  ]);

  return {
    totals,
    duplicatesPrevented: dupRow[0]?.n ?? 0,
    pendingReview: pendingReview[0]?.n ?? 0,
    followUpsDue: followUps[0]?.n ?? 0,
    sources: { available: DISCOVERY_CONNECTORS.filter((c) => c.isConfigured()).length, total: DISCOVERY_CONNECTORS.length },
    byClass, byStatus, byVerification, byNiche, byCountry, byCity, bySource, scoreBuckets, opportunities: opps, phoneStatus: phoneS, emailStatus: emailS,
    searchActivity, recentSearches: recent.map((s) => ({ id: s.id, name: s.name, status: s.status, createdAt: s.createdAt, stats: s.stats })),
    apiUsage: usage, activity30,
  };
});
