import { DISCOVERY_CONNECTORS, getConnector } from "../connectors/registry";
import { toKm } from "../geo/distance";
import { classifyArea, recommendRadius, type HistoricalSample, type RadiusRecommendation } from "../geo/recommend";
import { resolveNiches } from "../taxonomy/niches";
import type { SearchConfig } from "./config";
import { STRATEGIES } from "./strategies";

export interface Advice {
  level: "error" | "warn" | "info" | "ok";
  title: string;
  detail: string;
}

export interface AdvisorReport {
  advice: Advice[];
  radius: RadiusRecommendation;
  likelyFields: Record<string, string[]>;
  canStart: boolean;
}

/** Pre-search "quality assistant". Pure: all inputs are passed in (history comes from the DB). */
export function adviseSearch(cfg: SearchConfig, history: HistoricalSample[] = []): AdvisorReport {
  const niches = resolveNiches(cfg.nicheIds, cfg.customNiches);
  const radiusKm = toKm(cfg.radius.value, cfg.radius.unit);
  const area = classifyArea(cfg.location.placeType, cfg.location.placeType);
  const radius = recommendRadius({
    densities: niches.map((n) => n.density),
    area,
    nicheNames: niches.map((n) => n.name),
    history,
  });
  const advice: Advice[] = [];
  const f = cfg.filters;

  if (!niches.length) advice.push({ level: "error", title: "No niche selected", detail: "Pick at least one niche or add a custom one." });

  const runnable = cfg.sources.map(getConnector).filter((c) => c?.isConfigured());
  if (!runnable.length) {
    advice.push({ level: "error", title: "No runnable source selected", detail: "Select at least one configured source (OpenStreetMap needs no setup)." });
  }
  for (const id of cfg.sources) {
    const c = getConnector(id);
    if (!c) advice.push({ level: "warn", title: `${id} is not available`, detail: "This source is planned but not implemented; it will be ignored." });
    else if (!c.isConfigured()) advice.push({ level: "warn", title: `${c.info.name} is not configured`, detail: `${c.setupMessage()} It will be skipped for this search.` });
  }

  // Radius sanity
  if (radiusKm > radius.recommendedKm * 2.5) {
    advice.push({
      level: "warn",
      title: "Radius looks large",
      detail: `${radiusKm.toFixed(0)} km is much wider than the suggested ${radius.recommendedKm} km. Expect many results and, on OpenStreetMap, possible timeouts for broad niches. Consider several smaller searches.`,
    });
  } else if (radiusKm < radius.recommendedKm / 2.5) {
    advice.push({
      level: "info",
      title: "Radius may be small",
      detail: `${radiusKm.toFixed(1)} km is well under the suggested ${radius.recommendedKm} km. Turn on auto-expand or widen the radius if results are thin.`,
    });
  } else {
    advice.push({ level: "ok", title: "Radius is in a reasonable range", detail: `Suggested ${radius.recommendedKm} km (${radius.basis}).` });
  }
  if (cfg.sources.includes("google_places") && radiusKm > 50) {
    advice.push({ level: "warn", title: "Google Places radius is capped at 50 km", detail: "Larger areas need several overlapping searches." });
  }

  // Niche quality
  const kwOnly = niches.filter((n) => n.osm.length === 0);
  if (kwOnly.length && cfg.sources.includes("osm")) {
    advice.push({
      level: "info",
      title: `${kwOnly.length} niche(s) are matched by name keyword on OpenStreetMap`,
      detail: `${kwOnly.slice(0, 4).map((n) => n.name).join(", ")}${kwOnly.length > 4 ? "…" : ""} have no official OSM category, so matches rely on the business name (lower precision). High Precision drops them.`,
    });
  }
  if (niches.length > 5) {
    advice.push({ level: "info", title: "Many niches in one search", detail: "Searching 5 or fewer niches at a time keeps jobs fast and results easier to attribute. You can run separate searches and compare." });
  }

  // Filters vs sources
  const osmOnly = cfg.sources.every((s) => s === "osm" || !getConnector(s)?.isConfigured());
  if ((f.minRating != null || f.minReviews != null || f.maxReviews != null) && osmOnly) {
    advice.push({
      level: "warn",
      title: "Rating / review filters have little effect on OpenStreetMap",
      detail: "OSM has no ratings or review counts. Leads without that data are kept (not excluded) and flagged. Add Google Places for rating-based filtering.",
    });
  }
  if (f.requireEmail) {
    advice.push({
      level: "warn",
      title: "Requiring an email is restrictive",
      detail: cfg.enrichWebsites
        ? "Most sources publish few emails; the website enricher will look for published ones, but many leads will be filtered out."
        : "Enable website enrichment, otherwise only emails already in the source data count.",
    });
  }
  if (f.opportunities.length && !cfg.enrichWebsites) {
    advice.push({ level: "warn", title: "Opportunity filters need website enrichment", detail: "Website-based gaps (SSL, booking, chat, mobile…) can't be detected with enrichment off." });
  }
  if (f.opportunities.length) {
    advice.push({ level: "info", title: "Opportunity filters use evidence levels", detail: "“Not detected” is not proof of absence. Review matches manually before outreach." });
  }
  if (f.minScore != null && f.minScore > 70) {
    advice.push({ level: "warn", title: "Minimum score is very high", detail: "Few leads reach 70+. Consider High Precision instead of a hard score cut-off." });
  }

  const strat = STRATEGIES[cfg.strategy];
  advice.push({ level: "info", title: `Strategy: ${strat.label}`, detail: strat.blurb });
  if (cfg.strategy === "precision" && niches.length > 1) {
    advice.push({ level: "info", title: "Tip", detail: "Searching each niche separately usually gives the most accurate high-precision results." });
  }

  const likelyFields: Record<string, string[]> = {};
  for (const c of DISCOVERY_CONNECTORS) if (cfg.sources.includes(c.info.id)) likelyFields[c.info.name] = c.info.returns;
  if (cfg.enrichWebsites) likelyFields["Official websites"] = ["published emails", "extra phones", "social links", "digital-gap audit"];

  return { advice, radius, likelyFields, canStart: !advice.some((a) => a.level === "error") };
}
