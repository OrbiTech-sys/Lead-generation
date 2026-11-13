import type { WebsiteAudit } from "../enrich/website-audit";

/** The facts about a lead that scoring / opportunity detection are allowed to look at. */
export interface LeadFacts {
  name: string;
  nicheBook?: boolean;
  nicheOrder?: boolean;
  matchBasis?: "tag" | "keyword" | "custom" | "api";
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  phoneStatus?: string;
  email?: string | null;
  emailStatus?: string;
  website?: string | null;
  websiteAudit?: WebsiteAudit | null;
  facebook?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  contactPerson?: string | null;
  openingHours?: string | null;
  businessStatus?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  sources: string[];
  /** Timestamp of the underlying source data (e.g. last OSM edit) when known, else collection time. */
  dataTimestamp?: Date | string | null;
  lastVerifiedAt?: Date | string | null;
}

export type Certainty = "verified" | "detected" | "not_detected" | "needs_review";

export interface Opportunity {
  key: string;
  label: string;
  /** Service a vendor could offer against this gap. */
  service: string;
  certainty: Certainty;
  detail: string;
}

export interface ScoreComponent {
  key: "contact" | "source" | "relevance" | "digital" | "freshness" | "activity";
  label: string;
  points: number;
  max: number;
  reasons: string[];
}

export type Classification = "high_priority" | "good_potential" | "moderate_potential" | "low_priority" | "needs_verification";

export interface ScoreResult {
  total: number;
  classification: Classification;
  components: ScoreComponent[];
  note: string;
}

export type ScoreWeights = Record<ScoreComponent["key"], number>;

export const DEFAULT_WEIGHTS: ScoreWeights = {
  contact: 20,
  source: 20,
  relevance: 20,
  digital: 20,
  freshness: 10,
  activity: 10,
};
