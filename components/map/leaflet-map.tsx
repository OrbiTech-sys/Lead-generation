"use client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color?: string;
  sub?: string;
  href?: string;
}

interface Props {
  center?: { lat: number; lng: number } | null;
  radiusKm?: number;
  points?: MapPoint[];
  onPick?: (lat: number, lng: number) => void;
  onSelect?: (id: string) => void;
  height?: number | string;
  fit?: "circle" | "points" | "none";
  zoom?: number;
}

/** Leaflet map on OpenStreetMap tiles. Shows search centre, radius circle, and lead points. */
export default function LeafletMap({ center, radiusKm, points = [], onPick, onSelect, height = 320, fit = "circle", zoom = 11 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  const select = useRef(onSelect);
  pick.current = onPick;
  select.current = onSelect;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center?.lat ?? 20, center?.lng ?? 0], center ? zoom : 2);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e) => pick.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    // The container may be laid out after mount (tabs, dialogs)
    const t = setTimeout(() => m.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (center) {
      L.circleMarker([center.lat, center.lng], { radius: 6, color: "#4f46e5", fillColor: "#4f46e5", fillOpacity: 1, weight: 2 }).bindTooltip("Search centre").addTo(g);
      if (radiusKm) {
        const c = L.circle([center.lat, center.lng], { radius: radiusKm * 1000, color: "#4f46e5", weight: 1.5, fillOpacity: 0.07 }).addTo(g);
        if (fit === "circle") m.fitBounds(c.getBounds(), { padding: [20, 20], animate: false });
      } else if (fit === "circle") m.setView([center.lat, center.lng], zoom, { animate: false });
    }
    for (const p of points) {
      const mk = L.circleMarker([p.lat, p.lng], { radius: 5, color: "#fff", weight: 1, fillColor: p.color ?? "#6366f1", fillOpacity: 0.9 });
      const tip = document.createElement("div");
      const b = document.createElement("strong");
      b.textContent = p.label;
      tip.appendChild(b);
      if (p.sub) {
        const s = document.createElement("div");
        s.textContent = p.sub;
        tip.appendChild(s);
      }
      mk.bindTooltip(tip);
      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        select.current?.(p.id);
      });
      mk.addTo(g);
      bounds.push([p.lat, p.lng]);
    }
    if (fit === "points" && bounds.length) m.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 15, animate: false });
  }, [center?.lat, center?.lng, radiusKm, points, fit, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-lg border border-line" role="application" aria-label="Map" />;
}
