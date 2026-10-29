/**
 * Trips: groups of flights that belong to one journey (out, connections, back).
 *
 * Trips are suggested automatically from the log — consecutive legs that chain airport to
 * airport within a few weeks, ending when you're back home. Saving a suggestion stamps every
 * leg with the same `tripId` (and `tripName`), so saved trips sync with the flights and survive
 * re-detection. Only day-precision flights take part.
 */
import { getAirport } from '@/data/reference';
import { airlineKey, departureInstant, flightDistanceKm } from './flight-utils';
import { distanceKm, estimateDurationMin } from './geo';
import { addDays, zonedToUtc } from './time';
import type { Flight } from './types';

export interface TripStop {
  /** Airport ident. */
  airport: string;
  /** Minutes between arriving and the next departure from here. */
  stayMin: number;
  /** Short stops (< 24h) are connections, longer ones are destinations. */
  kind: 'connection' | 'stay';
}

export interface Trip {
  /** Saved trip id, or `auto-<first flight id>` for a suggestion. */
  id: string;
  saved: boolean;
  /** Saved name (suggestions have none; use tripTitle). */
  name?: string;
  /** Legs, chronological. */
  flights: Flight[];
  /** First departure date / last arrival date (YYYY-MM-DD). */
  start: string;
  end: string;
  origin: string;
  /** Where the trip ends (ident). */
  finish: string;
  stops: TripStop[];
  /** Primary destination: the longest stay, else the farthest airport from the origin. */
  main: string;
  /** Ends where it started. */
  roundTrip: boolean;
  nights: number;
  distanceKm: number;
}

export interface TripOptions {
  /** Home airport ident; defaults to the most frequent departure airport. */
  home?: string;
  /** Longest gap between legs of one trip. */
  maxGapDays?: number;
  /** Longest trip. */
  maxTripDays?: number;
}

const DAY_MIN = 24 * 60;

/**
 * Most frequent departure airport — the usual starting point of trips. Ties go to the airport
 * flown from first, so the answer doesn't depend on the order flights are passed in.
 */
export function homeAirport(flights: Flight[]): string | undefined {
  const stats = new Map<string, { n: number; first: string }>();
  for (const f of flights) {
    const when = `${f.date} ${f.depTime ?? ''}`;
    const s = stats.get(f.from);
    if (!s) stats.set(f.from, { n: 1, first: when });
    else {
      s.n++;
      if (when < s.first) s.first = when;
    }
  }
  let best: string | undefined;
  let top = { n: 0, first: '' };
  for (const [k, s] of stats) if (s.n > top.n || (s.n === top.n && s.first < top.first)) [best, top] = [k, s];
  return best;
}

/**
 * Airports that count as "home": the main home plus regularly used airports nearby (within
 * 250 km and at least 3 departures or 5% of them) — e.g. SAN and LAX for a Southern Californian.
 */
export function homeRegion(flights: Flight[], home: string | undefined): Set<string> {
  const region = new Set<string>();
  if (!home) return region;
  region.add(home);
  const h = getAirport(home);
  if (!h) return region;
  const departures = new Map<string, number>();
  for (const f of flights) departures.set(f.from, (departures.get(f.from) ?? 0) + 1);
  const threshold = Math.max(3, flights.length * 0.05);
  for (const [ident, n] of departures) {
    if (ident === home || n < threshold) continue;
    const a = getAirport(ident);
    if (a && distanceKm(a, h) <= 250) region.add(ident);
  }
  return region;
}

