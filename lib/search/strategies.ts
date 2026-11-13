export type StrategyId = "precision" | "balanced" | "coverage";

export interface Strategy {
  id: StrategyId;
  label: string;
  blurb: string;
  /** Per niche, per source cap. */
  maxPerNiche: number;
  /** Drop name-keyword-only matches (lower precision). */
  tagMatchesOnly: boolean;
  /** Require at least one public contact route (phone, email or website). */
  requireContactRoute: boolean;
  /** Minimum quality score to keep. */
  minScore: number;
  autoExpandDefault: boolean;
}

export const STRATEGIES: Record<StrategyId, Strategy> = {
  precision: {
    id: "precision",
    label: "High Precision",
    blurb: "Fewer, better-qualified leads: official-category matches only, must have a contact route, quality score ≥ 62.",
    maxPerNiche: 100,
    tagMatchesOnly: true,
    requireContactRoute: true,
    minScore: 62,
    autoExpandDefault: false,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    blurb: "Good volume with sensible quality: includes keyword matches, must have a contact route, quality score ≥ 40.",
    maxPerNiche: 200,
    tagMatchesOnly: false,
    requireContactRoute: true,
    minScore: 40,
    autoExpandDefault: false,
  },
  coverage: {
    id: "coverage",
    label: "Maximum Coverage",
    blurb: "Broadest discovery: keeps sparse records (flagged Needs Verification) and auto-expands the radius if results are thin.",
    maxPerNiche: 400,
    tagMatchesOnly: false,
    requireContactRoute: false,
    minScore: 0,
    autoExpandDefault: true,
  },
};
