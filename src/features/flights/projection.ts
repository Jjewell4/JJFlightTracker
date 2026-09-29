/**
 * Tiny Web-Mercator "fit to bounds" projection and dot-matrix land sampling for the
 * inline route map (no map library needed).
 */
import { LAND_MASK_B64, LAND_MASK_H, LAND_MASK_W } from './world-mask';

const RAD = Math.PI / 180;
const MAX_LAT = 82;

/** Mercator: lon/lat in degrees → unitless x (radians) / y (up is positive). */
export function mercator(lon: number, lat: number): [number, number] {
  const φ = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD;
  return [lon * RAD, Math.log(Math.tan(Math.PI / 4 + φ / 2))];
}

export function inverseMercator(x: number, y: number): [number, number] {
  return [x / RAD, Math.atan(Math.sinh(y)) / RAD];
}

export interface View {
  width: number;
  height: number;
  /** Projected bounds (mercator units). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** px per mercator unit. */
  scale: number;
  /** lon/lat → screen px. */
  project: (lon: number, lat: number) => [number, number];
  /** screen px → lon/lat. */
  invert: (px: number, py: number) => [number, number];
}

/**
 * Fits the given [lon, lat] points into a width×height viewport with padding (fraction of
 * the larger side) and a minimum span (degrees of longitude) so short hops keep context.
 */
export function fitView(points: [number, number][], width: number, height: number, opts: { padding?: number; minSpanDeg?: number } = {}): View {
  const padding = opts.padding ?? 0.18;
  const minSpan = (opts.minSpanDeg ?? 28) * RAD;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [lon, lat] of points) {
    const [x, y] = mercator(lon, lat);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) {
    x0 = -Math.PI;
    x1 = Math.PI;
    y0 = -1.5;
    y1 = 1.5;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let bw = Math.max(x1 - x0, 1e-6);
  let bh = Math.max(y1 - y0, 1e-6);
  // Padding first (relative to route size), then aspect ratio, then minimum span.
  const pad = Math.max(bw, bh) * padding;
  bw += pad * 2;
  bh += pad * 2;
  const aspect = width / height;
  if (bw / bh > aspect) bh = bw / aspect;
  else bw = bh * aspect;
  if (bw < minSpan) {
    bh *= minSpan / bw;
    bw = minSpan;
  }
  const v0x = cx - bw / 2;
  const v1y = cy + bh / 2;
  const scale = width / bw;
  return {
    width,
    height,
    x0: v0x,
    x1: cx + bw / 2,
    y0: cy - bh / 2,
    y1: v1y,
    scale,
    project(lon, lat) {
      const [x, y] = mercator(lon, lat);
      return [(x - v0x) * scale, (v1y - y) * scale];
    },
    invert(px, py) {
      return inverseMercator(px / scale + v0x, v1y - py / scale);
    },
  };
}

// ---------- land mask ----------

let mask: Uint8Array | null = null;

function decodeMask(): Uint8Array {
  if (mask) return mask;
  const bin = atob(LAND_MASK_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  mask = out;
  return out;
}

/** True when the 1° cell containing lon/lat is (mostly) land. Longitudes wrap. */
export function isLand(lon: number, lat: number): boolean {
  if (lat >= 90 || lat < -90) return false;
  const m = decodeMask();
  const col = ((Math.floor(lon + 180) % LAND_MASK_W) + LAND_MASK_W) % LAND_MASK_W;
  const row = Math.min(LAND_MASK_H - 1, Math.floor(90 - lat));
  const i = row * LAND_MASK_W + col;
  return ((m[i >> 3] >> (i & 7)) & 1) === 1;
}

/**
 * Screen-space dot grid over land. Spacing adapts so each dot covers at least ~1° (the
 * mask resolution) while never being denser than `minSpacingPx`.
 */
export function landDots(view: View, minSpacingPx = 7): [number, number][] {
  const spanDeg = (view.x1 - view.x0) / RAD;
  const pxPerDeg = view.width / spanDeg;
  const spacing = Math.max(minSpacingPx, pxPerDeg * 1.05);
  const dots: [number, number][] = [];
  const cols = Math.ceil(view.width / spacing);
  const rows = Math.ceil(view.height / spacing);
  const ox = (view.width - (cols - 1) * spacing) / 2;
  const oy = (view.height - (rows - 1) * spacing) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = ox + c * spacing;
      const py = oy + r * spacing;
      const [lon, lat] = view.invert(px, py);
      if (isLand(lon, lat)) dots.push([px, py]);
    }
  }
  return dots;
}

/** Converts screen points to an SVG path "M x y L …" with 1-decimal precision. */
export function toPath(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}
