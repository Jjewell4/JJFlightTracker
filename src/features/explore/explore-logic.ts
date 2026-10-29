/**
 * Pure aggregation for the airport and airline history pages ("your full history at SAN",
 * "everything with Alaska"). Definitions match the Stats screen: distances and times come
 * from `resolveFlight()`, airlines are grouped by `airlineKey()`, airports by ident.
 *
 * Reference lookups are sync and return undefined until reference data has loaded, so
 * callers recompute once `useReferenceReady()` flips.
 */
import { getAirline, getAirlineByName, getAirport, getCountry, normalize } from '@/data/reference';
import { airlineKey, flightAirlineName, isUpcoming } from '@/lib/flight-utils';
import {
  cabinBreakdown,
  computeTotals,
  rankAircraft,
  rankAirlines,
  rankAirports,
  rankRoutes,
  resolveFlight,
  seatBreakdown,
  type Breakdown,
  type RankedAircraft,
  type RankedAirline,
  type RankedAirport,
  type RankedRoute,
  type ResolvedFlight,
} from '@/lib/stats';
import { todayLocal } from '@/lib/time';
import type { Airline, Airport, CabinClass, Flight, SeatType } from '@/lib/types';

export interface ExploreOptions {
  /** Current instant (ms) — splits upcoming from flown flights. */
  now?: number;
  /** Device-local today, YYYY-MM-DD. */
  today?: string;
}

export interface YearCount {
  year: number;
  count: number;
}

// ---------- URL params ----------

/** Decodes a route param once if it still carries %-escapes (params are usually decoded). */
function decodeParam(raw: string): string {
  if (!/%[0-9a-f]{2}/i.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Canonical airport key for any stored code: ident when known, upper-cased raw code otherwise. */
export function airportKeyOf(code: string | undefined): string {
  return getAirport(code)?.ident ?? (code ?? '').trim().toUpperCase();
}

export interface AirportParam {
  /** Key to match flights against (ident, or the raw code of an unknown airport). */
  key: string;
  airport?: Airport;
  /** Set when the URL should be replaced by the canonical one (IATA → ICAO ident, case). */
  redirect?: string;
}

/** `/airports/:ident` accepts an ident ("KSAN"), an IATA code ("SAN") or either in lower case. */
export function resolveAirportParam(param: string | undefined): AirportParam {
  const raw = decodeParam(param ?? '').trim();
  const airport = getAirport(raw);
  const key = airport?.ident ?? raw.toUpperCase();
  return { key, airport, redirect: key && key !== raw ? key : undefined };
}

export interface AirlineParam {
  /** `airlineKey()` value to match flights against. */
  key: string;
  airline?: Airline;
  redirect?: string;
}

/**
 * `/airlines/:key` accepts an `airlineKey()` ("ASA", "name:acme air"), an IATA code ("AS",
 * resolved to its ICAO like `airlineKey` does) or either in lower case.
 */
export function resolveAirlineParam(param: string | undefined): AirlineParam {
  const raw = decodeParam(param ?? '').trim();
  let key: string;
  if (/^name:/i.test(raw)) {
    const name = normalize(raw.slice(5));
    key = name ? `name:${name}` : '';
  } else {
    const up = raw.toUpperCase();
    key = up.length === 2 ? getAirline(up)?.icao || up : up;
  }
  const airline = key.startsWith('name:') ? getAirlineByName(key.slice(5)) : getAirline(key);
  return { key, airline, redirect: key && key !== raw ? key : undefined };
}

// ---------- shared helpers ----------

const bySort = (a: ResolvedFlight, b: ResolvedFlight) => a.sortKey.localeCompare(b.sortKey) || a.flight.createdAt - b.flight.createdAt;

function splitFlights(flights: Flight[], opts: ExploreOptions): { flown: Flight[]; upcoming: Flight[] } {
  const now = opts.now ?? Date.now();
  const today = opts.today ?? todayLocal();
  const flown: Flight[] = [];
  const upcoming: Flight[] = [];
  for (const f of flights) (isUpcoming(f, now, today) ? upcoming : flown).push(f);
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? ''));
  return { flown, upcoming };
}

