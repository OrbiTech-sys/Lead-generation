import { haversineKm } from "../geo/distance";
import type { Connector, ConnectorInfo, DiscoverContext, RawLead } from "./types";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// Field mask controls billing tier — only request what we use.
const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.addressComponents",
  "places.location", "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.websiteUri",
  "places.googleMapsUri", "places.rating", "places.userRatingCount", "places.businessStatus",
  "places.regularOpeningHours.weekdayDescriptions", "places.primaryTypeDisplayName", "nextPageToken",
].join(",");

const MAX_RADIUS_M = 50_000; // API limit for circle bias/restriction
const MAX_PAGES = 3; // Text Search returns at most 60 results per query

interface GPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  addressComponents?: { longText: string; shortText: string; types: string[] }[];
  location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

/** Map one Places API (New) result to a RawLead. Exported for tests. */
export function parseGooglePlace(p: GPlace, nicheId: string): RawLead | null {
  const name = p.displayName?.text?.trim();
  if (!name) return null;
  const comp = (type: string, short = false) => {
    const c = p.addressComponents?.find((x) => x.types.includes(type));
    return c ? (short ? c.shortText : c.longText) : undefined;
  };
  return {
    source: "google_places",
    sourceRecordId: p.id,
    sourceUrl: p.googleMapsUri,
    name,
    matchBasis: "api",
    nicheId,
    address: p.formattedAddress,
    city: comp("locality") ?? comp("postal_town"),
    state: comp("administrative_area_level_1"),
    postcode: comp("postal_code"),
    country: comp("country", true),
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
    website: p.websiteUri,
    mapsUrl: p.googleMapsUri,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    businessStatus: p.businessStatus,
    openingHours: p.regularOpeningHours?.weekdayDescriptions?.join("; "),
    raw: p,
  };
}

const info: ConnectorInfo = {
  id: "google_places",
  name: "Google Maps (Places API)",
  kind: "discovery",
  status: "implemented_untested",
  summary: "Official Google Places API (New) Text Search with server-side field masking.",
  returns: ["name", "category", "address", "coordinates", "phone", "website", "Maps URL", "rating", "review count", "opening hours", "business status"],
  cost: "Paid by Google per request (Text Search Enterprise SKU because phone/website/rating are requested). A monthly free allowance may apply — check your Google Cloud billing.",
  requiresKey: true,
  envVar: "GOOGLE_MAPS_API_KEY",
  limits: "Max 60 results per query (3 pages of 20); search radius capped at 50 km. Platform quotas and your Cloud budget apply.",
  freshness: "Live from Google.",
  regions: "Worldwide.",
  compliance: "Subject to Google Maps Platform Terms: results may not be cached/stored beyond what the terms allow (Place IDs excepted). Review before storing data long-term.",
  docsUrl: "https://developers.google.com/maps/documentation/places/web-service/text-search",
};

export const googlePlacesConnector: Connector = {
  info,
  isConfigured: () => !!process.env.GOOGLE_MAPS_API_KEY,
  setupMessage: () =>
    process.env.GOOGLE_MAPS_API_KEY
      ? null
      : "Not configured. Create a Google Cloud API key with the Places API (New) enabled and set GOOGLE_MAPS_API_KEY in your environment. Google bills usage to your account.",
  async discover(ctx: DiscoverContext) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new Error(this.setupMessage()!);
    let radiusM = Math.round(ctx.radiusKm * 1000);
    if (radiusM > MAX_RADIUS_M) {
      ctx.log("warn", `Google Places radius capped at 50 km (requested ${ctx.radiusKm} km).`);
      radiusM = MAX_RADIUS_M;
    }
    const excl = ctx.exclude.map((x) => x.toLowerCase()).filter(Boolean);
    const out: RawLead[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES && out.length < ctx.limit; page++) {
      const body: Record<string, unknown> = {
        textQuery: ctx.niche.name,
        pageSize: 20,
        locationBias: { circle: { center: { latitude: ctx.lat, longitude: ctx.lng }, radius: radiusM } },
      };
      if (ctx.niche.g && !ctx.niche.custom) body.includedType = ctx.niche.g;
      if (pageToken) body.pageToken = pageToken;
      let res: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELD_MASK },
          body: JSON.stringify(body),
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(20_000)]),
        });
        if (res.status !== 429 && res.status < 500) break;
        ctx.trackRequest(false);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
      if (!res || !res.ok) {
        ctx.trackRequest(false);
        const detail = res ? (await res.text()).slice(0, 200) : "no response";
        throw new Error(`Google Places HTTP ${res?.status ?? "?"}: ${detail}`);
      }
      ctx.trackRequest(true);
      const json = (await res.json()) as { places?: GPlace[]; nextPageToken?: string };
      for (const p of json.places ?? []) {
        const lead = parseGooglePlace(p, ctx.niche.id);
        if (!lead) continue;
        if (lead.lat != null && lead.lng != null && haversineKm(ctx.lat, ctx.lng, lead.lat, lead.lng) > ctx.radiusKm) continue;
        if (excl.some((x) => lead.name.toLowerCase().includes(x))) continue;
        out.push(lead);
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
      await new Promise((r) => setTimeout(r, 1200)); // token becomes valid shortly after issue
    }
    return out.slice(0, ctx.limit);
  },
};
