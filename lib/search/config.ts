import { z } from "zod";

export const OPPORTUNITY_KEYS = [
  "no_website", "website_unreachable", "no_ssl", "slow_site", "mobile_unfriendly", "broken_links", "outdated_site",
  "no_online_booking", "no_online_ordering", "no_chatbot", "no_contact_form", "no_crm_automation", "limited_presence", "incomplete_info",
] as const;

export const searchConfigSchema = z.object({
  name: z.string().trim().max(120).optional(),
  nicheIds: z.array(z.string().max(120)).max(25).default([]),
  customNiches: z.array(z.string().trim().min(2).max(80)).max(10).default([]),
  excludeKeywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  location: z.object({
    label: z.string().trim().min(1).max(300),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    countryCode: z.string().length(2).optional(),
    country: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    city: z.string().max(100).optional(),
    placeType: z.string().max(60).optional(),
  }),
  radius: z.object({ value: z.number().positive().max(500), unit: z.enum(["km", "mi"]) }),
  autoExpand: z.boolean().default(false),
  sources: z.array(z.string().max(40)).min(1).max(10),
  enrichWebsites: z.boolean().default(true),
  strategy: z.enum(["precision", "balanced", "coverage"]).default("balanced"),
  filters: z
    .object({
      minRating: z.number().min(0).max(5).optional(),
      minReviews: z.number().int().min(0).optional(),
      maxReviews: z.number().int().min(0).optional(),
      website: z.enum(["any", "has", "none"]).default("any"),
      requirePhone: z.boolean().default(false),
      requireEmail: z.boolean().default(false),
      minChannels: z.number().int().min(0).max(6).optional(),
      opportunities: z.array(z.enum(OPPORTUNITY_KEYS)).max(14).default([]),
      minScore: z.number().int().min(0).max(100).optional(),
    })
    .default({ website: "any", requirePhone: false, requireEmail: false, opportunities: [] }),
});

export type SearchConfig = z.infer<typeof searchConfigSchema>;

export interface SearchStats {
  phase: string;
  sourcesTotal: number;
  sourcesDone: number;
  discovered: number; // raw records returned by sources
  filteredOut: number;
  duplicatesMerged: number; // cross-source/in-run + matched an existing lead
  uncertainDuplicates: number; // queued for manual review
  newLeads: number;
  updatedExisting: number;
  enriched: number;
  verified: number;
  failedRequests: number;
  rateLimitWarnings: number;
  radiusKmUsed?: number;
  expansions: number;
  bySource: Record<string, { found: number; errors: number }>;
}

export const emptyStats = (): SearchStats => ({
  phase: "queued", sourcesTotal: 0, sourcesDone: 0, discovered: 0, filteredOut: 0, duplicatesMerged: 0,
  uncertainDuplicates: 0, newLeads: 0, updatedExisting: 0, enriched: 0, verified: 0, failedRequests: 0,
  rateLimitWarnings: 0, expansions: 0, bySource: {},
});
