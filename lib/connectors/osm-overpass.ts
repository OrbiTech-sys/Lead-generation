import { API_USER_AGENT } from "../enrich/http";
import type { Niche } from "../taxonomy/niches";
import type { Connector, ConnectorInfo, DiscoverContext, RawLead } from "./types";

// Only mirrors with GLOBAL planet data belong here. Regional instances (e.g. overpass.osm.ch is Switzerland-only)
// would silently return zero results elsewhere. Override with OVERPASS_ENDPOINTS (comma-separated) or self-host.
const ENDPOINTS = (
  process.env.OVERPASS_ENDPOINTS ??
  "https://overpass.openstreetmap.fr/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const POI_KEYS = ["shop", "amenity", "office", "craft", "healthcare", "tourism", "leisure", "club"];

const qlString = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Build Overpass QL for one niche around a point. Exported for tests. */
export function buildOverpassQuery(niche: Niche, lat: number, lng: number, radiusKm: number, limit: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  const stmts: string[] = [];
  for (const t of niche.osm) {
    const [k, v] = t.split("=");
    const filter = v === undefined ? `["${qlString(k)}"]` : `["${qlString(k)}"="${qlString(v)}"]`;
    stmts.push(`nwr${around}${filter}["name"];`);
  }
  if (niche.kw.length) {
    // Keyword statements (niches without good OSM tags, custom niches, or tagged niches that also list
    // keywords such as coffee/pizza). Only POI-like elements, matched against the name: lower precision.
    const re = niche.kw.map((k) => reEscape(k.trim())).filter(Boolean).join("|");
    for (const key of POI_KEYS) stmts.push(`nwr${around}["name"~"${qlString(re)}",i]["${key}"];`);
  }
  return `[out:json][timeout:45];(${stmts.join("")});out center meta tags ${limit};`;
}

interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: Record<string, string>;
}

const first = (t: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (t[k]?.trim()) return t[k].trim();
  return undefined;
};

function socialUrl(v: string | undefined, base: string): string | undefined {
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return `${base}${v.replace(/^@/, "").replace(/^\//, "")}`;
}

/** Convert one OSM element to a RawLead (or null if unusable). Exported for tests. */
export function parseOsmElement(el: OsmElement, niche: Niche): RawLead | null {
  const t = el.tags ?? {};
  const name = t.name?.trim();
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ").trim();
  const address = [street, t["addr:unit"], t["addr:city"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ") || undefined;

  const tagMatch = niche.osm.some((spec) => {
    const [k, v] = spec.split("=");
    return v === undefined ? t[k] !== undefined : (t[k] ?? "").split(";").includes(v);
  });

  return {
    source: "osm",
    sourceRecordId: `${el.type}/${el.id}`,
    sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name,
    matchBasis: niche.custom ? "custom" : tagMatch ? "tag" : "keyword",
    nicheId: niche.id,
    address,
    street: street || undefined,
    city: t["addr:city"],
    state: t["addr:state"],
    postcode: t["addr:postcode"],
    country: t["addr:country"],
    lat,
    lng,
    phone: first(t, "phone", "contact:phone", "contact:mobile", "mobile"),
    email: first(t, "email", "contact:email"),
    website: first(t, "website", "contact:website", "url"),
    facebook: socialUrl(first(t, "contact:facebook", "facebook"), "https://www.facebook.com/"),
    instagram: socialUrl(first(t, "contact:instagram", "instagram"), "https://www.instagram.com/"),
    linkedin: socialUrl(first(t, "contact:linkedin"), "https://www.linkedin.com/"),
    description: first(t, "description", "description:en"),
    openingHours: t.opening_hours,
    dataTimestamp: t.check_date ? new Date(t.check_date).toISOString() : el.timestamp,
    raw: { id: `${el.type}/${el.id}`, tags: t, timestamp: el.timestamp },
  };
}

// Overpass fair use: one request at a time, ~1.5 s apart.
let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1500 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCall = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function queryOverpass(ql: string, ctx: DiscoverContext): Promise<OsmElement[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await serialized(() =>
        fetch(endpoint, {
          method: "POST",
          headers: { "user-agent": API_USER_AGENT, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ data: ql }),
          // Longer than the query's own server-side timeout: abandoning a request does not stop it on the server,
          // it keeps holding one of our (few) slots, so we wait for the server to answer instead of retrying early.
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(100_000)]),
        }),
      );
      if (res.status === 429 || res.status === 504 || res.status === 503 || res.status === 502) {
        ctx.trackRequest(false);
        throw new Error(`server busy (HTTP ${res.status})`);
      }
      if (!res.ok) {
        ctx.trackRequest(false);
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      }
      const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      if (json.remark && /timed out|out of memory/i.test(json.remark)) {
        ctx.trackRequest(false);
        throw new Error("server timed out running the query");
      }
      ctx.trackRequest(true);
      return json.elements ?? [];
    } catch (e) {
      lastErr = e;
      if (ctx.signal.aborted) throw e;
      if (attempt === 3) break;
      const backoff = 5000 * 2 ** attempt;
      ctx.log("warn", `OpenStreetMap request failed (${(e as Error).message}); retry ${attempt + 1}/3 in ${backoff / 1000}s via ${ENDPOINTS[(attempt + 1) % ENDPOINTS.length]}`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error(
    `OpenStreetMap's public Overpass servers did not answer (${(lastErr as Error)?.message ?? "unknown error"}). They are often overloaded at peak times — try again in a few minutes, or reduce the radius / number of niches.`,
  );
}

const info: ConnectorInfo = {
  id: "osm",
  name: "OpenStreetMap (Overpass)",
  kind: "discovery",
  status: "live_tested",
  summary: "Open map data: businesses mapped by volunteers, with name, address, phone, website, hours where tagged.",
  returns: ["name", "category", "address", "coordinates", "phone*", "website*", "email*", "opening hours*", "social links*"],
  cost: "Free, no API key",
  requiresKey: false,
  limits: "Public Overpass servers; fair-use. Requests are serialized (~1 per 1.5 s). Very large radii may time out.",
  freshness: "Varies by area; each record carries its last-edit date. Fields marked * are only present when a mapper added them.",
  regions: "Worldwide, but completeness differs widely (best in Europe/North America, patchier elsewhere).",
  compliance: "ODbL licence — attribution to © OpenStreetMap contributors required; share-alike applies to derived databases.",
  docsUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
};

export const osmConnector: Connector = {
  info,
  isConfigured: () => true,
  setupMessage: () => null,
  async discover(ctx) {
    const ql = buildOverpassQuery(ctx.niche, ctx.lat, ctx.lng, ctx.radiusKm, ctx.limit);
    const els = await queryOverpass(ql, ctx);
    const excl = ctx.exclude.map((x) => x.toLowerCase()).filter(Boolean);
    const seen = new Set<string>();
    const out: RawLead[] = [];
    for (const el of els) {
      const lead = parseOsmElement(el, ctx.niche);
      if (!lead) continue;
      if (excl.some((x) => lead.name.toLowerCase().includes(x))) continue;
      if (seen.has(lead.sourceRecordId)) continue;
      seen.add(lead.sourceRecordId);
      out.push(lead);
    }
    return out;
  },
};
