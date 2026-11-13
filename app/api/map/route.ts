import { and, desc, sql } from "drizzle-orm";
import { api } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { leadFilterSchema, leadWhere } from "@/lib/services/leads";

const { leads } = schema;

/** Lean point set for the map + a simple density grid for cluster / coverage analysis. */
export const GET = api(async (req, ctx) => {
  const filter = leadFilterSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const db = await getDb();
  const where = and(leadWhere(ctx.orgId, filter), sql`${leads.lat} is not null and ${leads.lng} is not null`);
  const points = await db
    .select({ id: leads.id, name: leads.name, lat: leads.lat, lng: leads.lng, score: leads.score, classification: leads.classification, subcategory: leads.subcategory, status: leads.status, website: leads.website, phone: leads.phone })
    .from(leads)
    .where(where)
    .orderBy(desc(leads.score))
    .limit(5000);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(leadWhere(ctx.orgId, filter));
  return { points, total: n, withoutCoordinates: n - points.length, tiles: "© OpenStreetMap contributors" };
});

