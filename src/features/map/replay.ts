/**
 * "Play your history": pure timeline logic for the animated map replay.
 *
 * Flights are ordered chronologically and laid out on a playback clock (ms at 1×).
 * Pacing is by flight with calendar gaps compressed logarithmically, so a busy
 * month doesn't race past and a quiet year doesn't drag. Every flight animates for
 * the same `fly` duration; dense stretches simply overlap.
 *
 * Everything the map needs per frame is O(log n) + O(active flights): prefix
 * tables give counters and the slices of past routes / airports / countries.
 * No MapLibre / DOM imports, so it's unit-testable.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { getAirport } from '@/data/reference';
import { flightDistanceKm } from '@/lib/flight-utils';
import { distanceKm, greatCirclePoints } from '@/lib/geo';
import type { Airport, Flight } from '@/lib/types';
import { arcSegments, routeKey } from './map-data';

export interface ReplayItem {
  flight: Flight;
  from: Airport;
  to: Airport;
  km: number;
  /** Great-circle arc [lon, lat] (evenly spaced, so index fraction = distance fraction). */
  coords: [number, number][];
  routeKey: string;
  /** Playback time (ms at 1×) at which this flight departs. */
  start: number;
}

export interface Timeline {
  items: ReplayItem[];
  /** How long each flight takes to fly its arc (ms at 1×). */
  fly: number;
  /** Total playback length (ms at 1×). */
  duration: number;
  /** cumKm[k] = distance of the first k flights. */
  cumKm: number[];
  /** Distinct routes in the order they were first completed; routesAt[k] = count after k landings. */
  routeOrder: Feature<LineString, { id: string }>[];
  routesAt: number[];
  /** Distinct airport idents in order of first departure; airportsAt[k] = count after k departures. */
  airportOrder: string[];
  airportsAt: number[];
  /** Distinct country codes in order of first appearance; countriesAt[k] = count among the first k flights. */
  countryOrder: string[];
  countriesAt: number[];
}

export interface ActiveFlight {
  index: number;
  /** 0..1 progress along the arc (eased). */
  frac: number;
}

export interface ReplayFrame {
  t: number;
  /** Flights that have departed (start <= t). */
  started: number;
  /** Flights that have landed (start + fly <= t). */
  landed: number;
  active: ActiveFlight[];
  /** Index of the latest departed flight (drives the date label), -1 before the first. */
  current: number;
  flights: number;
  distanceKm: number;
  countries: number;
  airports: number;
  routes: number;
}

export interface TimelineOptions {
  /** Override the target total length (ms at 1×). */
  targetMs?: number;
}

const DAY_MS = 86_400_000;
/** Extra pacing units a long calendar gap adds on top of the 1 unit every flight gets. */
const GAP_MAX_UNITS = 1.5;
const MIN_FLY = 500;
const MAX_FLY = 2600;

/** Target playback length for n flights: short logs stay snappy, big ones cap at ~36 s. */
export function targetDuration(n: number): number {
  return Math.max(8000, Math.min(36_000, 4000 + n * 1100));
}

/** Chronological order: date, then departure time (unknown first), then entry order. */
export function compareChrono(a: Flight, b: Flight): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = a.depTime ?? '';
  const tb = b.depTime ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const dayNumber = (date: string) => {
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / DAY_MS : 0;
};

/** Pacing units contributed by a calendar gap: 0 for same-day, ~GAP_MAX for a year or more. */
export function gapUnits(days: number): number {
  if (!(days > 0)) return 0;
  return GAP_MAX_UNITS * Math.min(1, Math.log1p(days) / Math.log1p(365));
}

/** Builds the replay timeline for (already scope-filtered) flights. Undrawable flights are skipped. */
export function buildTimeline(flights: Flight[], opts: TimelineOptions = {}): Timeline {
  const sorted = [...flights].sort(compareChrono);
  const items: ReplayItem[] = [];
  for (const f of sorted) {
    const from = getAirport(f.from);
    const to = getAirport(f.to);
    if (!from || !to) continue;
    const arcKm = distanceKm(from, to);
    const coords = greatCirclePoints(from, to, arcSegments(arcKm)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    items.push({ flight: f, from, to, km: flightDistanceKm(f) ?? arcKm, coords, routeKey: routeKey(from.ident, to.ident), start: 0 });
  }

  const n = items.length;
  // Cumulative pacing units at each departure.
  const units: number[] = [];
  let u = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) u += 1 + gapUnits(dayNumber(items[i].flight.date) - dayNumber(items[i - 1].flight.date));
    units.push(u);
  }
  const target = opts.targetMs ?? targetDuration(n);
  const fly = n <= 1 ? Math.min(MAX_FLY, target) : Math.max(MIN_FLY, Math.min(MAX_FLY, (target / Math.max(1, u)) * 1.8, target / 2));
  const unitMs = u > 0 ? (target - fly) / u : 0;
  for (let i = 0; i < n; i++) items[i].start = units[i] * unitMs;
  const duration = n ? items[n - 1].start + fly : 0;

  // Prefix tables.
  const cumKm = [0];
  const routeOrder: Timeline['routeOrder'] = [];
  const routesAt = [0];
  const countryOrder: string[] = [];
  const countriesAt = [0];
  const airportOrder: string[] = [];
  const airportsAt = [0];
  const seenRoutes = new Set<string>();
  const seenCountries = new Set<string>();
  const seenAirports = new Set<string>();
  for (const it of items) {
    cumKm.push(cumKm[cumKm.length - 1] + it.km);
    if (!seenRoutes.has(it.routeKey)) {
      seenRoutes.add(it.routeKey);
      if (it.coords.length >= 2) {
        routeOrder.push({ type: 'Feature', properties: { id: it.routeKey }, geometry: { type: 'LineString', coordinates: it.coords } });
      }
    }
    routesAt.push(routeOrder.length);
    for (const c of [it.from.country, it.to.country]) {
      if (c && !seenCountries.has(c)) {
        seenCountries.add(c);
        countryOrder.push(c);
      }
    }
    countriesAt.push(countryOrder.length);
    for (const id of [it.from.ident, it.to.ident]) {
      if (!seenAirports.has(id)) {
        seenAirports.add(id);
        airportOrder.push(id);
      }
    }
    airportsAt.push(airportOrder.length);
  }

  return { items, fly, duration, cumKm, routeOrder, routesAt, airportOrder, airportsAt, countryOrder, countriesAt };
}

