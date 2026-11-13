import { api } from "@/lib/auth/guard";
import { rateLimit } from "@/lib/auth/rate-limit";
import { API_USER_AGENT } from "@/lib/enrich/http";
import { classifyArea } from "@/lib/geo/recommend";

// Nominatim usage policy: identify the app, max 1 request/second, cache results, no autocomplete-as-you-type.
const NOMINATIM = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
const cache = new Map<string, { at: number; data: unknown }>();
let last = 0;
let chain: Promise<unknown> = Promise.resolve();

interface NominatimHit {
  lat: string; lon: string; display_name: string; type?: string; addresstype?: string; class?: string;
  boundingbox?: string[]; address?: Record<string, string>;
}

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      last = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

export const GET = api(async (req, ctx) => {
  const u = new URL(req.url);
  const q = u.searchParams.get("q")?.trim();
  const lat = u.searchParams.get("lat");
  const lng = u.searchParams.get("lng");
  if (!q && !(lat && lng)) return Response.json({ error: "Provide q, or lat and lng." }, { status: 400 });
  const rl = rateLimit(`geo:${ctx.userId}`, 30, 60_000);
  if (!rl.ok) return Response.json({ error: "Too many location lookups. Wait a moment." }, { status: 429 });

  const key = q ? `q:${q.toLowerCase()}` : `r:${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return Response.json(hit.data);

  const url = q
    ? `${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`
    : `${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(lat!)}&lon=${encodeURIComponent(lng!)}&zoom=14`;
  const res = await throttled(() => fetch(url, { headers: { "user-agent": API_USER_AGENT, "accept-language": "en" }, signal: AbortSignal.timeout(15_000) }));
  if (!res.ok) return Response.json({ error: `Geocoder unavailable (HTTP ${res.status}). Enter coordinates manually.` }, { status: 502 });
  const raw = (await res.json()) as NominatimHit | NominatimHit[];
  const hits = Array.isArray(raw) ? raw : raw && "lat" in raw ? [raw] : [];
  const data = {
    attribution: "© OpenStreetMap contributors (Nominatim)",
    results: hits.map((h) => {
      const a = h.address ?? {};
      return {
        label: h.display_name,
        lat: Number(h.lat),
        lng: Number(h.lon),
        countryCode: a.country_code?.toUpperCase(),
        country: a.country,
        state: a.state ?? a.region,
        city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county,
        placeType: h.addresstype ?? h.type,
        area: classifyArea(h.type, h.addresstype),
        boundingbox: h.boundingbox?.map(Number),
      };
    }),
  };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return Response.json(data);
});