/** Year buckets from the first year through `max(lastYear, currentYear)`, gaps filled with 0. */
export function yearSeries(counts: Map<number, number>, currentYear?: number): YearCount[] {
  const years = [...counts.keys()].filter((y) => Number.isFinite(y) && y > 0);
  if (!years.length) return [];
  const first = Math.min(...years);
  const last = Math.max(...years, currentYear && currentYear >= first ? currentYear : -Infinity);
  const out: YearCount[] = [];
  for (let y = first; y <= last; y++) out.push({ year: y, count: counts.get(y) ?? 0 });
  return out;
}

function chronoEnds(rs: ResolvedFlight[]): { first?: Flight; last?: Flight } {
  if (!rs.length) return {};
  const sorted = [...rs].sort(bySort);
  return { first: sorted[0].flight, last: sorted[sorted.length - 1].flight };
}

// ---------- airport ----------

export interface DestinationStat {
  /** Other airport's key (ident, or raw code when unknown). */
  key: string;
  airport?: Airport;
  /** Flights between here and there, both directions. */
  count: number;
  /** Flights from here to there. */
  outbound: number;
  /** Flights from there to here. */
  inbound: number;
  distanceKm?: number;
}

export interface AirportHistory {
  key: string;
  airport?: Airport;
  /** Flown flights touching the airport, in input order (pass newest first). */
  flights: Flight[];
  /** Upcoming flights touching the airport, soonest first. */
  upcoming: Flight[];
  /** Departures + arrivals (same definition as Stats and the map). */
  visits: number;
  departures: number;
  arrivals: number;
  firstFlight?: Flight;
  lastFlight?: Flight;
  /** Distance of every flown flight to or from the airport. */
  distanceKm: number;
  /** Other airports flown to/from here, most frequent first. */
  destinations: DestinationStat[];
  /** Distinct countries among the destinations (other than unknown). */
  destinationCountries: number;
  airlines: RankedAirline[];
  aircraft: RankedAircraft[];
  /** Visits (departures + arrivals) per calendar year. */
  perYear: YearCount[];
}

/** Everything about one airport from the user's flights. `key` is an airport ident or raw code. */
export function airportHistory(all: Flight[], key: string, opts: ExploreOptions = {}): AirportHistory {
  const target = airportKeyOf(key);
  const airport = getAirport(target);
  const touching = all.filter((f) => airportKeyOf(f.from) === target || airportKeyOf(f.to) === target);
  const { flown, upcoming } = splitFlights(touching, opts);
  const rs = flown.map(resolveFlight);

  let departures = 0;
  let arrivals = 0;
  let distanceKm = 0;
  const perYear = new Map<number, number>();
  const dest = new Map<string, DestinationStat>();
  for (const r of rs) {
    const dep = r.fromKey === target;
    const arr = r.toKey === target;
    if (dep) departures++;
    if (arr) arrivals++;
    distanceKm += r.distanceKm ?? 0;
    perYear.set(r.year, (perYear.get(r.year) ?? 0) + (dep ? 1 : 0) + (arr ? 1 : 0));
    const otherKey = dep ? r.toKey : r.fromKey;
    if (!otherKey || otherKey === target) continue;
    let d = dest.get(otherKey);
    if (!d) dest.set(otherKey, (d = { key: otherKey, airport: dep ? r.to : r.from, count: 0, outbound: 0, inbound: 0, distanceKm: r.distanceKm }));
    d.count++;
    if (dep) d.outbound++;
    else d.inbound++;
  }

  const destinations = [...dest.values()].sort((a, b) => b.count - a.count || (a.airport?.iata || a.key).localeCompare(b.airport?.iata || b.key));
  const countries = new Set(destinations.map((d) => d.airport?.country).filter(Boolean));
  const { first, last } = chronoEnds(rs);
  return {
    key: target,
    airport,
    flights: flown,
    upcoming,
    visits: departures + arrivals,
    departures,
    arrivals,
    firstFlight: first,
    lastFlight: last,
    distanceKm,
    destinations,
    destinationCountries: countries.size,
    airlines: rankAirlines(rs),
    aircraft: rankAircraft(rs),
    perYear: yearSeries(perYear, opts.today ? Number(opts.today.slice(0, 4)) : new Date().getFullYear()),
  };
}

