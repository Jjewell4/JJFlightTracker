/**
 * Offline basemap: decodes public/data/basemap.json (Natural Earth 1:50m,
 * built by ./scripts/build-basemap.mjs) into GeoJSON, plus a generated graticule.
 */
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from 'geojson';

export interface EncodedBasemap {
  v: 1;
  scale: number;
  countries: { c: string; p: number[][][] }[];
  lines: number[][];
}

export interface Basemap {
  /** Country polygons with `{ c: ISO-A2 }`. */
  land: FeatureCollection<Polygon | MultiPolygon, { c: string }>;
  /** Admin-1 (state/province) boundaries. */
  lines: FeatureCollection<MultiLineString>;
}

/** Decodes a flat delta-encoded integer ring into [lon, lat] pairs. */
export function decodeRing(ring: number[], scale: number): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    x += ring[i];
    y += ring[i + 1];
    out.push([x / scale, y / scale]);
  }
  return out;
}

export function decodeBasemap(enc: EncodedBasemap): Basemap {
  const s = enc.scale;
  const land: Feature<Polygon | MultiPolygon, { c: string }>[] = enc.countries.map(({ c, p }) => {
    const polys = p.map((rings) => rings.map((r) => decodeRing(r, s)));
    return {
      type: 'Feature',
      properties: { c },
      geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    };
  });
  return {
    land: { type: 'FeatureCollection', features: land },
    lines: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: enc.lines.map((r) => decodeRing(r, s)) } }],
    },
  };
}

/** Lat/lon grid lines every `step` degrees (parallels stop short of the poles). */
export function graticule(step = 20): FeatureCollection<LineString> {
  const features: Feature<LineString>[] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -80; lat <= 80; lat += step) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

let cached: Promise<Basemap | null> | null = null;

/** Fetches + decodes the basemap once. Resolves null (never rejects) when unavailable. */
export function loadBasemap(): Promise<Basemap | null> {
  if (!cached) {
    cached = fetch(`${import.meta.env.BASE_URL}data/basemap.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`basemap ${r.status}`))))
      .then((enc: EncodedBasemap) => decodeBasemap(enc))
      .catch((e) => {
        console.warn('Offline basemap unavailable', e);
        cached = null;
        return null;
      });
  }
  return cached;
}
