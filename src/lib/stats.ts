/**
 * Flight statistics: pure functions from `Flight[]` (+ reference lookups) to numbers.
 *
 * Everything here is synchronous and side-effect free; reference data must be loaded
 * (`loadReference()` / `useReferenceReady()`) for airport/country/continent lookups —
 * unknown airports degrade gracefully (they still count as flights, just without
 * distance/country information).
 *
 * Definitions (kept deliberately simple and documented so numbers are explainable):
 *
 * - **Domestic vs international**: a flight is *domestic* when both airports are in the
 *   same ISO 3166-1 country, regardless of the user's home country (this matches how
 *   Flightradar24 counts). Territories with their own ISO code (e.g. PR, GU) therefore
 *   count as international from the mainland. Flights with an unknown airport are
 *   neither (`unknownScope`).
 * - **Distance**: `flight.distanceKm` when cached, else the great-circle distance between
 *   the airports. Flights with unknown airports contribute 0 and are counted in
 *   `missingDistance`.
 * - **Time in the air**: `flight.durationMin` when known, else `estimateDurationMin(distance)`
 *   (cruise-speed estimate); the number of estimated flights is reported so the UI can
 *   say "≈". Flights with neither are counted in `missingDuration`.
 * - **Dates**: flights with `datePrecision` 'year' are excluded from month/weekday
 *   distributions and streaks; 'month' flights are excluded from weekday only.
 *   Hour-of-day uses `depTime` (local time at the origin) when present.
 * - **Continents**: two views are offered — *airports visited per continent* (unique
 *   airports) and *flights touching a continent* (a flight counts once for each distinct
 *   continent among its two endpoints, so intercontinental flights count for both).
 * - **CO₂**: see {@link co2PerPassengerKg}.
 */
import { getAircraftType, getAirline, getAirport, getCountry, normalize } from '@/data/reference';
import { airlineKey } from './flight-utils';
import { EARTH_CIRCUMFERENCE_KM, distanceKm as greatCircleKm, estimateDurationMin, kmToMiles } from './geo';
import { FLIGHT_OCCASIONS, OCCASION_LABELS, tripOccasion } from './occasions';
import type { Airport, CabinClass, Continent, Flight, FlightOccasion, FlightReason, SeatType } from './types';

export const MOON_DISTANCE_KM = 384_400;
export { EARTH_CIRCUMFERENCE_KM };

export const CABIN_CLASSES: CabinClass[] = ['economy', 'premium', 'business', 'first', 'private'];
export const SEAT_TYPES: SeatType[] = ['window', 'middle', 'aisle'];
export const FLIGHT_REASONS: FlightReason[] = ['leisure', 'business', 'crew', 'other'];
export const CONTINENTS: Continent[] = ['NA', 'EU', 'AS', 'SA', 'OC', 'AF', 'AN'];

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: 'Economy',
  premium: 'Premium economy',
  business: 'Business',
  first: 'First',
  private: 'Private',
};
export const SEAT_LABELS: Record<SeatType, string> = { window: 'Window', middle: 'Middle', aisle: 'Aisle' };
export const REASON_LABELS: Record<FlightReason, string> = { leisure: 'Leisure', business: 'Business', crew: 'Crew', other: 'Other' };
export const CONTINENT_NAMES: Record<Continent, string> = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
};
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Monday-first (ISO) weekday labels; index 0 = Monday. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---------------------------------------------------------------------------
// CO₂ model
// ---------------------------------------------------------------------------

/**
 * Economy-class CO₂ per passenger-km by haul band (kg/km, CO₂ only, no radiative forcing).
 * Short flights burn proportionally more fuel in take-off/climb, long flights are more
 * efficient per km. Values are rounded from the per-passenger factors published by the
 * ICAO Carbon Emissions Calculator and UK DEFRA/BEIS conversion factors (economy seats,
 * typical load factors) and land a typical mixed history at ~0.11–0.13 kg/km — the same
 * ballpark as Flightradar24 (~0.12 kg/km).
 */
export const CO2_BANDS = [
  { id: 'short', label: 'Short-haul', maxKm: 1500, kgPerKm: 0.14 },
  { id: 'medium', label: 'Medium-haul', maxKm: 4000, kgPerKm: 0.115 },
  { id: 'long', label: 'Long-haul', maxKm: Infinity, kgPerKm: 0.1 },
] as const;

/**
 * Cabin multipliers (share of the aircraft a seat occupies relative to economy), in line
 * with the ratios used by ICAO/DEFRA. Unknown cabin is treated as economy. Private flights
 * use a conservative business-jet multiplier.
 */
export const CO2_CABIN_MULTIPLIER: Record<CabinClass, number> = {
  economy: 1,
  premium: 1.5,
  business: 2.5,
  first: 3.5,
  private: 8,
};

/** Estimated CO₂ (kg) for one passenger on a flight of `km` in `cabin`. */
export function co2PerPassengerKg(km: number, cabin?: CabinClass): number {
  if (!(km > 0)) return 0;
  const band = CO2_BANDS.find((b) => km <= b.maxKm) ?? CO2_BANDS[CO2_BANDS.length - 1];
  return km * band.kgPerKm * CO2_CABIN_MULTIPLIER[cabin ?? 'economy'];
}

