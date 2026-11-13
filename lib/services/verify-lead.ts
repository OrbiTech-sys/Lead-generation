import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { auditWebsite, domainOf } from "../enrich/website-audit";
import { checkEmail } from "../verify/email";
import { checkPhone } from "../verify/phone";
import { intelligenceFor, rowToFacts } from "../search/facts";

const { leads, leadSources, organizations } = schema;

/** Re-run phone/email/website verification for one lead and refresh its score. Returns what changed. */
export async function reverifyLead(orgId: string, leadId: string) {
  const db = await getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
  if (!lead) throw new Error("Lead not found.");

  const patch: Partial<typeof leads.$inferInsert> = {};
  const ph = checkPhone(lead.phone, lead.country ?? undefined);
  if (ph) Object.assign(patch, { phone: ph.international ?? lead.phone, phoneE164: ph.status === "invalid" ? null : ph.e164 ?? null, phoneType: ph.type ?? null, phoneStatus: ph.status });
  const em = lead.email ? await checkEmail(lead.email) : null;
  if (em) patch.emailStatus = em.status;
  if (lead.website) {
    const audit = await auditWebsite(lead.website);
    patch.websiteAudit = audit;
    patch.websiteDomain = domainOf(lead.website);
    patch.websiteStatus = audit.reachable === "detected" ? "reachable" : audit.reachable === "verified_absent" ? "unreachable" : "unknown";
  }
  const merged = { ...lead, ...patch };
  const srcs = await db.select({ s: leadSources.source }).from(leadSources).where(eq(leadSources.leadId, leadId));
  const sources = [...new Set(srcs.map((x) => x.s))];
  if (patch.websiteAudit && (patch.websiteAudit as { reachable: string }).reachable === "detected" && !sources.includes("website")) sources.push("website");
  const [org] = await db.select({ w: organizations.scoringWeights }).from(organizations).where(eq(organizations.id, orgId));
  const intel = intelligenceFor(rowToFacts(merged, sources), org?.w as never);
  await db.update(leads).set({ ...patch, ...intel, lastVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, leadId));
  return { phone: ph?.status ?? null, email: em?.status ?? null, website: patch.websiteStatus ?? null, score: intel.score };
}

/** Recompute scores for every lead in the org (after the weights change). */
export async function rescoreAll(orgId: string): Promise<number> {
  const db = await getDb();
  const [org] = await db.select({ w: organizations.scoringWeights }).from(organizations).where(eq(organizations.id, orgId));
  const rows = await db.select().from(leads).where(eq(leads.orgId, orgId));
  const srcs = await db.select({ leadId: leadSources.leadId, s: leadSources.source }).from(leadSources).innerJoin(leads, eq(leads.id, leadSources.leadId)).where(eq(leads.orgId, orgId));
  const byLead = new Map<string, Set<string>>();
  for (const s of srcs) (byLead.get(s.leadId) ?? byLead.set(s.leadId, new Set()).get(s.leadId)!).add(s.s);
  for (const l of rows) {
    const intel = intelligenceFor(rowToFacts(l, [...(byLead.get(l.id) ?? [l.sourcePrimary])]), org?.w as never);
    await db.update(leads).set(intel).where(eq(leads.id, l.id));
  }
  return rows.length;
}
