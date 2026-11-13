import { and, desc, eq } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import type { HistoricalSample } from "@/lib/geo/recommend";
import { searchConfigSchema } from "@/lib/search/config";
import { adviseSearch } from "@/lib/search/advisor";
import { DISCOVERY_CONNECTORS } from "@/lib/connectors/registry";

export const POST = api(async (req, ctx) => {
  const cfg = searchConfigSchema.partial({ sources: true }).parse(await req.json());
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.searches)
    .where(and(eq(schema.searches.orgId, ctx.orgId), eq(schema.searches.status, "completed")))
    .orderBy(desc(schema.searches.createdAt))
    .limit(100);
  const wanted = new Set([...cfg.nicheIds]);
  // Only searches covering the same niche(s) inform the volume estimate.
  const history: HistoricalSample[] = rows
    .filter((r) => {
      const c = r.config as { nicheIds?: string[] };
      return c.nicheIds?.length && c.nicheIds.every((id) => wanted.has(id)) && wanted.size > 0;
    })
    .map((r) => {
      const s = r.stats as { newLeads?: number; updatedExisting?: number; radiusKmUsed?: number };
      return { nicheIds: (r.config as { nicheIds: string[] }).nicheIds, radiusKm: s.radiusKmUsed ?? 0, leads: (s.newLeads ?? 0) + (s.updatedExisting ?? 0) };
    });
  const report = adviseSearch({ ...cfg, sources: cfg.sources ?? [] }, history);
  return { ...report, sources: DISCOVERY_CONNECTORS.map((c) => ({ id: c.info.id, configured: c.isConfigured() })) };
});
