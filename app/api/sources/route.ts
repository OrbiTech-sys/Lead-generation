import { and, eq, gte, sql } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { DISCOVERY_CONNECTORS, PLANNED_CONNECTORS, WEBSITE_ENRICHER_INFO } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";

export const GET = api(async (_req, ctx) => {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const usage = await db
    .select({ provider: schema.apiUsage.provider, requests: sql<number>`sum(${schema.apiUsage.requests})::int`, errors: sql<number>`sum(${schema.apiUsage.errors})::int` })
    .from(schema.apiUsage)
    .where(and(eq(schema.apiUsage.orgId, ctx.orgId), gte(schema.apiUsage.day, since)))
    .groupBy(schema.apiUsage.provider);
  const u = new Map(usage.map((x) => [x.provider, x]));
  const leadsBySource = await db.select({ k: schema.leadSources.source, n: sql<number>`count(distinct ${schema.leadSources.leadId})::int` }).from(schema.leadSources).innerJoin(schema.leads, eq(schema.leads.id, schema.leadSources.leadId)).where(eq(schema.leads.orgId, ctx.orgId)).groupBy(schema.leadSources.source);
  const nBy = new Map(leadsBySource.map((x) => [x.k, x.n]));
  return {
    connectors: [
      ...DISCOVERY_CONNECTORS.map((c) => ({ ...c.info, configured: c.isConfigured(), setupMessage: c.setupMessage(), usage30d: u.get(c.info.id) ?? { requests: 0, errors: 0 }, leads: nBy.get(c.info.id) ?? 0 })),
      { ...WEBSITE_ENRICHER_INFO, configured: true, setupMessage: null, usage30d: { requests: 0, errors: 0 }, leads: nBy.get("website") ?? 0 },
      ...PLANNED_CONNECTORS.map((c) => ({ ...c, configured: false, setupMessage: "Not implemented yet.", usage30d: { requests: 0, errors: 0 }, leads: 0 })),
    ],
  };
});
