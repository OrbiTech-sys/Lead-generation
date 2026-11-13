import { detectOpportunities, CERTAINTY_WEIGHT } from "./opportunities";
import { DEFAULT_WEIGHTS, type Classification, type LeadFacts, type Opportunity, type ScoreComponent, type ScoreResult, type ScoreWeights } from "./types";

/** Reliability of each source's data (0..1). Heuristic, documented, and editable. */
export const SOURCE_RELIABILITY: Record<string, number> = {
  google_places: 0.95,
  website: 0.85,
  bbb: 0.85,
  foursquare: 0.8,
  yelp: 0.8,
  osm: 0.7,
  user_import: 0.6,
};

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Normalise arbitrary weights so they always sum to 100. */
export function normalizeWeights(w: Partial<ScoreWeights> | null | undefined): ScoreWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(w ?? {}) };
  const keys = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[];
  const sum = keys.reduce((s, k) => s + Math.max(0, Number(merged[k]) || 0), 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  const out = {} as ScoreWeights;
  for (const k of keys) out[k] = (Math.max(0, Number(merged[k]) || 0) / sum) * 100;
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function verificationStatus(f: LeadFacts): "verified" | "partial" | "unverified" {
  const checks = [
    f.phoneStatus === "valid_format",
    f.emailStatus === "domain_verified",
    f.websiteAudit?.reachable === "detected",
    new Set(f.sources).size >= 2,
  ].filter(Boolean).length;
  return checks >= 3 ? "verified" : checks >= 1 ? "partial" : "unverified";
}

export function scoreLead(
  f: LeadFacts,
  weights?: Partial<ScoreWeights> | null,
  opportunities?: Opportunity[],
  now = new Date(),
): ScoreResult {
  const W = normalizeWeights(weights);
  const opps = opportunities ?? detectOpportunities(f, now);
  const comps: ScoreComponent[] = [];
  const add = (key: ScoreComponent["key"], label: string, frac: number, reasons: string[]) =>
    comps.push({ key, label, max: round1(W[key]), points: round1(clamp(frac) * W[key]), reasons });

  // 1. Contact completeness
  {
    let s = 0;
    const r: string[] = [];
    if (f.phoneStatus === "valid_format") { s += 0.3; r.push("Valid-format phone (+30%)"); }
    else if (f.phoneStatus === "possible") { s += 0.15; r.push("Phone present, format only plausible (+15%)"); }
    else if (f.phone) r.push("Phone present but invalid (0%)");
    else r.push("No public phone found");
    if (f.emailStatus === "domain_verified") { s += 0.3; r.push("Email with verified domain (+30%)"); }
    else if (f.emailStatus === "valid_format" || f.emailStatus === "uncertain") { s += 0.15; r.push("Email present, deliverability uncertain (+15%)"); }
    else if (f.email) r.push("Email present but invalid (0%)");
    else r.push("No public email found");
    if (f.websiteAudit?.reachable === "detected") { s += 0.2; r.push("Website reachable (+20%)"); }
    else if (f.website) { s += 0.08; r.push("Website listed but not confirmed reachable (+8%)"); }
    else r.push("No website listed");
    if (f.address) { s += 0.1; r.push("Street address (+10%)"); }
    if (f.facebook || f.instagram || f.linkedin) { s += 0.05; r.push("Social profile (+5%)"); }
    if (f.contactPerson) { s += 0.05; r.push("Public contact person (+5%)"); }
    add("contact", "Contact completeness", s, r);
  }

  // 2. Source reliability (+ corroboration)
  {
    const distinct = [...new Set(f.sources)];
    const best = Math.max(0, ...distinct.map((x) => SOURCE_RELIABILITY[x] ?? 0.5));
    const bonus = Math.min(0.15, (distinct.length - 1) * 0.05);
    add("source", "Source reliability", best + bonus, [
      `Best source: ${distinct.sort((a, b) => (SOURCE_RELIABILITY[b] ?? 0.5) - (SOURCE_RELIABILITY[a] ?? 0.5))[0] ?? "none"} (${Math.round(best * 100)}%)`,
      distinct.length > 1 ? `Corroborated by ${distinct.length} sources (+${Math.round(bonus * 100)}%)` : "Single source",
    ]);
  }

  // 3. Business relevance
  {
    const closed = /closed/i.test(f.businessStatus ?? "");
    const base = f.matchBasis === "tag" || f.matchBasis === "api" ? 1 : f.matchBasis === "keyword" ? 0.7 : f.matchBasis === "custom" ? 0.6 : 0.6;
    add("relevance", "Business relevance", closed ? 0 : base, [
      closed
        ? "Business reported as closed"
        : f.matchBasis === "tag" || f.matchBasis === "api"
          ? "Matched the niche by official category"
          : "Matched the niche by name keyword only (lower precision)",
    ]);
  }

  // 4. Digital opportunity (how much a tech vendor could help — NOT sale probability)
  {
    const raw = opps.reduce((s, o) => s + CERTAINTY_WEIGHT[o.certainty], 0);
    const frac = clamp(raw / 2.5);
    add(
      "digital",
      "Digital opportunity",
      frac,
      opps.length
        ? opps.slice(0, 5).map((o) => `${o.label} (${o.certainty.replace("_", " ")})`)
        : ["No digital gaps identified"],
    );
  }

  // 5. Data freshness
  {
    const ts = f.lastVerifiedAt ?? f.dataTimestamp;
    let frac = 0.3;
    let why = "Source data age unknown";
    if (ts) {
      const days = (now.getTime() - new Date(ts).getTime()) / 86_400_000;
      frac = days < 30 ? 1 : days < 90 ? 0.8 : days < 180 ? 0.6 : days < 365 ? 0.4 : days < 730 ? 0.2 : 0.1;
      why = `Source data is ~${Math.round(days)} days old`;
    }
    add("freshness", "Data freshness", frac, [why]);
  }

  // 6. Activity evidence
  {
    let s = 0;
    const r: string[] = [];
    if (/operational|open/i.test(f.businessStatus ?? "")) { s += 0.2; r.push("Reported operational (+20%)"); }
    if (f.openingHours) { s += 0.2; r.push("Publishes opening hours (+20%)"); }
    if ((f.reviewCount ?? 0) >= 10) { s += 0.35; r.push(`${f.reviewCount} public reviews (+35%)`); }
    else if ((f.reviewCount ?? 0) > 0) { s += 0.15; r.push(`${f.reviewCount} public reviews (+15%)`); }
    const y = f.websiteAudit?.signals.copyrightYear;
    if (y && y >= now.getFullYear() - 1) { s += 0.25; r.push(`Website footer updated ${y} (+25%)`); }
    if (!r.length) r.push("No activity evidence found");
    if (/closed/i.test(f.businessStatus ?? "")) { s = 0; r.length = 0; r.push("Business reported as closed"); }
    add("activity", "Business activity evidence", s, r);
  }

  const total = Math.round(comps.reduce((s, c) => s + c.points, 0));
  const noRoute = !f.phone && !f.email && !f.website;
  const closed = /closed/i.test(f.businessStatus ?? "");
  const classification: Classification =
    noRoute || closed ? "needs_verification" : total >= 70 ? "high_priority" : total >= 62 ? "good_potential" : total >= 45 ? "moderate_potential" : "low_priority";

  return {
    total,
    classification,
    components: comps,
    note: "Lead-quality score only: completeness, reliability, relevance and opportunity. It is not a probability of closing a sale.",
  };
}