/** Number of items with key(item) <= t (items sorted by key). */
function countUpTo(items: ReplayItem[], t: number, offset: number): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start + offset <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** Everything visible at playback time t (ms at 1×). */
export function frameAt(tl: Timeline, t: number): ReplayFrame {
  const time = Math.max(0, Math.min(tl.duration, t));
  const started = countUpTo(tl.items, time, 0);
  // At the very end everything has landed (guards float drift on the last flight).
  const landed = time >= tl.duration ? tl.items.length : countUpTo(tl.items, time, tl.fly);
  const active: ActiveFlight[] = [];
  let km = tl.cumKm[landed];
  for (let i = landed; i < started; i++) {
    const raw = tl.fly > 0 ? (time - tl.items[i].start) / tl.fly : 1;
    const frac = easeInOut(Math.max(0, Math.min(1, raw)));
    active.push({ index: i, frac });
    km += tl.items[i].km * frac;
  }
  return {
    t: time,
    started,
    landed,
    active,
    current: started - 1,
    flights: started,
    distanceKm: km,
    countries: tl.countriesAt[started],
    airports: tl.airportsAt[started],
    routes: tl.routesAt[landed],
  };
}

/**
 * Reduced-motion stepping: the playback time of the next landing at least `minAdvance`
 * after t (so each step reveals one or more whole flights), or the end.
 */
export function nextStepTime(tl: Timeline, t: number, minAdvance = 0): number {
  const landed = countUpTo(tl.items, t + Math.max(0.5, minAdvance), tl.fly);
  if (landed >= tl.items.length) return tl.duration;
  return Math.min(tl.duration, tl.items[landed].start + tl.fly);
}

/** Playback time at which the given flight has just landed (for scrubbing to a flight). */
export const landingTime = (tl: Timeline, index: number) => Math.min(tl.duration, (tl.items[index]?.start ?? 0) + tl.fly);

// ---------- geometry ----------

/** Point at fraction f (0..1) along an evenly spaced polyline. */
export function pointAlong(coords: [number, number][], f: number): [number, number] {
  if (!coords.length) return [0, 0];
  if (coords.length === 1 || f <= 0) return coords[0];
  if (f >= 1) return coords[coords.length - 1];
  const x = f * (coords.length - 1);
  const i = Math.floor(x);
  const r = x - i;
  const [a0, a1] = coords[i];
  const [b0, b1] = coords[i + 1];
  return [a0 + (b0 - a0) * r, a1 + (b1 - a1) * r];
}

/** The arc drawn up to fraction f (always ≥ 2 points when the arc has ≥ 2). */
export function partialArc(coords: [number, number][], f: number): [number, number][] {
  if (coords.length < 2) return coords;
  if (f >= 1) return coords;
  const x = Math.max(0, f) * (coords.length - 1);
  const i = Math.floor(x);
  return [...coords.slice(0, i + 1), pointAlong(coords, f)];
}

export interface LiveProps {
  kind: 'trail' | 'head';
}

/**
 * Live layer: the in-flight trail(s) and moving head(s). With `still` (reduced motion)
 * nothing moves: the most recently landed flight is shown whole with a dot on arrival.
 */
export function liveGeoJSON(tl: Timeline, frame: ReplayFrame, still = false): FeatureCollection<LineString | Point, LiveProps> {
  const features: Feature<LineString | Point, LiveProps>[] = [];
  const add = (it: ReplayItem, frac: number) => {
    const trail = partialArc(it.coords, frac);
    if (trail.length >= 2) features.push({ type: 'Feature', properties: { kind: 'trail' }, geometry: { type: 'LineString', coordinates: trail } });
    features.push({ type: 'Feature', properties: { kind: 'head' }, geometry: { type: 'Point', coordinates: pointAlong(it.coords, frac) } });
  };
  if (still) {
    const i = frame.landed - 1;
    if (i >= 0) add(tl.items[i], 1);
  } else {
    for (const a of frame.active) add(tl.items[a.index], a.frac);
  }
  return { type: 'FeatureCollection', features };
}

/** Faint arcs of every route completed so far (deduplicated). */
export function pastGeoJSON(tl: Timeline, landed: number): FeatureCollection<LineString, { id: string }> {
  return { type: 'FeatureCollection', features: tl.routeOrder.slice(0, tl.routesAt[landed] ?? 0) };
}

export const visibleAirports = (tl: Timeline, started: number) => tl.airportOrder.slice(0, tl.airportsAt[started] ?? 0);
export const visitedCountries = (tl: Timeline, landed: number) => tl.countryOrder.slice(0, tl.countriesAt[landed] ?? 0);

// ---------- labels ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mar 2019" (or "2019" for year-precision flights). */
export function replayDateLabel(f: Pick<Flight, 'date' | 'datePrecision'> | undefined): string {
  if (!f) return '';
  const y = f.date.slice(0, 4);
  if (f.datePrecision === 'year') return y;
  const m = Number(f.date.slice(5, 7));
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : y;
}

/** Playback speeds offered by the control. */
export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
export const nextSpeed = (s: Speed): Speed => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length];