export function haulBand(km: number): 'short' | 'medium' | 'long' {
  return (CO2_BANDS.find((b) => km <= b.maxKm) ?? CO2_BANDS[2]).id;
}

// ---------------------------------------------------------------------------
// Per-flight resolution
// ---------------------------------------------------------------------------

export interface ResolvedFlight {
  flight: Flight;
  from?: Airport;
  to?: Airport;
  /** Canonical airport keys (ident when known, raw code otherwise). */
  fromKey: string;
  toKey: string;
  /** Great-circle km, undefined when an airport is unknown and nothing is cached. */
  distanceKm?: number;
  /** Known or estimated minutes; undefined when neither is possible. */
  durationMin?: number;
  durationEstimated: boolean;
  /** The recorded duration was ignored as physically implausible for the distance. */
  durationImplausible: boolean;
  year: number;
  /** 1–12 when the date has at least month precision. */
  month?: number;
  /** 0 = Monday … 6 = Sunday, only for day precision. */
  weekday?: number;
  /** Departure hour 0–23 from depTime. */
  hour?: number;
  /** undefined when an airport (or its country) is unknown. */
  international?: boolean;
  co2Kg: number;
  /** Sort key: date + depTime. */
  sortKey: string;
}

export function flightYear(f: Pick<Flight, 'date'>): number {
  return Number(f.date.slice(0, 4));
}

function parseHour(t: string | undefined): number | undefined {
  if (!t) return undefined;
  const m = /^(\d{1,2}):\d{2}/.exec(t);
  if (!m) return undefined;
  const h = Number(m[1]);
  return h >= 0 && h < 24 ? h : undefined;
}

/** ISO weekday (0 = Monday) of a YYYY-MM-DD date. */
export function isoWeekday(date: string): number | undefined {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return Number.isNaN(dow) ? undefined : (dow + 6) % 7;
}

/**
 * Sanity check for recorded durations (typically wrong time zones or day offsets in
 * imports): rejects average speeds above 1,100 km/h and times far beyond the cruise
 * estimate (more than 1.6× + 1 h). Such flights fall back to the estimate.
 */
export function isPlausibleDuration(min: number, km: number): boolean {
  if (!(min > 0)) return false;
  if (!(km > 0)) return true;
  if (km / (min / 60) > 1100) return false;
  return min <= estimateDurationMin(km) * 1.6 + 60;
}

