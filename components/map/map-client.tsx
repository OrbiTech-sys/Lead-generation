"use client";
import dynamic from "next/dynamic";

/** Leaflet touches `window`, so it is loaded client-side only. */
export const MapView = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <div className="grid h-80 place-items-center rounded-lg border border-line text-sm text-muted">Loading map…</div>,
});
