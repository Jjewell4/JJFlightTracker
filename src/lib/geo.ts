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

type Vec3 = [number, number, number];

const toVec = (p: LatLon): Vec3 => {
  const φ = rad(p.lat);
  const λ = rad(p.lon);
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
};
const toLatLon = ([x, y, z]: Vec3): LatLon => ({ lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) });

/** Spherical interpolation from u to v (angle d apart, 0 < d < π), `segments` steps, both ends included. */
function slerp(u: Vec3, v: Vec3, d: number, segments: number): LatLon[] {
  const out: LatLon[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    out.push(toLatLon([A * u[0] + B * v[0], A * u[1] + B * v[1], A * u[2] + B * v[2]]));
  }
  return out;
}

/**
 * Points along the great circle from a to b as [lon, lat] pairs (GeoJSON order).
 * Longitudes are unwrapped so the line never jumps across the antimeridian
 * (values may exceed ±180, which MapLibre renders correctly).
 * Antipodal points (no unique great circle) are joined through the nearer pole instead of
 * producing NaN.
 */
export function greatCirclePoints(a: LatLon, b: LatLon, segments = 64): [number, number][] {
  if (![a.lat, a.lon, b.lat, b.lon].every(Number.isFinite)) return [];
  const φ1 = rad(a.lat);
  const λ1 = rad(a.lon);
  const φ2 = rad(b.lat);
  const λ2 = rad(b.lon);
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2)));
  if (d === 0) return [[a.lon, a.lat]];
  const u = toVec(a);
  const v = toVec(b);
  let raw: LatLon[];
  if (Math.sin(d) < 1e-6) {
    // Antipodal: every great circle through a passes through b. Go via the point 90° from a
    // towards the pole on a's side (or along the equator from a pole).
    let m: Vec3 = [-u[0] * u[2], -u[1] * u[2], 1 - u[2] * u[2]];
    const len = Math.hypot(...m);
    m = len < 1e-9 ? [1, 0, 0] : [m[0] / len, m[1] / len, m[2] / len];
    const half = Math.max(1, Math.ceil(segments / 2));
    raw = [...slerp(u, m, Math.PI / 2, half), ...slerp(m, v, Math.PI / 2, half).slice(1)];
  } else {
    raw = slerp(u, v, d, segments);
  }
  const pts: [number, number][] = [];
  let prevLon: number | null = null;
  for (const p of raw) {
    let lon = p.lon;
    if (prevLon !== null) {
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
    }
    prevLon = lon;
    pts.push([lon, p.lat]);
  }
  return pts;
}

/** Rough cruise-speed based duration estimate in minutes (taxi + climb overhead included). */
export function estimateDurationMin(km: number): number {
  return Math.round(30 + (km / 830) * 60);
}