/** "Paris (Roissy-en-France, Val-d'Oise)" / "London, Essex" → "Paris" / "London". */
function baseCity(city: string): string {
  return city.replace(/\s*\(.*$/, '').split(',')[0].trim();
}

function sameCity(a: string, b: string): boolean {
  if (a === b) return true;
  const x = getAirport(a);
  const y = getAirport(b);
  if (!x || !y || x.country !== y.country) return false;
  const cx = baseCity(x.city);
  return !!cx && cx === baseCity(y.city);
}

// Time-zone math (Intl) dominates detection cost, so instants are computed once per flight
// object. Records are immutable here (edits produce new objects), so a WeakMap is safe.
const depCache = new WeakMap<Flight, number>();
const arrCache = new WeakMap<Flight, number>();

function depInstant(f: Flight): number {
  let t = depCache.get(f);
  if (t === undefined) depCache.set(f, (t = departureInstant(f)));
  return t;
}

function arrivalInstant(f: Flight): number {
  let t = arrCache.get(f);
  if (t === undefined) {
    t = f.arrTime
      ? zonedToUtc(addDays(f.date, f.arrDayOffset ?? 0), f.arrTime, getAirport(f.to)?.tz || undefined)
      : depInstant(f) + (f.durationMin ?? 180) * 60_000;
    arrCache.set(f, t);
  }
  return t;
}

function chronological(flights: Flight[]): Flight[] {
  return flights
    .map((f) => [depInstant(f), f] as const)
    .sort((a, b) => a[0] - b[0] || a[1].createdAt - b[1].createdAt)
    .map(([, f]) => f);
}

function buildTrip(id: string, saved: boolean, legs: Flight[], name?: string, isHome: (ident: string) => boolean = () => false): Trip {
  const flights = chronological(legs);
  const first = flights[0];
  const last = flights[flights.length - 1];
  const stops: TripStop[] = [];
  for (let i = 0; i < flights.length - 1; i++) {
    const stayMin = Math.max(0, Math.round((depInstant(flights[i + 1]) - arrivalInstant(flights[i])) / 60_000));
    stops.push({ airport: flights[i].to, stayMin, kind: stayMin < DAY_MIN ? 'connection' : 'stay' });
  }
  const origin = first.from;
  const finish = last.to;
  const stays = stops.filter((s) => s.kind === 'stay' && !sameCity(s.airport, origin));
  let main: string;
  if (stays.length) main = stays.reduce((a, b) => (b.stayMin > a.stayMin ? b : a)).airport;
  else {
    // One-way or a quick out-and-back: the farthest point from where it started.
    const o = getAirport(origin);
    const candidates = [...new Set(flights.flatMap((f) => [f.from, f.to]))].filter((a) => !sameCity(a, origin));
    main = candidates.reduce((best, a) => {
      const pa = getAirport(a);
      const pb = getAirport(best);
      if (!o || !pa) return best;
      if (!pb) return a;
      const da = Math.hypot(pa.lat - o.lat, pa.lon - o.lon);
      const db = Math.hypot(pb.lat - o.lat, pb.lon - o.lon);
      return da > db ? a : best;
    }, candidates[0] ?? finish);
  }
  const end = addDays(last.date, last.arrDayOffset ?? 0);
  const nights = Math.max(0, Math.round((Date.parse(end) - Date.parse(first.date)) / 86_400_000));
  return {
    id,
    saved,
    name,
    flights,
    start: first.date,
    end,
    origin,
    finish,
    stops,
    main,
    roundTrip: sameCity(origin, finish) || (isHome(origin) && isHome(finish)),
    nights,
    distanceKm: Math.round(flights.reduce((s, f) => s + (flightDistanceKm(f) ?? 0), 0)),
  };
}

/**
 * Saved trips plus suggestions, newest first. Suggestions chain legs whose departure airport
 * (or city) matches the previous arrival within `maxGapDays`, stop when the traveller is back
 * home, and never exceed `maxTripDays`. Single flights aren't returned as trips.
 */
export function detectTrips(all: Flight[], opts: TripOptions = {}): Trip[] {
  const maxGap = (opts.maxGapDays ?? 21) * DAY_MIN * 60_000;
  const maxSpan = (opts.maxTripDays ?? 60) * DAY_MIN * 60_000;
  const dated = all.filter((f) => f.datePrecision === 'day');
  const home = opts.home ?? homeAirport(dated);
  const region = homeRegion(dated, home);
  const isHome = (ident: string) => [...region].some((h) => sameCity(ident, h));
  const trips: Trip[] = [];

  // Saved trips win: their legs are grouped by id and excluded from suggestions.
  const savedGroups = new Map<string, Flight[]>();
  for (const f of dated) {
    if (!f.tripId) continue;
    const group = savedGroups.get(f.tripId);
    if (group) group.push(f);
    else savedGroups.set(f.tripId, [f]);
  }
  for (const [id, legs] of savedGroups) trips.push(buildTrip(id, true, legs, legs.find((l) => l.tripName)?.tripName, isHome));

  let current: Flight[] = [];
  const flush = () => {
    if (current.length >= 2) trips.push(buildTrip(`auto-${current[0].id}`, false, current, undefined, isHome));
    current = [];
  };
  for (const f of chronological(dated.filter((x) => !x.tripId))) {
    const prev = current[current.length - 1];
    if (prev) {
      const gap = depInstant(f) - arrivalInstant(prev);
      const span = depInstant(f) - depInstant(current[0]);
      const chained = sameCity(prev.to, f.from) && gap >= -60 * 60_000 && gap <= maxGap && span <= maxSpan;
      // Landing at home ends the trip, unless it's just a connection through home (< 6h).
      const backHome = isHome(prev.to) && gap > 6 * 60 * 60_000;
      if (!chained || backHome) flush();
    }
    current.push(f);
  }
  flush();
  return trips.sort((a, b) => b.start.localeCompare(a.start) || b.flights.length - a.flights.length);
}

/** The trip a flight belongs to, if any. */
export function tripOf(trips: Trip[], flightId: string): Trip | undefined {
  return trips.find((t) => t.flights.some((f) => f.id === flightId));
}

/** City for display ("Paris", not "Paris (Roissy-en-France, Val-d'Oise)"), else the airport name or code. */
export function cityName(ident: string): string {
  const a = getAirport(ident);
  return (a && baseCity(a.city)) || a?.name || a?.iata || ident;
}

/** Display title: saved name, else the primary destination's city (or code). */
export function tripTitle(t: Trip): string {
  if (t.name?.trim()) return t.name.trim();
  return cityName(t.main);
}

/** Date range label, e.g. "Oct 3 – 7, 2026", "Dec 28, 2025 – Jan 4, 2026". */
export function tripDates(t: Trip): string {
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  const [sy, sm] = t.start.split('-');
  const [ey, em] = t.end.split('-');
  if (t.start === t.end) return fmt(t.start, { month: 'short', day: 'numeric', year: 'numeric' });
  if (sy !== ey) return `${fmt(t.start, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(t.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if (sm !== em) return `${fmt(t.start, { month: 'short', day: 'numeric' })} – ${fmt(t.end, { month: 'short', day: 'numeric' })}, ${sy}`;
  return `${fmt(t.start, { month: 'short', day: 'numeric' })} – ${Number(t.end.slice(8))}, ${sy}`;
}

/** Periods away from home (for the travel calendar): each trip's first to last date. */
export function awaySpans(trips: Trip[]): { start: string; end: string; tripId: string }[] {
  return trips.map((t) => ({ start: t.start, end: t.end, tripId: t.id })).sort((a, b) => a.start.localeCompare(b.start));
}

// ---------- display & lookup helpers ----------

export interface TripYear {
  year: string;
  trips: Trip[];
  nights: number;
}

/** Groups trips (newest first, as detectTrips returns them) by the year they start in. */
export function groupTripsByYear(trips: Trip[]): TripYear[] {
  const byYear = new Map<string, TripYear>();
  for (const t of trips) {
    const year = t.start.slice(0, 4);
    let y = byYear.get(year);
    if (!y) byYear.set(year, (y = { year, trips: [], nights: 0 }));
    y.trips.push(t);
    y.nights += t.nights;
  }
  return [...byYear.values()].sort((a, b) => b.year.localeCompare(a.year));
}

/**
 * Finds the trip for a URL id. Suggestion ids (`auto-<first flight id>`) go stale when the log
 * changes (a leg added before it, the suggestion saved…), so this falls back to the trip that now
 * holds that flight, then to the trip holding any of `hintFlightIds` (the legs last shown).
 * `exact` is false when a fallback matched, so the caller can update the URL.
 */
export function resolveTrip(trips: Trip[], id: string, hintFlightIds: readonly string[] = []): { trip: Trip; exact: boolean } | undefined {
  const exact = trips.find((t) => t.id === id);
  if (exact) return { trip: exact, exact: true };
  const ids = id.startsWith('auto-') ? [id.slice(5), ...hintFlightIds] : [...hintFlightIds];
  for (const fid of ids) {
    const t = tripOf(trips, fid);
    if (t) return { trip: t, exact: false };
  }
  return undefined;
}

export type RouteRole = 'origin' | 'connection' | 'stay' | 'finish';

/** Compact route: origin, every stop (connections flagged) and the final arrival. */
export function tripRoute(t: Trip): { airport: string; role: RouteRole }[] {
  if (!t.flights.length) return [];
  return [
    { airport: t.origin, role: 'origin' as const },
    ...t.stops.map((s) => ({ airport: s.airport, role: s.kind })),
    { airport: t.finish, role: 'finish' as const },
  ];
}

/** Total time in the air (recorded durations, estimated from distance when missing). */
export function tripMinutes(t: Trip): number {
  return t.flights.reduce((sum, f) => {
    if (f.durationMin) return sum + f.durationMin;
    const km = flightDistanceKm(f);
    return sum + (km ? estimateDurationMin(km) : 0);
  }, 0);
}

/** Distinct airlines and airports on the trip. */
export function tripCounts(t: Trip): { airlines: number; airports: number } {
  const airlines = new Set<string>();
  const airports = new Set<string>();
  for (const f of t.flights) {
    const k = airlineKey(f);
    if (k) airlines.add(k);
    airports.add(getAirport(f.from)?.ident ?? f.from);
    airports.add(getAirport(f.to)?.ident ?? f.to);
  }
  return { airlines: airlines.size, airports: airports.size };
}

/** Whole nights between landing at a stop and flying on (local dates). */
export function stopNights(arriving: Flight, departing: Flight): number {
  const landed = addDays(arriving.date, arriving.arrDayOffset ?? 0);
  return Math.max(0, Math.round((Date.parse(departing.date) - Date.parse(landed)) / 86_400_000));
}
