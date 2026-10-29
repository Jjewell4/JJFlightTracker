/**
 * Screen geometry for drawing a trip (no map library): every leg as a great-circle arc bowed
 * slightly to its right, so an out-and-back reads as two distinct strokes, plus the airports.
 */
import { getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { greatCirclePoints } from '@/lib/geo';
import type { Trip } from '@/lib/trips';
import { fitView, landDots, toPath } from '@/features/flights/projection';

type Pt = [number, number];

export interface TripLegPath {
  /** 1-based leg number. */
  n: number;
  d: string;
  /** Point halfway along the leg and the travel direction there (degrees). */
  mid: Pt;
  angle: number;
  /** Long enough on screen for a number badge without covering the airports. */
  roomy: boolean;
}

export interface TripAirportMark {
  ident: string;
  code: string;
  role: 'origin' | 'stay' | 'connection';
  x: number;
  y: number;
}

export interface TripDrawing {
  width: number;
  height: number;
  /** Land as one path of zero-length round-capped segments. */
  dots: string;
  legs: TripLegPath[];
  airports: TripAirportMark[];
}

/** Shifts a longitude by whole turns so it lies within ±180° of `ref`. */
function near(lon: number, ref: number): number {
  while (lon - ref > 180) lon -= 360;
  while (lon - ref < -180) lon += 360;
  return lon;
}

export function tripDrawing(
  trip: Trip,
  width: number,
  height: number,
  opts: { padding?: number; minSpanDeg?: number; dotSpacing?: number; bow?: number; segments?: number } = {},
): TripDrawing {
  const bow = opts.bow ?? 0.12;
  const origin = getAirport(trip.origin);
  const ref = origin?.lon ?? 0;

  // Legs in lon/lat, kept on one side of the antimeridian relative to the origin.
  const geoLegs: { n: number; pts: Pt[] }[] = [];
  trip.flights.forEach((f, i) => {
    const a = getAirport(f.from);
    const b = getAirport(f.to);
    if (!a || !b || a.ident === b.ident) return;
    const pts = greatCirclePoints(a, b, opts.segments ?? 48);
    if (pts.length < 2) return;
    const shift = near(pts[0][0], ref) - pts[0][0];
    geoLegs.push({ n: i + 1, pts: pts.map(([lon, lat]) => [lon + shift, lat] as Pt) });
  });

  const marks = new Map<string, { ident: string; role: TripAirportMark['role']; lon: number; lat: number }>();
  const mark = (ident: string, role: TripAirportMark['role']) => {
    const a = getAirport(ident);
    if (!a) return;
    const prev = marks.get(a.ident);
    const rank = { origin: 3, stay: 2, connection: 1 };
    if (!prev || rank[role] > rank[prev.role]) marks.set(a.ident, { ident: a.ident, role, lon: near(a.lon, ref), lat: a.lat });
  };
  mark(trip.origin, 'origin');
  for (const s of trip.stops) mark(s.airport, s.kind);
  mark(trip.finish, trip.roundTrip ? 'origin' : 'stay');
  for (const f of trip.flights) {
    mark(f.from, 'connection');
    mark(f.to, 'connection');
  }

  const all: Pt[] = [...geoLegs.flatMap((l) => l.pts), ...[...marks.values()].map((m) => [m.lon, m.lat] as Pt)];
  const view = fitView(all, width, height, { padding: opts.padding ?? 0.2, minSpanDeg: opts.minSpanDeg ?? 14 });

  const legs = geoLegs.map(({ n, pts }) => {
    const screen = pts.map(([lon, lat]) => view.project(lon, lat));
    const [x0, y0] = screen[0];
    const [x1, y1] = screen[screen.length - 1];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    // Unit normal to the right of travel (screen y points down).
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    const bowed = screen.map(([x, y], i) => {
      const k = Math.sin((Math.PI * i) / (screen.length - 1)) * bow * len;
      return [x + nx * k, y + ny * k] as Pt;
    });
    const m = Math.floor(bowed.length / 2);
    const a = bowed[Math.max(0, m - 1)];
    const b = bowed[Math.min(bowed.length - 1, m + 1)];
    return { n, d: toPath(bowed), mid: bowed[m], angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI, roomy: len >= Math.min(width, height) * 0.22 };
  });

  const airports = [...marks.values()].map((m) => {
    const [x, y] = view.project(m.lon, m.lat);
    return { ident: m.ident, code: airportCode(m.ident), role: m.role, x, y };
  });

  const dots = landDots(view, opts.dotSpacing ?? 9.5)
    .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`)
    .join('');

  return { width, height, dots, legs, airports };
}

export interface LabelPlacement {
  ident: string;
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

/**
 * Greedy label placement: right, left, above or below each airport, avoiding labels already
 * placed, pins and the map edges. Origins and stays are placed first.
 */
export function placeLabels(drawing: TripDrawing, fontPx: number, gap: number): LabelPlacement[] {
  const order = [...drawing.airports].sort((a, b) => (a.role === b.role ? 0 : a.role === 'origin' ? -1 : b.role === 'origin' ? 1 : a.role === 'stay' ? -1 : 1));
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = drawing.airports.map((a) => ({ x0: a.x - 6, y0: a.y - 6, x1: a.x + 6, y1: a.y + 6 }));
  // Leg number badges (see TripMap) are obstacles too.
  if (drawing.legs.length > 1) for (const l of drawing.legs) if (l.roomy) boxes.push({ x0: l.mid[0] - 14, y0: l.mid[1] - 14, x1: l.mid[0] + 14, y1: l.mid[1] + 14 });
  const out: LabelPlacement[] = [];
  for (const a of order) {
    const w = a.code.length * fontPx * 0.66;
    const h = fontPx;
    const candidates: (LabelPlacement & { box: { x0: number; y0: number; x1: number; y1: number } })[] = [
      { ident: a.ident, x: a.x + gap, y: a.y + h * 0.36, anchor: 'start', box: { x0: a.x + gap, y0: a.y - h / 2, x1: a.x + gap + w, y1: a.y + h / 2 } },
      { ident: a.ident, x: a.x - gap, y: a.y + h * 0.36, anchor: 'end', box: { x0: a.x - gap - w, y0: a.y - h / 2, x1: a.x - gap, y1: a.y + h / 2 } },
      { ident: a.ident, x: a.x, y: a.y - gap, anchor: 'middle', box: { x0: a.x - w / 2, y0: a.y - gap - h, x1: a.x + w / 2, y1: a.y - gap } },
      { ident: a.ident, x: a.x, y: a.y + gap + h * 0.8, anchor: 'middle', box: { x0: a.x - w / 2, y0: a.y + gap, x1: a.x + w / 2, y1: a.y + gap + h } },
    ];
    const fits = (c: (typeof candidates)[number]) =>
      c.box.x0 >= 2 && c.box.x1 <= drawing.width - 2 && c.box.y0 >= 2 && c.box.y1 <= drawing.height - 2 &&
      !boxes.some((b) => c.box.x0 < b.x1 && c.box.x1 > b.x0 && c.box.y0 < b.y1 && c.box.y1 > b.y0);
    // Prefer the side facing away from the map's centre.
    if (a.x < drawing.width / 2) candidates.unshift(candidates.splice(1, 1)[0]);
    const pick = candidates.find(fits) ?? candidates[0];
    boxes.push(pick.box);
    out.push({ ident: pick.ident, x: pick.x, y: pick.y, anchor: pick.anchor });
  }
  return out;
}
