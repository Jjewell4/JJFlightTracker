/** Geodesy helpers: great-circle distance and arc interpolation. */

export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_CIRCUMFERENCE_KM = 40075.017;
export const KM_PER_MILE = 1.609344;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Haversine great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const kmToMiles = (km: number) => km / KM_PER_MILE;
export const milesToKm = (mi: number) => mi * KM_PER_MILE;

/**
 * Points along the great circle from a to b as [lon, lat] pairs (GeoJSON order).
 * Longitudes are unwrapped so the line never jumps across the antimeridian
 * (values may exceed ±180, which MapLibre renders correctly).
 */
export function greatCirclePoints(a: LatLon, b: LatLon, segments = 64): [number, number][] {
  const φ1 = rad(a.lat);
  const λ1 = rad(a.lon);
  const φ2 = rad(b.lat);
  const λ2 = rad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[a.lon, a.lat]];
  const pts: [number, number][] = [];
  let prevLon: number | null = null;
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    const lat = deg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    let lon = deg(Math.atan2(y, x));
    if (prevLon !== null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    pts.push([lon, lat]);
  }
  return pts;
}

/** Rough cruise-speed based duration estimate in minutes (taxi + climb overhead included). */
export function estimateDurationMin(km: number): number {
  return Math.round(30 + (km / 830) * 60);
}
