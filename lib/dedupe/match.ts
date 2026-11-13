import { haversineKm } from "../geo/distance";

export interface MatchRecord {
  name: string;
  lat?: number | null;
  lng?: number | null;
  phoneE164?: string | null;
  domain?: string | null;
  address?: string | null;
  postcode?: string | null;
}

const LEGAL = /\b(llc|l\.l\.c|inc|incorporated|ltd|limited|corp|corporation|co|company|pllc|pc|llp|gmbh|sarl|sas|srl|pty|plc|pvt|private|the)\b/g;

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ADDR_ABBR: [RegExp, string][] = [
  [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\broad\b/g, "rd"], [/\bboulevard\b/g, "blvd"],
  [/\bdrive\b/g, "dr"], [/\blane\b/g, "ln"], [/\bsuite\b/g, "ste"], [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"],
  [/\beast\b/g, "e"], [/\bwest\b/g, "w"],
];

export function normalizeAddress(addr: string | null | undefined): string {
  let s = (addr ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  for (const [re, r] of ADDR_ABBR) s = s.replace(re, r);
  return s.replace(/\s+/g, " ").trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s/g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, c] of A) inter += Math.min(c, B.get(g) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return total ? (2 * inter) / total : 0;
}

/** Name similarity: max of bigram Dice and token-set containment (handles "Joe's Pizza" vs "Joe's Pizza Brooklyn"). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const containment = inter / Math.min(ta.size, tb.size);
  const jaccard = inter / (ta.size + tb.size - inter);
  // Containment alone over-matches short generic names ("Dental"), so damp it.
  const contained = Math.min(ta.size, tb.size) >= 2 ? containment * 0.9 : jaccard;
  return Math.max(dice(na, nb), contained);
}

// Domains that identify a platform, not a business — never used as a match signal.
const NON_BUSINESS_DOMAINS = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|linktr\.ee|wixsite|business\.site|square\.site|google|yelp|yellowpages|tripadvisor|wordpress|blogspot|godaddysites)\./i;

export function usableDomain(domain?: string | null): string | null {
  if (!domain) return null;
  const d = domain.toLowerCase().replace(/^www\./, "");
  return NON_BUSINESS_DOMAINS.test(d + ".") ? null : d;
}

export type MatchDecision = "merge" | "review" | "distinct";

export interface MatchResult {
  decision: MatchDecision;
  confidence: number;
  reasons: string[];
}

export function compareRecords(a: MatchRecord, b: MatchRecord): MatchResult {
  const reasons: string[] = [];
  const nameSim = nameSimilarity(a.name, b.name);
  const phone = !!a.phoneE164 && a.phoneE164 === b.phoneE164;
  const da = usableDomain(a.domain);
  const db = usableDomain(b.domain);
  const domain = !!da && da === db;
  const haveCoords = a.lat != null && a.lng != null && b.lat != null && b.lng != null;
  const distM = haveCoords ? haversineKm(a.lat!, a.lng!, b.lat!, b.lng!) * 1000 : null;
  const addrA = normalizeAddress(a.address);
  const addrB = normalizeAddress(b.address);
  const addrSim = addrA && addrB ? dice(addrA, addrB) : 0;

  if (phone) reasons.push("Same phone number");
  if (domain) reasons.push(`Same website domain (${da})`);
  if (nameSim >= 0.6) reasons.push(`Name similarity ${(nameSim * 100).toFixed(0)}%`);
  if (distM != null) reasons.push(`${Math.round(distM)} m apart`);
  if (addrSim >= 0.85) reasons.push("Matching street address");

  const out = (decision: MatchDecision, confidence: number): MatchResult => ({ decision, confidence: Math.round(confidence * 100) / 100, reasons });

  // Different branches of one business: same name/domain/phone but far apart => distinct locations.
  if (distM != null && distM > 500) {
    return phone && nameSim >= 0.85 ? out("review", 0.65) : out("distinct", 0.1);
  }

  if (distM != null && distM <= 150) {
    if (nameSim >= 0.85) return out("merge", 0.9 + Math.min(0.09, (phone ? 0.05 : 0) + (domain ? 0.04 : 0)));
    if (nameSim >= 0.6 && (phone || domain)) return out("merge", 0.93);
    if (nameSim >= 0.7) return out("review", 0.7);
    if ((phone || domain) && nameSim >= 0.4) return out("review", 0.65);
    return out("distinct", 0.2);
  }

  if (distM != null) {
    // 150–500 m
    if ((phone || domain) && nameSim >= 0.7) return out("merge", 0.88);
    if (nameSim >= 0.85) return out("review", 0.75);
    return out("distinct", 0.2);
  }

  // No coordinates on at least one record: be conservative.
  if (phone && domain) return out("merge", 0.92);
  if (addrSim >= 0.9 && nameSim >= 0.7) return out("merge", 0.88);
  if ((phone || domain) && nameSim >= 0.7) return out("review", 0.8);
  if (nameSim >= 0.9 && addrSim >= 0.6) return out("review", 0.7);
  return out("distinct", 0.15);
}

/** Best candidate in a pool (cheap pre-filter on location/phone/domain keeps this fast). */
export function findBestMatch<T extends MatchRecord>(rec: MatchRecord, pool: T[]): { match: T; result: MatchResult } | null {
  let best: { match: T; result: MatchResult } | null = null;
  for (const cand of pool) {
    const result = compareRecords(rec, cand);
    if (result.decision === "distinct") continue;
    if (!best || result.confidence > best.result.confidence) best = { match: cand, result };
  }
  return best;
}