// ---------- airline ----------

export interface AirlineHistory {
  key: string;
  airline?: Airline;
  name: string;
  iata?: string;
  icao?: string;
  /** Country name from the airline dataset ('' when unknown). */
  country: string;
  /** Flown flights with this airline, in input order (pass newest first). */
  flights: Flight[];
  upcoming: Flight[];
  /** Share of all flown flights (0–1). */
  share: number;
  /** All flown flights in the log (the share's denominator). */
  totalFlights: number;
  distanceKm: number;
  durationMin: number;
  /** Flights whose time in the air was estimated from distance. */
  estimatedDuration: number;
  firstFlight?: Flight;
  lastFlight?: Flight;
  /** Both directions combined; the more-visited airport is `a`. */
  routes: RankedRoute[];
  aircraft: RankedAircraft[];
  airports: RankedAirport[];
  perYear: YearCount[];
  cabin: Breakdown<CabinClass>;
  seat: Breakdown<SeatType>;
}

/** Everything flown with one airline. `key` is an `airlineKey()` value. */
export function airlineHistory(all: Flight[], key: string, opts: ExploreOptions = {}): AirlineHistory {
  const matching = all.filter((f) => airlineKey(f) === key);
  const { flown, upcoming } = splitFlights(matching, opts);
  const totalFlights = splitFlights(all, opts).flown.length;
  const rs = flown.map(resolveFlight);
  const totals = computeTotals(rs);
  const airports = rankAirports(rs);
  const visits = new Map(airports.map((a) => [a.key, a.count]));
  const routes = rankRoutes(rs).map((r) =>
    (visits.get(r.b) ?? 0) > (visits.get(r.a) ?? 0) ? { ...r, a: r.b, b: r.a, airportA: r.airportB, airportB: r.airportA } : r,
  );
  const perYear = new Map<number, number>();
  for (const r of rs) perYear.set(r.year, (perYear.get(r.year) ?? 0) + 1);

  const sample = flown[0] ?? upcoming[0];
  const airline = key.startsWith('name:') ? getAirlineByName(key.slice(5)) : getAirline(key);
  const name = airline?.name ?? (sample ? flightAirlineName(sample) : undefined) ?? (key.startsWith('name:') ? key.slice(5) : key);
  const { first, last } = chronoEnds(rs);
  return {
    key,
    airline,
    name,
    iata: airline?.iata || sample?.airlineIata || (key.length === 2 ? key : undefined),
    icao: airline?.icao ?? sample?.airlineIcao,
    country: airline?.country ?? '',
    flights: flown,
    upcoming,
    share: totalFlights ? flown.length / totalFlights : 0,
    totalFlights,
    distanceKm: totals.distanceKm,
    durationMin: totals.durationMin,
    estimatedDuration: totals.estimatedDuration,
    firstFlight: first,
    lastFlight: last,
    routes,
    aircraft: rankAircraft(rs),
    airports,
    perYear: yearSeries(perYear, opts.today ? Number(opts.today.slice(0, 4)) : new Date().getFullYear()),
    cabin: cabinBreakdown(flown),
    seat: seatBreakdown(flown),
  };
}

// ---------- display helpers ----------

/** "San Diego, CA · United States" style place line for an airport header. */
export function airportPlace(a: Airport): { city: string; country: string } {
  const country = getCountry(a.country)?.name ?? a.country;
  const city = [a.city || a.name, a.country === 'US' || a.country === 'CA' || a.country === 'AU' ? a.region : ''].filter(Boolean).join(', ');
  return { city, country };
}

/** Minutes the airport's zone is ahead (+) or behind (−) the device at `at`. */
export function tzDeltaMinutes(tz: string, at: Date = new Date()): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const local = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes());
    return Math.round((zoned - local) / 60_000);
  } catch {
    return undefined;
  }
}

/** "Same time as you" / "3h ahead of you" / "5h 30m behind you". */
export function tzDeltaLabel(min: number | undefined): string | undefined {
  if (min === undefined) return undefined;
  if (min === 0) return 'Same time as you';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const span = h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
  return `${span} ${min > 0 ? 'ahead of' : 'behind'} you`;
}
