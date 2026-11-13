"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useApi } from "../hooks";
import { CLASS_LABEL, ClassBadge, ScoreChip } from "../labels";
import { MapView } from "../map/map-client";
import type { MapPoint } from "../map/leaflet-map";
import { Card, CardHeader, Empty, ErrorNote, PageHeader, Select, Spinner } from "../ui";

interface Pt { id: string; name: string; lat: number; lng: number; score: number; classification: string; subcategory: string | null; status: string; website: string | null; phone: string | null }
const COLOR: Record<string, string> = { high_priority: "#16a34a", good_potential: "#4f46e5", moderate_potential: "#0ea5e9", low_priority: "#94a3b8", needs_verification: "#f59e0b" };

export function MapExplorer() {
  const sp = useSearchParams();
  const [classification, setClassification] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (sp.get("searchId")) qs.set("searchId", sp.get("searchId")!);
  if (classification) qs.set("classification", classification);
  const { data, error, loading } = useApi<{ points: Pt[]; total: number; withoutCoordinates: number }>(`/api/map?${qs}`);

  const points: MapPoint[] = useMemo(() => (data?.points ?? []).map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, sub: `${p.subcategory ?? ""} · score ${p.score}`, color: COLOR[p.classification] })), [data]);
  // Simple density clusters: ~1.1 km grid cells. Counts are real; no external baseline is assumed.
  const clusters = useMemo(() => {
    const m = new Map<string, { n: number; lat: number; lng: number; score: number }>();
    for (const p of data?.points ?? []) {
      const k = `${Math.floor(p.lat * 100)}:${Math.floor(p.lng * 100)}`;
      const c = m.get(k) ?? { n: 0, lat: 0, lng: 0, score: 0 };
      c.n++; c.lat += p.lat; c.lng += p.lng; c.score += p.score;
      m.set(k, c);
    }
    return [...m.values()].filter((c) => c.n >= 3).sort((a, b) => b.n - a.n).slice(0, 8).map((c) => ({ n: c.n, lat: c.lat / c.n, lng: c.lng / c.n, avg: Math.round(c.score / c.n) }));
  }, [data]);
  const picked = data?.points.find((p) => p.id === sel);

  return (
    <div>
      <PageHeader title="Map explorer" description="Your leads on the map, coloured by classification. Use it to spot business clusters worth a visit or campaign." actions={
        <Select value={classification} onChange={(e) => setClassification(e.target.value)} className="w-52" aria-label="Classification filter"><option value="">All classifications</option>{Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      } />
      {loading && !data ? <Spinner /> : error ? <ErrorNote>{error}</ErrorNote> : !data || data.points.length === 0 ? (
        <Card><Empty title="No mappable leads">Leads need coordinates to appear here. Run a search first.</Empty></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <MapView points={points} fit="points" height={600} onSelect={setSel} />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              {Object.entries(COLOR).map(([k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: c }} />{CLASS_LABEL[k]}</span>)}
              <span>{data.points.length.toLocaleString()} shown{data.withoutCoordinates ? ` · ${data.withoutCoordinates} without coordinates` : ""} · © OpenStreetMap contributors</span>
            </div>
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Selected lead" />
              {picked ? (
                <div className="space-y-2 p-4 text-[13px]">
                  <p className="font-medium">{picked.name}</p>
                  <p className="text-muted">{picked.subcategory}</p>
                  <div className="flex items-center gap-2"><ScoreChip score={picked.score} /><ClassBadge value={picked.classification} /></div>
                  {picked.phone && <p>{picked.phone}</p>}
                  <Link href={`/leads?open=${picked.id}`} className="text-accent hover:underline">Open lead</Link>
                </div>
              ) : <p className="p-4 text-[13px] text-muted">Click a point on the map.</p>}
            </Card>
            <Card>
              <CardHeader title="Business clusters" hint="Densest ~1 km areas with 3+ leads" />
              {clusters.length === 0 ? <p className="p-4 text-[13px] text-muted">No dense clusters in the current selection.</p> : (
                <ul className="divide-y divide-line">
                  {clusters.map((c, i) => (
                    <li key={i} className="flex items-center justify-between px-4 py-2 text-[13px]">
                      <span>{c.n} leads <span className="text-xs text-muted">· avg score {c.avg}</span></span>
                      <a className="text-xs text-accent hover:underline" href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=16/${c.lat}/${c.lng}`} target="_blank" rel="noopener noreferrer">View</a>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-line px-4 py-2 text-xs text-muted">Underserved-area detection needs an external market baseline and is not implemented.</p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
