import type { Niche } from "../taxonomy/niches";

/** A business as reported by one source, before dedupe / enrichment. */
export interface RawLead {
  source: string; // connector id
  sourceRecordId: string;
  sourceUrl?: string;
  name: string;
  matchBasis: "tag" | "keyword" | "custom" | "api";
  nicheId?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  lat?: number;
  lng?: number;
  phone?: string;
  email?: string;
  website?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  description?: string;
  openingHours?: string;
  businessStatus?: string;
  /** When the source data itself was last updated, when the source tells us. */
  dataTimestamp?: string;
  raw?: unknown;
}

export type ImplementationStatus =
  | "live_tested" // implemented and exercised against the real service
  | "implemented_untested" // implemented, needs credentials/keys we cannot test without
  | "planned"; // not implemented

export interface ConnectorInfo {
  id: string;
  name: string;
  kind: "discovery" | "enrichment";
  status: ImplementationStatus;
  summary: string;
  returns: string[];
  cost: string;
  requiresKey: boolean;
  envVar?: string;
  limits: string;
  freshness: string;
  regions: string;
  compliance: string;
  docsUrl?: string;
}

export interface DiscoverContext {
  niche: Niche;
  lat: number;
  lng: number;
  radiusKm: number;
  /** Words that, when present in the name, exclude a result. */
  exclude: string[];
  limit: number;
  signal: AbortSignal;
  countryHint?: string;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  trackRequest: (ok: boolean) => void;
}

export interface Connector {
  info: ConnectorInfo;
  /** Whether it can run now (key present, etc.). */
  isConfigured(): boolean;
  /** Why it can't run, shown in the UI. */
  setupMessage(): string | null;
  discover(ctx: DiscoverContext): Promise<RawLead[]>;
}
