import "server-only";
import { and, asc, desc, eq, exists, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db";

const { leads, leadSources, listItems } = schema;

const csv = (v: unknown) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
const bool = (v: unknown) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : undefined);

/** Query-string friendly filter schema shared by the lead table, exports and bulk actions. */
export const leadFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.preprocess(csv, z.array(z.string()).optional()),
  niche: z.preprocess(csv, z.array(z.string()).optional()),
  classification: z.preprocess(csv, z.array(z.string()).optional()),
  verification: z.preprocess(csv, z.array(z.string()).optional()),
  tag: z.string().max(60).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(2).optional(),
  source: z.string().max(40).optional(),
  opportunity: z.string().max(40).optional(),
  searchId: z.string().uuid().optional(),
  listId: z.string().uuid().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  hasEmail: z.preprocess(bool, z.boolean().optional()),
  hasPhone: z.preprocess(bool, z.boolean().optional()),
  hasWebsite: z.preprocess(bool, z.boolean().optional()),
  ids: z.preprocess(csv, z.array(z.string().uuid()).max(5000).optional()),
});
export type LeadFilter = z.infer<typeof leadFilterSchema>;

export const leadPageSchema = z.object({
  sort: z.enum(["score", "name", "created", "rating", "city", "status"]).default("score"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export function leadWhere(orgId: string, f: LeadFilter): SQL {
  const c: (SQL | undefined)[] = [eq(leads.orgId, orgId)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "\\$&")}%`;
    c.push(or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.website, like), ilike(leads.city, like), ilike(leads.phone, like)));
  }
  if (f.status?.length) c.push(inArray(leads.status, f.status));
  if (f.niche?.length) c.push(inArray(leads.nicheId, f.niche));
  if (f.classification?.length) c.push(inArray(leads.classification, f.classification));
  if (f.verification?.length) c.push(inArray(leads.verificationStatus, f.verification));
  if (f.tag) c.push(sql`${f.tag} = ANY(${leads.tags})`);
  if (f.city) c.push(ilike(leads.city, f.city));
  if (f.country) c.push(eq(leads.country, f.country.toUpperCase()));
  if (f.searchId) c.push(eq(leads.searchId, f.searchId));
  if (f.minScore != null) c.push(gte(leads.score, f.minScore));
  if (f.hasEmail != null) c.push(f.hasEmail ? sql`${leads.email} is not null and ${leads.email} <> ''` : sql`(${leads.email} is null or ${leads.email} = '')`);
  if (f.hasPhone != null) c.push(f.hasPhone ? sql`${leads.phone} is not null and ${leads.phone} <> ''` : sql`(${leads.phone} is null or ${leads.phone} = '')`);
  if (f.hasWebsite != null) c.push(f.hasWebsite ? sql`${leads.website} is not null and ${leads.website} <> ''` : sql`(${leads.website} is null or ${leads.website} = '')`);
  if (f.opportunity) c.push(sql`${leads.opportunities} @> ${JSON.stringify([{ key: f.opportunity }])}::jsonb`);
  if (f.source) {
    c.push(exists(sql`(select 1 from ${leadSources} where ${leadSources.leadId} = ${leads.id} and ${leadSources.source} = ${f.source})`));
  }
  if (f.listId) c.push(exists(sql`(select 1 from ${listItems} where ${listItems.leadId} = ${leads.id} and ${listItems.listId} = ${f.listId})`));
  if (f.ids?.length) c.push(inArray(leads.id, f.ids));
  return and(...c.filter((x): x is SQL => !!x))!;
}

const SORTS = { score: leads.score, name: leads.nameNorm, created: leads.createdAt, rating: leads.rating, city: leads.city, status: leads.status } as const;

export async function listLeads(orgId: string, f: LeadFilter, p: z.infer<typeof leadPageSchema>) {
  const db = await getDb();
  const where = leadWhere(orgId, f);
  const col = SORTS[p.sort];
  const order = p.dir === "asc" ? [asc(col), asc(leads.id)] : [sql`${col} desc nulls last`, desc(leads.id)];
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(leads).where(where).orderBy(...order).limit(p.pageSize).offset((p.page - 1) * p.pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where),
  ]);
  return { rows, total: n, page: p.page, pageSize: p.pageSize };
}
