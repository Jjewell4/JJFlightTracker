/**
 * Trips: groups of flights that belong to one journey (out, connections, back).
 *
 * Detection follows where you are between flights. A trip starts when a flight lands outside
 * your home area and lasts — however long, through however many cities, including ground legs
 * between airports — until a flight lands back home. If your next flight leaves from home
 * instead, you got back some other way: the trip ends there with `returnLogged: false`.
 * "Home" is inferred from the flights around each date (so a move to a new city is understood)
 * and covers nearby airports you use regularly (e.g. SAN and LAX). Saving a suggestion stamps
 * every leg with the same `tripId` (and `tripName`), so saved trips sync with the flights and
 * always win over detection. Only day-precision flights take part.
 */
import { getAirport, getCountry } from '@/data/reference';
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
  /** The stop is in your home area (never a destination). Only set when true. */
  home?: true;
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
  /** Ends back in the home area. */
  roundTrip: boolean;
  nights: number;
  distanceKm: number;
  /** False when the log has no flight out of home for this trip (it starts mid-journey). */
  startLogged: boolean;
  /** False when the trip ended without a logged flight home (you returned another way). */
  returnLogged: boolean;
}

export interface TripOptions {
  /** Fixed home airport ident; by default home is inferred from the flights around each date. */
  home?: string;
  /** Silence after which an open trip is assumed to have ended (missing data). Default 270 days. */
  maxSilenceDays?: number;
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

function buildTrip(
  id: string,
  saved: boolean,
  legs: Flight[],
  name?: string,
  isHome: (ident: string) => boolean = () => false,
  flags: { startLogged?: boolean; returnLogged?: boolean } = {},
): Trip {
  const flights = chronological(legs);
  const first = flights[0];
  const last = flights[flights.length - 1];
  const stops: TripStop[] = [];
  for (let i = 0; i < flights.length - 1; i++) {
    const stayMin = Math.max(0, Math.round((depInstant(flights[i + 1]) - arrivalInstant(flights[i])) / 60_000));
    const stop: TripStop = { airport: flights[i].to, stayMin, kind: stayMin < DAY_MIN ? 'connection' : 'stay' };
    if (isHome(stop.airport)) stop.home = true;
    stops.push(stop);
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
    roundTrip: sameCity(origin, finish) || isHome(finish),
    nights,
    distanceKm: Math.round(flights.reduce((s, f) => s + (flightDistanceKm(f) ?? 0), 0)),
    startLogged: flags.startLogged ?? true,
    returnLogged: flags.returnLogged ?? (sameCity(origin, finish) || isHome(finish)),
  };
}

// ---------- areas & home over time ----------

/** Airports within this distance of an area's busiest airport belong to the same metro area. */
const METRO_KM = 120;
/** Regularly used airports within this distance of the main home also count as home. */
const HOME_REGION_KM = 250;

/**
 * Groups the log's airports into metro areas (JFK/LGA/EWR, SFO/OAK/SJC…), seeded by the busiest
 * airports first. Returns airport ident → area id (the seed airport's ident).
 */
function metroAreas(flights: Flight[]): Map<string, string> {
  const use = new Map<string, number>();
  for (const f of flights) for (const a of [f.from, f.to]) use.set(a, (use.get(a) ?? 0) + 1);
  const seeds: { ident: string; lat: number; lon: number; city: string; country: string }[] = [];
  const area = new Map<string, string>();
  for (const [ident] of [...use].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const ap = getAirport(ident);
    if (!ap) {
      area.set(ident, ident);
      continue;
    }
    const seed = seeds.find((s) => (s.country === ap.country && s.city && s.city === baseCity(ap.city)) || distanceKm(s, ap) <= METRO_KM);
    if (seed) area.set(ident, seed.ident);
    else {
      seeds.push({ ident, lat: ap.lat, lon: ap.lon, city: baseCity(ap.city), country: ap.country });
      area.set(ident, ident);
    }
  }
  return area;
}

/**
 * Home areas in effect for each flight (by index into `flights`, chronological): the area you
 * fly out of most within a year either side, plus nearby areas you also use regularly.
 * Because it's local in time, moving to a new city moves "home" with you.
 */
function homesOverTime(flights: Flight[], areaOf: (ident: string) => string): Set<string>[] {
  const YEAR = 365 * DAY_MIN * 60_000;
  const t = flights.map(depInstant);
  const out: Set<string>[] = [];
  let lo = 0;
  let hi = 0;
  const counts = new Map<string, number>();
  const add = (i: number, d: number) => {
    const a = areaOf(flights[i].from);
    counts.set(a, (counts.get(a) ?? 0) + d);
  };
  const global = new Map<string, number>();
  // Ties go to the area flown out of first — where a short log most likely starts: home.
  const firstOut = new Map<string, number>();
  flights.forEach((f, i) => {
    const a = areaOf(f.from);
    global.set(a, (global.get(a) ?? 0) + 1);
    if (!firstOut.has(a)) firstOut.set(a, i);
  });
  let current: string | undefined;
  for (let i = 0; i < flights.length; i++) {
    while (hi < flights.length && t[hi] <= t[i] + YEAR) add(hi++, 1);
    while (t[lo] < t[i] - YEAR) add(lo++, -1);
    // Sparse stretches don't say much about where home is: fall back to the whole log.
    const source = hi - lo >= 8 ? counts : global;
    const candidate = busiest(source, firstOut);
    // Hysteresis: home only moves when another area clearly dominates (a real move), so
    // near-even stretches between two cities don't flip it back and forth.
    if (!current) current = busiest(global, firstOut);
    else if (candidate && candidate !== current && (source.get(candidate) ?? 0) >= 1.25 * (source.get(current) ?? 0) + 2) current = candidate;
    out.push(homeSet(current, source));
  }
  return out;
}

function busiest(counts: Map<string, number>, firstOut: Map<string, number>): string | undefined {
  let top: string | undefined;
  let n = 0;
  const order = (a: string) => firstOut.get(a) ?? Number.MAX_SAFE_INTEGER;
  for (const [a, c] of counts) if (c > n || (c === n && c > 0 && top !== undefined && order(a) < order(top))) [top, n] = [a, c];
  return top;
}

function homeSet(top: string | undefined, counts: Map<string, number>): Set<string> {
  const set = new Set<string>();
  if (!top) return set;
  const n = counts.get(top) ?? 0;
  set.add(top);
  const t = getAirport(top);
  if (!t) return set;
  for (const [a, c] of counts) {
    if (a === top || c < Math.max(2, n * 0.2)) continue;
    const ap = getAirport(a);
    if (ap && distanceKm(ap, t) <= HOME_REGION_KM) set.add(a);
  }
  return set;
}

/**
 * Saved trips plus suggestions, newest first. See the module comment for the rules. Suggestions
 * need at least two flights; saved trips are kept whatever their size.
 */
export function detectTrips(all: Flight[], opts: TripOptions = {}): Trip[] {
  const silence = (opts.maxSilenceDays ?? 270) * DAY_MIN * 60_000;
  const timeline = chronological(all.filter((f) => f.datePrecision === 'day'));
  const areas = metroAreas(timeline);
  const areaOf = (ident: string) => areas.get(ident) ?? ident;
  const fixedHome = opts.home ? new Set([areaOf(opts.home)]) : undefined;
  const homes = fixedHome ? timeline.map(() => fixedHome) : homesOverTime(timeline, areaOf);
  const trips: Trip[] = [];

  // Saved trips win: their legs are grouped by id.
  const savedGroups = new Map<string, Flight[]>();
  for (const f of timeline) {
    if (!f.tripId) continue;
    const group = savedGroups.get(f.tripId);
    if (group) group.push(f);
    else savedGroups.set(f.tripId, [f]);
  }
  const homeAtFlight = new Map<Flight, Set<string>>(timeline.map((f, i) => [f, homes[i]]));
  for (const [id, legs] of savedGroups) {
    const home = homeAtFlight.get(legs[legs.length - 1]) ?? new Set<string>();
    trips.push(buildTrip(id, true, legs, legs.find((l) => l.tripName)?.tripName, (a) => home.has(areaOf(a))));
  }

  // Moves: once you start flying out of a new area that dominates your next six months of
  // departures while your old home barely appears, you live there now.
  const AHEAD = 180 * DAY_MIN * 60_000;
  const depAt = timeline.map(depInstant);
  const movedTo = (i: number, area: string, base: Set<string>): Set<string> | undefined => {
    if (fixedHome || base.has(area)) return undefined;
    const counts = new Map<string, number>();
    let old = 0;
    for (let j = i; j < timeline.length && depAt[j] <= depAt[i] + AHEAD; j++) {
      const a = areaOf(timeline[j].from);
      counts.set(a, (counts.get(a) ?? 0) + 1);
      if (base.has(a)) old++;
    }
    const n = counts.get(area) ?? 0;
    const others = [...counts].filter(([a]) => a !== area).map(([, c]) => c);
    if (n >= 3 && old <= 1 && n >= 1.5 * Math.max(1, ...others)) return homeSet(area, counts);
    return undefined;
  };
  let base = homes[0] ?? new Set<string>();

  let legs: Flight[] = [];
  let startLogged = true;
  let tripHome = new Set<string>();
  const close = (returnLogged: boolean) => {
    if (legs.length >= 2) {
      const home = tripHome;
      trips.push(buildTrip(`auto-${legs[0].id}`, false, legs, undefined, (a) => home.has(areaOf(a)), { startLogged, returnLogged }));
    }
    legs = [];
  };

  for (let i = 0; i < timeline.length; i++) {
    const f = timeline[i];
    if (f.tripId) {
      // A saved trip interrupts whatever was in progress.
      if (legs.length) close(false);
      continue;
    }
    // Home follows the inferred base; a detected move ends any trip in progress there.
    const moved = movedTo(i, areaOf(f.from), base);
    if (moved) {
      if (legs.length) close(false);
      base = moved;
    } else if (!fixedHome && !legs.length && homes[i] !== base && [...homes[i]].some((a) => !base.has(a))) {
      // Gradual shifts (no single move) still follow the rolling home between trips.
      const top = [...homes[i]][0];
      if (top && homes[i].has(areaOf(f.from))) base = homes[i];
    }
    const home = base;
    const fromHome = home.has(areaOf(f.from));
    const toHome = home.has(areaOf(f.to));

    if (legs.length) {
      const last = legs[legs.length - 1];
      const stillAway = !home.has(areaOf(last.to));
      // Flying out of home while the log still has you away: you came back another way.
      if (fromHome && stillAway && areaOf(last.to) !== areaOf(f.from)) close(false);
      // A long silence mid-trip means missing flights, not a months-long trip.
      else if (depInstant(f) - arrivalInstant(last) > silence) close(false);
    }

    if (legs.length) {
      legs.push(f);
      if (toHome) {
        // Landing at home ends the trip — unless you fly straight out again (a connection).
        const next = timeline[i + 1];
        const connecting = next && !next.tripId && areaOf(next.from) === areaOf(f.to) && depInstant(next) - arrivalInstant(f) < 6 * 60 * 60_000 && !home.has(areaOf(next.to));
        if (!connecting) close(true);
      }
      continue;
    }

    if (!toHome) {
      // Leaving home (or the first flight we know of while away).
      legs = [f];
      startLogged = fromHome;
      tripHome = home;
    }
    // Hops between home airports (SAN → LAX) aren't trips; a lone flight home from somewhere
    // we never saw you fly to has no known start, so it isn't suggested either.
  }
  if (legs.length) close(false);

  return trips.sort((a, b) => b.start.localeCompare(a.start) || b.flights.length - a.flights.length);
}

/**
 * One unsaved trip made of exactly these legs (in any order; sorted chronologically, origin =
 * the first departure), e.g. to name flights about to be saved together. The legs needn't be in
 * the database, and missing times are fine. Ends where it started → round trip. Throws on [].
 */
export function tripFromLegs(legs: Flight[]): Trip {
  const flights = chronological(legs);
  if (!flights.length) throw new RangeError('tripFromLegs needs at least one flight');
  return buildTrip(`auto-${flights[0].id}`, false, flights);
}

/** The trip a flight belongs to, if any. */
export function tripOf(trips: Trip[], flightId: string): Trip | undefined {
  return trips.find((t) => t.flights.some((f) => f.id === flightId));
}

/**
 * Big airports whose dataset city is the suburb they sit in ("Narita", "Zaventem") rather than the
 * place travellers mean. Keyed by IATA code.
 */
const METRO_CITY: Record<string, string> = {
  ATH: 'Athens', BGY: 'Bergamo', BOG: 'Bogotá', BRU: 'Brussels', BSL: 'Basel', CEB: 'Cebu', CGN: 'Cologne', DFW: 'Dallas', EWR: 'New York',
  DPS: 'Bali', EDI: 'Edinburgh', FRA: 'Frankfurt', GIG: 'Rio de Janeiro', IAD: 'Washington', KOA: 'Kona',
  KRK: 'Kraków', KUL: 'Kuala Lumpur', LEJ: 'Leipzig', LIH: 'Kauai', LIL: 'Lille', LIN: 'Milan', LTN: 'London', LYS: 'Lyon',
  MFM: 'Macau', MRS: 'Marseille', MXP: 'Milan', NAP: 'Naples', NGO: 'Nagoya', NRT: 'Tokyo', OGG: 'Maui',
  OTP: 'Bucharest', PTY: 'Panama City', SAW: 'Istanbul', SJD: 'Los Cabos', SNA: 'Orange County', TIA: 'Tirana', TPE: 'Taipei',
  VCE: 'Venice', ZAG: 'Zagreb',
};

/**
 * City for display ("Paris", not "Paris (Roissy-en-France, Val-d'Oise)"; "Tokyo" for Narita), else
 * the airport name or code.
 */
export function cityName(ident: string): string {
  const a = getAirport(ident);
  if (!a) return ident;
  return METRO_CITY[a.iata] || baseCity(a.city).split('/')[0].trim() || a.name || a.iata || ident;
}

/** Display title: the saved name, else the automatic one (see suggestTripName). */
export function tripTitle(t: Trip): string {
  return t.name?.trim() || suggestTripName(t);
}

// ---------- automatic names ----------

/** Longest place list shown in full ("Denver, Austin & Nashville"); longer ones get "& 2 more". */
const LIST_MAX = 26;
/** "Weekend in …", "Week in …" are dropped when the name would get longer than this. */
const PREFIXED_MAX = 28;

const CONTINENT_NAME: Record<string, string> = {
  AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America',
};
const COUNTRY_SHORT: Record<string, string> = { US: 'USA', GB: 'UK', AE: 'UAE' };
/** Country names that take "the" after "in" ("Week in the UK"). */
const NEEDS_THE = /^(USA|UK|UAE|Netherlands|Philippines|Bahamas|Maldives|Gambia|Seychelles|Comoros)$|Islands$|^(United|Republic|Democratic|Central African|Dominican|Czech) /;
const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

let regionNames: Intl.DisplayNames | null | undefined;

/** Short English country name: dataset first, then Intl; undefined when neither knows it. */
function countryName(code: string): string | undefined {
  const known = COUNTRY_SHORT[code] ?? getCountry(code)?.name;
  if (known) return known;
  try {
    if (regionNames === undefined) regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
    const name = regionNames?.of(code);
    return name && name !== code ? name : undefined;
  } catch {
    regionNames = null;
    return undefined;
  }
}

interface Place {
  /** Same city (and country) → same key. */
  key: string;
  city: string;
  country?: string;
}

function placeOf(ident: string): Place {
  const a = getAirport(ident);
  const city = cityName(ident);
  return a ? { key: `${a.country}|${city.toLowerCase()}`, city, country: a.country || undefined } : { key: ident, city };
}

/** What a name says: bare ("4 countries in Europe") and after "in" ("Europe"). */
interface Scope {
  text: string;
  inText: string;
}

const scopeOf = (text: string, inText = text): Scope => ({ text, inText });

/** "A", "A & B", "A, B & C". */
function joinAnd(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** joinAnd while it stays short, else "A, B & 2 more" (never "& 1 more"). */
function listMore(names: string[]): string {
  const all = joinAnd(names);
  if (names.length <= 2 || all.length <= LIST_MAX) return all;
  for (let shown = names.length - 2; shown >= 1; shown--) {
    const text = `${names.slice(0, shown).join(', ')} & ${names.length - shown} more`;
    if (text.length <= LIST_MAX || shown === 1) return text;
  }
  return all;
}

/**
 * Where the trip went: its destinations in visiting order, one per city. Stays count; connections,
 * the home area and where the trip starts and ends at home don't. A trip picked up already away
 * counts its origin; one that doesn't end at home counts its finish. With no stay at all (a day
 * trip, a quick overnight), the farthest point stands in.
 */
function tripPlaces(t: Trip): { places: Place[]; homeCountry?: string } {
  const anchors: Place[] = [];
  if (t.startLogged) anchors.push(placeOf(t.origin));
  if (t.roundTrip) anchors.push(placeOf(t.finish));
  const home = new Set(anchors.map((p) => p.key));
  for (const s of t.stops) if (s.home) home.add(placeOf(s.airport).key);
  const places: Place[] = [];
  const add = (ident: string) => {
    const p = placeOf(ident);
    if (!home.has(p.key) && !places.some((q) => q.key === p.key)) places.push(p);
  };
  if (!t.startLogged) add(t.origin);
  for (const s of t.stops) if (s.kind === 'stay' && !s.home) add(s.airport);
  if (!t.roundTrip) add(t.finish);
  if (!places.length) add(t.main);
  return { places, homeCountry: anchors[0]?.country };
}

/** Cities; one foreign country ("Japan"); a few countries; a continent; else a short list. */
function tripScope(places: Place[], homeCountry: string | undefined): Scope {
  const cities = places.map((p) => p.city);
  if (places.length <= 2) return scopeOf(joinAnd(cities));
  const codes = places.every((p) => p.country) ? [...new Set(places.map((p) => p.country!))] : [];
  const named = (list: string[]) => {
    const names = list.map(countryName);
    return names.every(Boolean) ? (names as string[]) : undefined;
  };
  const withThe = (n: string) => (NEEDS_THE.test(n) ? `the ${n}` : n);

  // Three or more places in one foreign country: the country.
  if (codes.length === 1 && codes[0] !== homeCountry) {
    const [name] = named(codes) ?? [];
    if (name) return scopeOf(name, withThe(name));
  }
  const all = joinAnd(cities);
  if (all.length <= LIST_MAX) return scopeOf(all);

  // Too many cities to list: name the countries abroad instead.
  const abroad = codes.filter((c) => c !== homeCountry);
  const names = abroad.length ? named(abroad) : undefined;
  if (names) {
    if (names.length === 1) return scopeOf(names[0], withThe(names[0]));
    const list = joinAnd(names);
    if (names.length <= 3 && list.length <= LIST_MAX) return scopeOf(list, joinAnd(names.map(withThe)));
    const continents = new Set(abroad.map((c) => getCountry(c)?.continent));
    const [continent] = continents;
    if (continents.size === 1 && continent && CONTINENT_NAME[continent]) {
      return scopeOf(`${names.length} countries in ${CONTINENT_NAME[continent]}`, CONTINENT_NAME[continent]);
    }
    return scopeOf(listMore(names));
  }
  return scopeOf(listMore(cities));
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** 1–3 nights leaving Thu–Sat and back Sat–Mon. */
function isWeekend(t: Trip): boolean {
  if (t.nights < 1 || t.nights > 3) return false;
  return [4, 5, 6].includes(weekday(t.start)) && [6, 0, 1].includes(weekday(t.end));
}

/** Away over Christmas and/or New Year's Eve (a short trip, not a season abroad). */
function holiday(t: Trip): string | undefined {
  if (!(t.nights >= 1 && t.nights <= 21)) return undefined;
  const year = t.start.slice(0, 4);
  const christmas = t.start <= `${year}-12-25` && t.end >= `${year}-12-25`;
  const newYear = t.end.slice(0, 4) > year;
  if (christmas && newYear) return 'Holidays';
  if (christmas) return 'Christmas';
  return newYear ? 'New Year' : undefined;
}

/** "Week", "Two weeks", "Month", "Three months" when the length is about that; else undefined. */
function span(nights: number): string | undefined {
  if (nights >= 6 && nights <= 8) return 'Week';
  for (const w of [2, 3]) if (Math.abs(nights - 7 * w) <= 1) return `${NUMBER_WORDS[w]} weeks`;
  if (nights >= 27 && nights <= 34) return 'Month';
  const months = Math.round(nights / 30.44);
  if (months >= 2 && months <= 12 && Math.abs(nights - months * 30.44) <= 7) return `${NUMBER_WORDS[months]} months`;
  return undefined;
}

/**
 * Automatic trip name, short because the dates are shown with it:
 * - one place: "Weekend in Chicago" (1–3 nights over a weekend), "Day trip to Chicago",
 *   "Week in Lisbon" / "Two weeks in …" / "Month in …" / "Three months in …" when about that long,
 *   "Christmas in …" / "New Year in …" / "Holidays in …" (both), else just "Chicago";
 * - not back home in the log: "To San Francisco"; picked up already away: "Home from London",
 *   "London to Rome";
 * - two places: "Lisbon & Porto"; three or more in one foreign country: "Japan"; otherwise the
 *   cities while they fit ("Paris, Rome & Barcelona"), then the countries ("France & Italy"),
 *   "4 countries in Europe", or "Japan, Thailand & 2 more". Prefixes apply to these too while short.
 * Connections and the home area never count as places. Works without reference data (codes).
 */
export function suggestTripName(t: Trip): string {
  const { places, homeCountry } = tripPlaces(t);
  if (!places.length) return cityName(t.main);
  const hasStay = t.stops.some((s) => s.kind === 'stay' && !s.home);
  const [first] = places;
  if (!t.startLogged && first.key === placeOf(t.origin).key) {
    // The log picks the trip up already away.
    if (t.roundTrip && places.length === 1) return `Home from ${first.city}`;
    if (!t.roundTrip && places.length === 2 && !hasStay) return `${first.city} to ${places[1].city}`;
  }
  if (!t.roundTrip && t.startLogged && places.length === 1) return `To ${first.city}`;

  const scope = tripScope(places, homeCountry);
  const prefixed = (prefix: string) => {
    const text = `${prefix} ${scope.inText}`;
    return text.length <= PREFIXED_MAX ? text : scope.text;
  };
  if (t.roundTrip && t.nights === 0 && t.flights.length >= 2) return prefixed('Day trip to');
  const occasion = holiday(t);
  if (occasion) return prefixed(`${occasion} in`);
  if (!t.roundTrip) return scope.text;
  if (isWeekend(t)) return prefixed('Weekend in');
  const length = span(t.nights);
  return length ? prefixed(`${length} in`) : scope.text;
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
