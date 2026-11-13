import type { WebsiteAudit } from "../enrich/website-audit";
import { detectOpportunities } from "../scoring/opportunities";
import { scoreLead, verificationStatus } from "../scoring/score";
import type { LeadFacts, ScoreWeights } from "../scoring/types";
import { getNiche } from "../taxonomy/niches";
import type { leads } from "../db/schema";

export type LeadRow = typeof leads.$inferSelect;

/** Build scoring inputs from a stored lead plus the distinct sources that back it. */
export function rowToFacts(row: Partial<LeadRow> & { name: string }, sources: string[]): LeadFacts {
  const niche = row.nicheId ? getNiche(row.nicheId) : undefined;
  return {
    name: row.name,
    nicheBook: niche?.book,
    nicheOrder: niche?.order,
    matchBasis: (row.matchBasis as LeadFacts["matchBasis"]) ?? undefined,
    address: row.address,
    city: row.city,
    phone: row.phone,
    phoneStatus: row.phoneStatus,
    email: row.email,
    emailStatus: row.emailStatus,
    website: row.website,
    websiteAudit: (row.websiteAudit as WebsiteAudit | null) ?? null,
    facebook: row.facebook,
    instagram: row.instagram,
    linkedin: row.linkedin,
    contactPerson: row.contactPerson,
    openingHours: row.openingHours,
    businessStatus: row.businessStatus,
    rating: row.rating,
    reviewCount: row.reviewCount,
    sources,
    // Source data age only. "Collected just now" is not evidence the data is fresh.
    dataTimestamp: row.sourceDataAt ?? null,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

/** Recompute opportunities, score, classification and verification status for a lead. */
export function intelligenceFor(facts: LeadFacts, weights?: Partial<ScoreWeights> | null) {
  const opportunities = detectOpportunities(facts);
  const score = scoreLead(facts, weights, opportunities);
  return {
    opportunities,
    score: score.total,
    scoreBreakdown: score,
    classification: score.classification,
    verificationStatus: verificationStatus(facts),
  };
}
