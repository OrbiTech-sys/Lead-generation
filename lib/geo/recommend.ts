import type { Density } from "../taxonomy/niches";
import { circleAreaKm2 } from "./distance";

/** Coarse settlement class derived from the geocoder's place type. */
export type AreaClass = "metro" | "city" | "town" | "rural" | "unknown";

export function classifyArea(placeType?: string, addresstype?: string): AreaClass {
  const t = `${placeType ?? ""} ${addresstype ?? ""}`.toLowerCase();
  if (/\b(suburb|neighbourhood|neighborhood|quarter|borough|city_district|district)\b/.test(t)) return "metro";
  if (/\bcity\b/.test(t)) return "city";
  if (/\b(town|municipality)\b/.test(t)) return "town";
  if (/\b(village|hamlet|county|state|region|province|isolated)\b/.test(t)) return "rural";
  return "unknown";
}

// Heuristic base radius (km) by [area][density]. These are starting points, NOT guarantees.
const BASE: Record<AreaClass, Record<Density, number>> = {
  metro: { dense: 2, medium: 4, sparse: 8 },
  city: { dense: 4, medium: 8, sparse: 15 },
  town: { dense: 8, medium: 15, sparse: 25 },
  rural: { dense: 20, medium: 35, sparse: 60 },
  unknown: { dense: 5, medium: 10, sparse: 20 },
};

export interface HistoricalSample {
  nicheIds: string[];
  radiusKm: number;
  leads: number;
}

export interface RadiusRecommendation {
  recommendedKm: number;
  reasons: string[];
  basis: "heuristic" | "history";
  /** Only present when real previous searches support it. */
  expectedLeads?: { low: number; high: number; basedOnSearches: number };
  coverageKm2: number;
  disclaimer: string;
}

/**
 * Recommend a radius. Deterministic heuristic on niche density x area type.
 * If this org has completed searches for the same niche(s), we also derive a density
 * (leads per km2) and size the radius to reach `targetLeads`.
 */
export function recommendRadius(args: {
  densities: Density[];
  area: AreaClass;
  nicheNames: string[];
  targetLeads?: number;
  history?: HistoricalSample[];
}): RadiusRecommendation {
  const { densities, area, nicheNames, history = [], targetLeads = 50 } = args;
  const order: Density[] = ["dense", "medium", "sparse"];
  // sparsest niche in the selection dictates the radius so no niche is starved
  const worst = densities.length ? order[Math.max(...densities.map((d) => order.indexOf(d)))] : "medium";
  let km = BASE[area][worst];
  const reasons = [
    `Area type: ${area}. ${nicheNames.slice(0, 3).join(", ") || "The selected niche"} has ${worst} business density (typical, not measured) → starting radius ${km} km.`,
  ];
  let basis: RadiusRecommendation["basis"] = "heuristic";
  let expectedLeads: RadiusRecommendation["expectedLeads"];

  // Caller passes only completed searches for the same niche(s).
  const relevant = history.filter((h) => h.radiusKm > 0 && h.leads > 0);
  if (relevant.length >= 2) {
    const perKm2 = relevant.map((h) => h.leads / circleAreaKm2(h.radiusKm));
    const avg = perKm2.reduce((a, b) => a + b, 0) / perKm2.length;
    const needed = Math.sqrt(targetLeads / (Math.PI * avg));
    if (Number.isFinite(needed) && needed > 0) {
      km = Math.min(250, Math.max(1, Math.round(needed * 2) / 2));
      basis = "history";
      reasons.push(
        `${relevant.length} of your previous completed searches averaged ${(avg * 100).toFixed(1)} leads per 100 km² → ${km} km should reach ~${targetLeads}.`,
      );
      const area2 = circleAreaKm2(km);
      expectedLeads = {
        low: Math.floor(Math.min(...perKm2) * area2),
        high: Math.ceil(Math.max(...perKm2) * area2),
        basedOnSearches: relevant.length,
      };
    }
  } else {
    reasons.push("No comparable past searches yet, so no result-volume estimate is shown.");
  }

  return {
    recommendedKm: km,
    reasons,
    basis,
    expectedLeads,
    coverageKm2: Math.round(circleAreaKm2(km)),
    disclaimer: "Recommendation only. Business density varies a lot; adjust freely or enable auto-expand.",
  };
}

export const RADIUS_PRESETS_KM = [5, 10, 15, 25, 50, 100, 250];