export function resolveFlight(f: Flight): ResolvedFlight {
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const dist = f.distanceKm && f.distanceKm > 0 ? f.distanceKm : from && to ? greatCircleKm(from, to) : undefined;
  let durationMin: number | undefined = f.durationMin && f.durationMin > 0 ? f.durationMin : undefined;
  const durationImplausible = durationMin !== undefined && dist !== undefined && !isPlausibleDuration(durationMin, dist);
  if (durationImplausible) durationMin = undefined;
  let durationEstimated = false;
  if (durationMin === undefined && dist !== undefined && dist > 0) {
    durationMin = estimateDurationMin(dist);
    durationEstimated = true;
  }
  const precision = f.datePrecision ?? 'day';
  const monthNum = Number(f.date.slice(5, 7));
  return {
    flight: f,
    from,
    to,
    fromKey: from?.ident ?? (f.from || '').toUpperCase(),
    toKey: to?.ident ?? (f.to || '').toUpperCase(),
    distanceKm: dist,
    durationMin,
    durationEstimated,
    durationImplausible,
    year: flightYear(f),
    month: precision !== 'year' && monthNum >= 1 && monthNum <= 12 ? monthNum : undefined,
    weekday: precision === 'day' ? isoWeekday(f.date) : undefined,
    hour: parseHour(f.depTime),
    international: from?.country && to?.country ? from.country !== to.country : undefined,
    co2Kg: co2PerPassengerKg(dist ?? 0, f.cabinClass),
    sortKey: `${f.date}T${f.depTime ?? '00:00'}`,
  };
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

export type YearScope = 'all' | number;

/** Distinct years with flights, newest first. */
export function availableYears(flights: Flight[]): number[] {
  return [...new Set(flights.map(flightYear).filter((y) => Number.isFinite(y) && y > 0))].sort((a, b) => b - a);
}

export function filterByYear(flights: Flight[], scope: YearScope): Flight[] {
  return scope === 'all' ? flights : flights.filter((f) => flightYear(f) === scope);
}

// ---------------------------------------------------------------------------
// Keys & labels
// ---------------------------------------------------------------------------

export { airlineKey };

/** Stable aircraft key: ICAO type designator, else normalized name. */
export function aircraftKey(f: Pick<Flight, 'aircraftType' | 'aircraftName'>): string | undefined {
  if (f.aircraftType) return f.aircraftType.toUpperCase();
  if (f.aircraftName?.trim()) return `name:${normalize(f.aircraftName)}`;
  return undefined;
}

/** Direction-agnostic route key ("KLAX-KSFO", alphabetical). */
export function routeKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Regional-indicator flag emoji for an ISO alpha-2 code ('' for invalid codes). */
export function flagEmoji(code: string | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '';
  const up = code.toUpperCase();
  return String.fromCodePoint(...[...up].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface Totals {
  flights: number;
  domestic: number;
  international: number;
  unknownScope: number;
  distanceKm: number;
  distanceMi: number;
  /** Flights with no computable distance (unknown airports). */
  missingDistance: number;
  aroundEarth: number;
  /** Multiples of the Earth–Moon distance (0.54 = 54 % of the way). */
  toMoon: number;
  durationMin: number;
  /** Flights whose duration was estimated from distance. */
  estimatedDuration: number;
  /** Flights with neither a duration nor a distance. */
  missingDuration: number;
  days: number;
  weeks: number;
  co2Kg: number;
  avgDistanceKm: number;
  avgDurationMin: number;
}

export function computeTotals(rs: ResolvedFlight[]): Totals {
  let distanceKm = 0;
  let missingDistance = 0;
  let durationMin = 0;
  let estimatedDuration = 0;
  let missingDuration = 0;
  let domestic = 0;
  let international = 0;
  let co2Kg = 0;
  let withDist = 0;
  let withDur = 0;
  for (const r of rs) {
    if (r.distanceKm !== undefined) {
      distanceKm += r.distanceKm;
      withDist++;
    } else missingDistance++;
    if (r.durationMin !== undefined) {
      durationMin += r.durationMin;
      withDur++;
      if (r.durationEstimated) estimatedDuration++;
    } else missingDuration++;
    if (r.international === true) international++;
    else if (r.international === false) domestic++;
    co2Kg += r.co2Kg;
  }
  return {
    flights: rs.length,
    domestic,
    international,
    unknownScope: rs.length - domestic - international,
    distanceKm,
    distanceMi: kmToMiles(distanceKm),
    missingDistance,
    aroundEarth: distanceKm / EARTH_CIRCUMFERENCE_KM,
    toMoon: distanceKm / MOON_DISTANCE_KM,
    durationMin,
    estimatedDuration,
    missingDuration,
    days: durationMin / 1440,
    weeks: durationMin / 10080,
    co2Kg,
    avgDistanceKm: withDist ? distanceKm / withDist : 0,
    avgDurationMin: withDur ? durationMin / withDur : 0,
  };
}

// ---------------------------------------------------------------------------
// Categorical breakdowns
// ---------------------------------------------------------------------------

export interface CategoryCount<K extends string = string> {
  key: K;
  label: string;
  count: number;
  /** Share of the *known* values (0–1). */
  share: number;
}

export interface Breakdown<K extends string = string> {
  items: CategoryCount<K>[];
  known: number;
  unknown: number;
}

function breakdown<K extends string>(values: (K | undefined)[], order: readonly K[], labels: Record<K, string>): Breakdown<K> {
  const counts = new Map<K, number>();
  let unknown = 0;
  for (const v of values) {
    if (v && order.includes(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    else unknown++;
  }
  const known = values.length - unknown;
  return {
    items: order.map((key) => {
      const count = counts.get(key) ?? 0;
      return { key, label: labels[key], count, share: known ? count / known : 0 };
    }),
    known,
    unknown,
  };
}

export const cabinBreakdown = (flights: Flight[]) => breakdown(flights.map((f) => f.cabinClass), CABIN_CLASSES, CABIN_LABELS);
export const seatBreakdown = (flights: Flight[]) => breakdown(flights.map((f) => f.seatType), SEAT_TYPES, SEAT_LABELS);
export const reasonBreakdown = (flights: Flight[]) => breakdown(flights.map((f) => f.reason), FLIGHT_REASONS, REASON_LABELS);
/** Occasions count once per saved trip (its legs share one), and once per flight outside a trip. */
export function occasionBreakdown(flights: Flight[]): Breakdown<FlightOccasion> {
  const trips = new Map<string, Flight[]>();
  const values: (FlightOccasion | undefined)[] = [];
  for (const f of flights) {
    if (f.tripId) trips.set(f.tripId, [...(trips.get(f.tripId) ?? []), f]);
    else values.push(f.occasion);
  }
  for (const legs of trips.values()) values.push(tripOccasion({ flights: legs }));
  return breakdown(values, FLIGHT_OCCASIONS, OCCASION_LABELS);
}

export function scopeBreakdown(rs: ResolvedFlight[]): Breakdown<'domestic' | 'international'> {
  return breakdown(
    rs.map((r) => (r.international === undefined ? undefined : r.international ? 'international' : 'domestic')),
    ['domestic', 'international'] as const,
    { domestic: 'Domestic', international: 'International' },
  );
}

export function haulBreakdown(rs: ResolvedFlight[]): Breakdown<'short' | 'medium' | 'long'> {
  return breakdown(
    rs.map((r) => (r.distanceKm === undefined ? undefined : haulBand(r.distanceKm))),
    ['short', 'medium', 'long'] as const,
    { short: 'Short-haul (<1,500 km)', medium: 'Medium-haul', long: 'Long-haul (>4,000 km)' },
  );
}

export type Manufacturer = 'boeing' | 'airbus' | 'embraer' | 'bombardier' | 'other';
export const MANUFACTURERS: Manufacturer[] = ['boeing', 'airbus', 'embraer', 'bombardier', 'other'];
export const MANUFACTURER_LABELS: Record<Manufacturer, string> = {
  boeing: 'Boeing',
  airbus: 'Airbus',
  embraer: 'Embraer',
  bombardier: 'Bombardier & DHC',
  other: 'Other',
};

/** Airframe maker from an aircraft name/type ("Boeing 737-800", "A320", "CRJ9"). */
export function aircraftManufacturer(f: Pick<Flight, 'aircraftType' | 'aircraftName'>): Manufacturer | undefined {
  const name = `${getAircraftType(f.aircraftType)?.name ?? ''} ${f.aircraftName ?? ''}`.toLowerCase();
  const type = (f.aircraftType ?? '').toUpperCase();
  if (!name.trim() && !type) return undefined;
  if (/\bboeing\b/.test(name) || /^B7\d/.test(type) || /^B3[89]M$/.test(type)) return 'boeing';
  if (/\bairbus\b/.test(name) || /^A3[0-5]/.test(type) || /^BCS[13]$/.test(type)) return 'airbus';
  if (/\bembraer\b/.test(name) || /^E(1|7|9|29)/.test(type)) return 'embraer';
  if (/bombardier|canadair|de havilland canada|\bdash 8\b/.test(name) || /^(CRJ|DH8)/.test(type)) return 'bombardier';
  return 'other';
}

export function manufacturerBreakdown(flights: Flight[]): Breakdown<Manufacturer> {
  return breakdown(flights.map(aircraftManufacturer), MANUFACTURERS, MANUFACTURER_LABELS);
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface CountryVisit {
  code: string;
  name: string;
  flag: string;
  continent?: Continent;
  /** Flights touching this country (departing, arriving or both). */
  flights: number;
  airports: number;
  firstDate: string;
}

/** Countries of all known airports, most-flown first. */
export function countriesVisited(rs: ResolvedFlight[]): CountryVisit[] {
  const map = new Map<string, { flights: number; airports: Set<string>; firstDate: string }>();
  for (const r of rs) {
    const touched = new Set<string>();
    for (const ap of [r.from, r.to]) {
      if (!ap?.country) continue;
      let e = map.get(ap.country);
      if (!e) map.set(ap.country, (e = { flights: 0, airports: new Set(), firstDate: r.flight.date }));
      e.airports.add(ap.ident);
      if (r.flight.date < e.firstDate) e.firstDate = r.flight.date;
      touched.add(ap.country);
    }
    for (const c of touched) map.get(c)!.flights++;
  }
  return [...map.entries()]
    .map(([code, e]) => {
      const c = getCountry(code);
      return { code, name: c?.name ?? code, flag: flagEmoji(code), continent: c?.continent, flights: e.flights, airports: e.airports.size, firstDate: e.firstDate };
    })
    .sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name));
}

export interface ContinentStat {
  continent: Continent;
  name: string;
  /** Unique airports visited on this continent. */
  airports: number;
  /** Flights with at least one endpoint on this continent. */
  flights: number;
  countries: number;
}

export function continentStats(rs: ResolvedFlight[]): ContinentStat[] {
  const airports = new Map<Continent, Set<string>>();
  const countries = new Map<Continent, Set<string>>();
  const flights = new Map<Continent, number>();
  for (const r of rs) {
    const touched = new Set<Continent>();
    for (const ap of [r.from, r.to]) {
      const cont = getCountry(ap?.country)?.continent;
      if (!ap || !cont) continue;
      if (!airports.has(cont)) airports.set(cont, new Set());
      if (!countries.has(cont)) countries.set(cont, new Set());
      airports.get(cont)!.add(ap.ident);
      countries.get(cont)!.add(ap.country);
      touched.add(cont);
    }
    for (const c of touched) flights.set(c, (flights.get(c) ?? 0) + 1);
  }
  return CONTINENTS.filter((c) => airports.has(c))
    .map((c) => ({ continent: c, name: CONTINENT_NAMES[c], airports: airports.get(c)!.size, flights: flights.get(c) ?? 0, countries: countries.get(c)!.size }))
    .sort((a, b) => b.flights - a.flights || b.airports - a.airports);
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export interface RankedAirport {
  key: string;
  airport?: Airport;
  /** Departures + arrivals. */
  count: number;
  departures: number;
  arrivals: number;
}

export interface RankedAirline {
  key: string;
  icao?: string;
  iata?: string;
  name: string;
  count: number;
  distanceKm: number;
}

export interface RankedAircraft {
  key: string;
  icao?: string;
  name: string;
  count: number;
  distanceKm: number;
}

export interface RankedRoute {
  key: string;
  /** Endpoint keys in alphabetical order (direction-agnostic). */
  a: string;
  b: string;
  airportA?: Airport;
  airportB?: Airport;
  count: number;
  distanceKm?: number;
}

export interface RankedRegistration {
  key: string;
  count: number;
  aircraftType?: string;
  aircraftName?: string;
  airlineName?: string;
  airlineIata?: string;
  airlineIcao?: string;
  /** Most recent flight on this airframe. */
  lastFlightId: string;
}

const byCount = <T extends { count: number }>(sortLabel: (t: T) => string) => (a: T, b: T) => b.count - a.count || sortLabel(a).localeCompare(sortLabel(b));

export function rankAirports(rs: ResolvedFlight[]): RankedAirport[] {
  const map = new Map<string, RankedAirport>();
  const touch = (key: string, ap: Airport | undefined, dir: 'departures' | 'arrivals') => {
    if (!key) return;
    let e = map.get(key);
    if (!e) map.set(key, (e = { key, airport: ap, count: 0, departures: 0, arrivals: 0 }));
    e[dir]++;
    e.count++;
  };
  for (const r of rs) {
    touch(r.fromKey, r.from, 'departures');
    touch(r.toKey, r.to, 'arrivals');
  }
  return [...map.values()].sort(byCount((e) => e.airport?.iata || e.key));
}

export function rankAirlines(rs: ResolvedFlight[]): RankedAirline[] {
  const map = new Map<string, RankedAirline>();
  for (const r of rs) {
    const f = r.flight;
    const key = airlineKey(f);
    if (!key) continue;
    let e = map.get(key);
    if (!e) {
      const ref = getAirline(f.airlineIcao) ?? getAirline(f.airlineIata);
      map.set(
        key,
        (e = {
          key,
          icao: ref?.icao ?? f.airlineIcao,
          iata: ref?.iata || f.airlineIata,
          name: ref?.name ?? f.airlineName ?? f.airlineIata ?? f.airlineIcao ?? key,
          count: 0,
          distanceKm: 0,
        }),
      );
    }
    e.count++;
    e.distanceKm += r.distanceKm ?? 0;
  }
  return [...map.values()].sort(byCount((e) => e.name));
}

export function rankAircraft(rs: ResolvedFlight[]): RankedAircraft[] {
  const map = new Map<string, RankedAircraft>();
  for (const r of rs) {
    const f = r.flight;
    const key = aircraftKey(f);
    if (!key) continue;
    let e = map.get(key);
    if (!e) {
      const ref = getAircraftType(f.aircraftType);
      map.set(key, (e = { key, icao: ref?.icao ?? f.aircraftType?.toUpperCase(), name: ref?.name ?? f.aircraftName ?? f.aircraftType ?? key, count: 0, distanceKm: 0 }));
    }
    e.count++;
    e.distanceKm += r.distanceKm ?? 0;
  }
  return [...map.values()].sort(byCount((e) => e.name));
}

export function rankRoutes(rs: ResolvedFlight[]): RankedRoute[] {
  const map = new Map<string, RankedRoute>();
  for (const r of rs) {
    if (!r.fromKey || !r.toKey) continue;
    const key = routeKey(r.fromKey, r.toKey);
    let e = map.get(key);
    if (!e) {
      const [a, b] = r.fromKey < r.toKey ? [r.fromKey, r.toKey] : [r.toKey, r.fromKey];
      const [apA, apB] = r.fromKey < r.toKey ? [r.from, r.to] : [r.to, r.from];
      map.set(key, (e = { key, a, b, airportA: apA, airportB: apB, count: 0, distanceKm: r.distanceKm }));
    }
    e.count++;
  }
  return [...map.values()].sort(byCount((e) => e.key));
}

export function rankRegistrations(rs: ResolvedFlight[]): RankedRegistration[] {
  const map = new Map<string, RankedRegistration & { lastSort: string }>();
  for (const r of rs) {
    const f = r.flight;
    const reg = f.registration?.trim().toUpperCase();
    if (!reg) continue;
    let e = map.get(reg);
    if (!e) map.set(reg, (e = { key: reg, count: 0, lastFlightId: f.id, lastSort: '' }));
    e.count++;
    if (r.sortKey >= e.lastSort) {
      e.lastSort = r.sortKey;
      e.lastFlightId = f.id;
      e.aircraftType = f.aircraftType ?? e.aircraftType;
      e.aircraftName = f.aircraftName ?? getAircraftType(f.aircraftType)?.name ?? e.aircraftName;
      const al = getAirline(f.airlineIcao) ?? getAirline(f.airlineIata);
      e.airlineName = al?.name ?? f.airlineName ?? e.airlineName;
      e.airlineIata = al?.iata || f.airlineIata || e.airlineIata;
      e.airlineIcao = al?.icao ?? f.airlineIcao ?? e.airlineIcao;
    }
  }
  return [...map.values()].map(({ lastSort: _ignored, ...rest }) => rest).sort(byCount((e) => e.key));
}

// ---------------------------------------------------------------------------
// Time distributions
// ---------------------------------------------------------------------------

export interface YearBucket {
  year: number;
  flights: number;
  distanceKm: number;
  durationMin: number;
  co2Kg: number;
}

/** One bucket per calendar year from the first to the last year (gaps filled with zeros). */
export function flightsByYear(rs: ResolvedFlight[]): YearBucket[] {
  if (!rs.length) return [];
  const years = rs.map((r) => r.year).filter((y) => Number.isFinite(y) && y > 0);
  if (!years.length) return [];
  const min = Math.min(...years);
  const max = Math.max(...years);
  const out: YearBucket[] = [];
  for (let y = min; y <= max; y++) out.push({ year: y, flights: 0, distanceKm: 0, durationMin: 0, co2Kg: 0 });
  for (const r of rs) {
    const b = out[r.year - min];
    if (!b) continue;
    b.flights++;
    b.distanceKm += r.distanceKm ?? 0;
    b.durationMin += r.durationMin ?? 0;
    b.co2Kg += r.co2Kg;
  }
  return out;
}

export interface MonthBucket {
  /** 1–12 */
  month: number;
  flights: number;
  distanceKm: number;
  durationMin: number;
}

/** Flights per calendar month (Jan–Dec), ignoring year-precision dates. */
export function flightsByMonth(rs: ResolvedFlight[]): MonthBucket[] {
  const out: MonthBucket[] = MONTH_LABELS.map((_, i) => ({ month: i + 1, flights: 0, distanceKm: 0, durationMin: 0 }));
  for (const r of rs) {
    if (!r.month) continue;
    const b = out[r.month - 1];
    b.flights++;
    b.distanceKm += r.distanceKm ?? 0;
    b.durationMin += r.durationMin ?? 0;
  }
  return out;
}

/** Flights per ISO weekday (index 0 = Monday), day-precision dates only. */
export function flightsByWeekday(rs: ResolvedFlight[]): number[] {
  const out = new Array(7).fill(0) as number[];
  for (const r of rs) if (r.weekday !== undefined) out[r.weekday]++;
  return out;
}

/** Departures per local hour of day (0–23), flights with a departure time only. */
export function flightsByHour(rs: ResolvedFlight[]): number[] {
  const out = new Array(24).fill(0) as number[];
  for (const r of rs) if (r.hour !== undefined) out[r.hour]++;
  return out;
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface FlightRecord {
  flight: Flight;
  value: number;
  estimated?: boolean;
}

export interface Records {
  longestDistance?: FlightRecord;
  shortestDistance?: FlightRecord;
  longestDuration?: FlightRecord;
  shortestDuration?: FlightRecord;
  first?: Flight;
  latest?: Flight;
  busiestYear?: { year: number; flights: number };
  /** month = "YYYY-MM" */
  busiestMonth?: { month: string; flights: number };
  /** Most flights on a single calendar day. */
  busiestDay?: { date: string; flights: number };
  /** Longest run of consecutive calendar months with ≥1 flight (start/end = "YYYY-MM"). */
  longestMonthStreak?: { months: number; start: string; end: string };
  mostFlownRoute?: RankedRoute;
  mostVisitedAirport?: RankedAirport;
}

function extreme(rs: ResolvedFlight[], pick: (r: ResolvedFlight) => number | undefined, dir: 1 | -1): ResolvedFlight | undefined {
  let best: ResolvedFlight | undefined;
  let bestV = 0;
  for (const r of rs) {
    const v = pick(r);
    if (v === undefined || !(v > 0)) continue;
    // Ties go to the earliest flight so records are stable.
    if (!best || v * dir > bestV * dir || (v === bestV && r.sortKey < best.sortKey)) {
      best = r;
      bestV = v;
    }
  }
  return best;
}

/** Number of months between two "YYYY-MM" keys (b − a). */
function monthIndex(ym: string): number {
  return Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
}

export function longestMonthStreak(rs: ResolvedFlight[]): Records['longestMonthStreak'] {
  const months = [...new Set(rs.filter((r) => r.month).map((r) => r.flight.date.slice(0, 7)))].sort();
  if (!months.length) return undefined;
  let best = { months: 1, start: months[0], end: months[0] };
  let runStart = months[0];
  let runLen = 1;
  for (let i = 1; i < months.length; i++) {
    if (monthIndex(months[i]) - monthIndex(months[i - 1]) === 1) runLen++;
    else {
      runLen = 1;
      runStart = months[i];
    }
    if (runLen > best.months) best = { months: runLen, start: runStart, end: months[i] };
  }
  return best;
}

export function computeRecords(rs: ResolvedFlight[], ranked?: { routes?: RankedRoute[]; airports?: RankedAirport[] }): Records {
  if (!rs.length) return {};
  const rec: Records = {};
  const toRecord = (r: ResolvedFlight | undefined, v: (r: ResolvedFlight) => number | undefined, est = false): FlightRecord | undefined =>
    r ? { flight: r.flight, value: v(r)!, ...(est ? { estimated: r.durationEstimated } : {}) } : undefined;

  const dist = (r: ResolvedFlight) => r.distanceKm;
  rec.longestDistance = toRecord(extreme(rs, dist, 1), dist);
  rec.shortestDistance = toRecord(extreme(rs, dist, -1), dist);

  // Duration records prefer real durations; fall back to estimates only when none exist.
  const actual = rs.filter((r) => r.durationMin !== undefined && !r.durationEstimated);
  const durPool = actual.length ? actual : rs;
  const dur = (r: ResolvedFlight) => r.durationMin;
  rec.longestDuration = toRecord(extreme(durPool, dur, 1), dur, true);
  rec.shortestDuration = toRecord(extreme(durPool, dur, -1), dur, true);

  const sorted = [...rs].sort((a, b) => a.sortKey.localeCompare(b.sortKey) || a.flight.createdAt - b.flight.createdAt);
  rec.first = sorted[0].flight;
  rec.latest = sorted[sorted.length - 1].flight;

  const years = flightsByYear(rs).filter((y) => y.flights > 0);
  if (years.length) {
    const by = years.reduce((a, b) => (b.flights > a.flights ? b : a));
    rec.busiestYear = { year: by.year, flights: by.flights };
  }

  const monthCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  for (const r of rs) {
    if (r.month) monthCounts.set(r.flight.date.slice(0, 7), (monthCounts.get(r.flight.date.slice(0, 7)) ?? 0) + 1);
    if (r.weekday !== undefined) dayCounts.set(r.flight.date, (dayCounts.get(r.flight.date) ?? 0) + 1);
  }
  const maxEntry = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const bm = maxEntry(monthCounts);
  if (bm) rec.busiestMonth = { month: bm[0], flights: bm[1] };
  const bd = maxEntry(dayCounts);
  if (bd && bd[1] > 1) rec.busiestDay = { date: bd[0], flights: bd[1] };

  rec.longestMonthStreak = longestMonthStreak(rs);
  rec.mostFlownRoute = (ranked?.routes ?? rankRoutes(rs))[0];
  rec.mostVisitedAirport = (ranked?.airports ?? rankAirports(rs))[0];
  return rec;
}

// ---------------------------------------------------------------------------
// Insights (short, human sentences derived from the numbers)
// ---------------------------------------------------------------------------

export interface Insight {
  id: string;
  title: string;
  detail: string;
  /** What the sentence is about, for picking an icon: seat type, weekday (mon…sun), part of day or reason. */
  kind?: string;
}

export function computeInsights(
  s: Pick<FlightStats, 'totals' | 'seat' | 'weekday' | 'hour' | 'cabin' | 'reason' | 'haul'>,
  unit: 'mi' | 'km' = 'km',
  audience: StatsOptions['audience'] = 'owner',
): Insight[] {
  const out: Insight[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const topOf = <K extends string>(b: Breakdown<K>) => [...b.items].sort((a, c) => c.count - a.count)[0];

  if (s.seat.known >= 3) {
    const top = topOf(s.seat);
    if (top && top.share >= 0.45) out.push({ id: 'seat', kind: top.key, title: `${top.label} seat person`, detail: `${pct(top.share)} of flights with a known seat` });
  }
  const weekdayTotal = s.weekday.reduce((a, b) => a + b, 0);
  if (weekdayTotal >= 5) {
    const max = Math.max(...s.weekday);
    const i = s.weekday.indexOf(max);
    const full = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][i];
    out.push({ id: 'weekday', kind: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][i], title: `${full} are for flying`, detail: `${pct(max / weekdayTotal)} of ${audience === 'visitor' ? '' : 'your '}flights depart on a ${full.slice(0, -1)}` });
  }
  const hourTotal = s.hour.reduce((a, b) => a + b, 0);
  if (hourTotal >= 5) {
    const morning = s.hour.slice(5, 12).reduce((a, b) => a + b, 0);
    const afternoon = s.hour.slice(12, 18).reduce((a, b) => a + b, 0);
    const evening = hourTotal - morning - afternoon;
    const [label, n] = ([
      ['Early bird', morning],
      ['Afternoon flyer', afternoon],
      ['Night owl', evening],
    ] as const).reduce((a, b) => (b[1] > a[1] ? b : a));
    const when = label === 'Early bird' ? 'before noon' : label === 'Afternoon flyer' ? 'between noon and 6 PM' : 'after 6 PM';
    out.push({ id: 'hour', kind: label === 'Early bird' ? 'morning' : label === 'Afternoon flyer' ? 'afternoon' : 'evening', title: label, detail: `${pct(n / hourTotal)} of departures ${when}` });
  }
  if (s.reason.known >= 3) {
    const top = topOf(s.reason);
    if (top && top.share >= 0.5) out.push({ id: 'reason', kind: top.key, title: top.key === 'business' ? 'Road warrior' : top.key === 'leisure' ? 'Here for the adventures' : `Mostly ${top.label.toLowerCase()}`, detail: `${pct(top.share)} of trips were ${top.label.toLowerCase()}` });
  }
  if (s.haul.known >= 3) {
    const long = s.haul.items.find((i) => i.key === 'long')!;
    if (long.count > 0) out.push({ id: 'haul', title: `${long.count} long-haul ${long.count === 1 ? 'flight' : 'flights'}`, detail: `${pct(long.share)} of flights over ${unit === 'mi' ? '2,485 mi' : '4,000 km'}` });
  }
  const premium = s.cabin.items.filter((i) => i.key !== 'economy').reduce((a, b) => a + b.count, 0);
  if (s.cabin.known >= 3 && premium > 0) out.push({ id: 'cabin', title: `${premium} up front`, detail: `${pct(premium / s.cabin.known)} of flights above economy` });
  return out;
}

export function emissionsSplit(rs: ResolvedFlight[]): FlightStats['emissions'] {
  const byHaul = { short: 0, medium: 0, long: 0 };
  const byCabin: Record<CabinClass | 'unknown', number> = { economy: 0, premium: 0, business: 0, first: 0, private: 0, unknown: 0 };
  for (const r of rs) {
    if (!r.co2Kg || r.distanceKm === undefined) continue;
    byHaul[haulBand(r.distanceKm)] += r.co2Kg;
    byCabin[r.flight.cabinClass ?? 'unknown'] += r.co2Kg;
  }
  return { byHaul, byCabin };
}

// ---------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------

export interface StatsOptions {
  /** ISO country code of the user's home (Settings.homeCountry). */
  homeCountry?: string;
  /** Unit for distances quoted in insight sentences (default km). */
  distanceUnit?: 'mi' | 'km';
  /** Who reads the sentences: the log's owner ("your flights") or a visitor (neutral). */
  audience?: 'owner' | 'visitor';
}

export interface FlightStats {
  totals: Totals;
  scope: Breakdown<'domestic' | 'international'>;
  cabin: Breakdown<CabinClass>;
  seat: Breakdown<SeatType>;
  reason: Breakdown<FlightReason>;
  occasion: Breakdown<FlightOccasion>;
  haul: Breakdown<'short' | 'medium' | 'long'>;
  manufacturer: Breakdown<Manufacturer>;
  countries: CountryVisit[];
  /** Countries other than the home country. */
  countriesAbroad: number;
  continents: ContinentStat[];
  airports: RankedAirport[];
  airlines: RankedAirline[];
  aircraft: RankedAircraft[];
  routes: RankedRoute[];
  registrations: RankedRegistration[];
  unique: { airports: number; airlines: number; aircraft: number; registrations: number; routes: number; countries: number; continents: number };
  byYear: YearBucket[];
  byMonth: MonthBucket[];
  weekday: number[];
  hour: number[];
  records: Records;
  insights: Insight[];
  /** CO₂ (kg) split by haul band and by cabin ('unknown' = no cabin recorded, modelled as economy). */
  emissions: { byHaul: Record<'short' | 'medium' | 'long', number>; byCabin: Record<CabinClass | 'unknown', number> };
  /** Data-quality counters for footnotes. */
  quality: { unknownAirports: number; yearPrecision: number; monthPrecision: number; noDepTime: number; implausibleDuration: number };
}

export function computeStats(flights: Flight[], opts: StatsOptions = {}): FlightStats {
  const rs = flights.map(resolveFlight);
  const totals = computeTotals(rs);
  const countries = countriesVisited(rs);
  const continents = continentStats(rs);
  const airports = rankAirports(rs);
  const airlines = rankAirlines(rs);
  const aircraft = rankAircraft(rs);
  const routes = rankRoutes(rs);
  const registrations = rankRegistrations(rs);
  const home = opts.homeCountry?.toUpperCase();
  const partial = {
    totals,
    seat: seatBreakdown(flights),
    cabin: cabinBreakdown(flights),
    reason: reasonBreakdown(flights),
    occasion: occasionBreakdown(flights),
    haul: haulBreakdown(rs),
    weekday: flightsByWeekday(rs),
    hour: flightsByHour(rs),
  };
  const unknownAirportKeys = new Set<string>();
  for (const r of rs) {
    if (!r.from && r.fromKey) unknownAirportKeys.add(r.fromKey);
    if (!r.to && r.toKey) unknownAirportKeys.add(r.toKey);
  }
  return {
    ...partial,
    scope: scopeBreakdown(rs),
    manufacturer: manufacturerBreakdown(flights),
    countries,
    countriesAbroad: countries.filter((c) => c.code !== home).length,
    continents,
    airports,
    airlines,
    aircraft,
    routes,
    registrations,
    unique: {
      airports: airports.length,
      airlines: airlines.length,
      aircraft: aircraft.length,
      registrations: registrations.length,
      routes: routes.length,
      countries: countries.length,
      continents: continents.length,
    },
    byYear: flightsByYear(rs),
    byMonth: flightsByMonth(rs),
    records: computeRecords(rs, { routes, airports }),
    insights: computeInsights(partial, opts.distanceUnit, opts.audience),
    emissions: emissionsSplit(rs),
    quality: {
      unknownAirports: unknownAirportKeys.size,
      yearPrecision: flights.filter((f) => f.datePrecision === 'year').length,
      monthPrecision: flights.filter((f) => f.datePrecision === 'month').length,
      noDepTime: rs.filter((r) => r.hour === undefined).length,
      implausibleDuration: rs.filter((r) => r.durationImplausible).length,
    },
  };
}

/** Convenience: totals straight from flights. */
export function summarizeTotals(flights: Flight[]): Totals {
  return computeTotals(flights.map(resolveFlight));
}
