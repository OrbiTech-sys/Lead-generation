"use client";
import { Loader2, MapPin, Search } from "lucide-react";
import { useState } from "react";
import { fromKm, toKm } from "@/lib/geo/distance";
import { RADIUS_PRESETS_KM, type RadiusRecommendation } from "@/lib/geo/recommend";
import { call } from "../hooks";
import { MapView } from "../map/map-client";
import { Badge, Button, Card, ErrorNote, Field, Input } from "../ui";

export interface LocationState {
  label: string;
  lat: number;
  lng: number;
  countryCode?: string;
  country?: string;
  state?: string;
  city?: string;
  placeType?: string;
}
export interface RadiusState { value: number; unit: "km" | "mi" }

interface GeoResult extends LocationState { area?: string }

export function LocationPicker({
  location, radius, autoExpand, recommendation, onLocation, onRadius, onAutoExpand,
}: {
  location: LocationState | null;
  radius: RadiusState;
  autoExpand: boolean;
  recommendation?: RadiusRecommendation | null;
  onLocation: (l: LocationState) => void;
  onRadius: (r: RadiusState) => void;
  onAutoExpand: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState({ lat: "", lng: "" });
  const radiusKm = toKm(radius.value, radius.unit);

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ results: GeoResult[] }>(`/api/geocode?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
      if (!r.results.length) setError("No places found. Try a more specific name, a ZIP/postal code, or enter coordinates.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function useCoords() {
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return setError("Enter valid latitude (-90…90) and longitude (-180…180).");
    setError(null);
    onLocation({ label: `Custom point (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng });
  }
  async function pickOnMap(lat: number, lng: number) {
    onLocation({ label: `Custom point (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng });
    try {
      const r = await call<{ results: GeoResult[] }>(`/api/geocode?lat=${lat}&lng=${lng}`);
      const h = r.results[0];
      if (h) onLocation({ ...h, lat, lng, label: h.label });
    } catch {
      /* keep the custom label if reverse geocoding fails */
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <Card className="p-3">
          <Field label="Search a place" hint="Country, state, city, neighbourhood, ZIP/postal code or an exact address. Press Enter to search.">
            <div className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} placeholder="e.g. Brooklyn, New York" />
              <Button onClick={search} loading={busy}><Search className="size-4" /></Button>
            </div>
          </Field>
          {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
              {results.map((r, i) => (
                <li key={i}>
                  <button onClick={() => { onLocation(r); setResults([]); }} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-surface-2">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span className="text-[13px]">{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Geocoding by OpenStreetMap Nominatim. Lookups are rate-limited to 1 per second.</p>
        </Card>

        <Card className="p-3">
          <p className="mb-2 text-[13px] font-medium">Or enter coordinates</p>
          <div className="flex gap-2">
            <Input value={coords.lat} onChange={(e) => setCoords({ ...coords, lat: e.target.value })} placeholder="Latitude" inputMode="decimal" aria-label="Latitude" />
            <Input value={coords.lng} onChange={(e) => setCoords({ ...coords, lng: e.target.value })} placeholder="Longitude" inputMode="decimal" aria-label="Longitude" />
            <Button onClick={useCoords}>Use</Button>
          </div>
          <p className="mt-2 text-xs text-muted">You can also click anywhere on the map to move the search centre. Drawing a custom region is not supported yet.</p>
        </Card>

        <Card className="p-3">
          <p className="mb-2 text-[13px] font-medium">Search radius</p>
          <div className="flex flex-wrap gap-1.5">
            {RADIUS_PRESETS_KM.map((km) => {
              const v = Math.round(fromKm(km, radius.unit) * 10) / 10;
              const active = Math.abs(radiusKm - km) < 0.05;
              return (
                <button key={km} onClick={() => onRadius({ ...radius, value: v })} aria-pressed={active} className={`rounded-lg border px-2.5 py-1 text-[13px] ${active ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-surface-2"}`}>
                  {v} {radius.unit}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input type="number" min={0.5} max={500} step={0.5} value={radius.value} onChange={(e) => onRadius({ ...radius, value: Number(e.target.value) })} className="w-28" aria-label="Custom radius" />
            <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Unit">
              {(["km", "mi"] as const).map((u) => (
                <button key={u} aria-pressed={radius.unit === u} onClick={() => onRadius({ unit: u, value: Math.round(fromKm(toKm(radius.value, radius.unit), u) * 10) / 10 })} className={`px-3 py-1.5 text-[13px] ${radius.unit === u ? "bg-accent text-accent-fg" : "hover:bg-surface-2"}`}>{u.toUpperCase()}</button>
              ))}
            </div>
            <span className="text-xs text-muted">≈ {radiusKm.toFixed(1)} km</span>
          </div>
          <label className="mt-3 flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={autoExpand} onChange={(e) => onAutoExpand(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>Auto-expand the radius if fewer than 30 results come back <span className="block text-xs text-muted">Up to 2 expansions (×1.6), capped at 100 km. Paid sources are queried again.</span></span>
          </label>
        </Card>

        {recommendation && (
          <Card className="border-accent/40 bg-accent-soft/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium">Suggested radius: {recommendation.recommendedKm} km <Badge tone={recommendation.basis === "history" ? "success" : "neutral"}>{recommendation.basis}</Badge></p>
              <Button size="sm" onClick={() => onRadius({ unit: "km", value: recommendation.recommendedKm })}>Use</Button>
            </div>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted">
              {recommendation.reasons.map((r, i) => <li key={i}>{r}</li>)}
              <li>Coverage ≈ {recommendation.coverageKm2.toLocaleString()} km².</li>
              {recommendation.expectedLeads && <li>Based on {recommendation.expectedLeads.basedOnSearches} past searches: roughly {recommendation.expectedLeads.low}–{recommendation.expectedLeads.high} leads.</li>}
            </ul>
            <p className="mt-1.5 text-xs text-muted">{recommendation.disclaimer}</p>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-[13px]">
          {location ? (
            <>
              <MapPin className="size-4 text-accent" />
              <span className="truncate font-medium">{location.label}</span>
            </>
          ) : (
            <span className="text-muted">No location chosen yet — search above or click the map.</span>
          )}
          {busy && <Loader2 className="size-4 animate-spin" />}
        </div>
        <MapView center={location} radiusKm={location ? radiusKm : undefined} onPick={pickOnMap} height={520} />
        <p className="mt-1 text-xs text-muted">Map tiles © OpenStreetMap contributors. Shaded circle = search coverage.</p>
      </div>
    </div>
  );
}
