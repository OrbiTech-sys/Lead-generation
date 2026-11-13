const R_KM = 6371.0088;
export const KM_PER_MILE = 1.609344;

export const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function toKm(value: number, unit: "km" | "mi"): number {
  return unit === "mi" ? value * KM_PER_MILE : value;
}

export function fromKm(km: number, unit: "km" | "mi"): number {
  return unit === "mi" ? km / KM_PER_MILE : km;
}

/** Bounding box that fully contains a circle (used to pre-filter / draw coverage). */
export function boundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = (radiusKm / R_KM) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.01, Math.cos(toRad(lat)));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
}

export function circleAreaKm2(radiusKm: number): number {
  return Math.PI * radiusKm * radiusKm;
}

export function validCoords(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}
