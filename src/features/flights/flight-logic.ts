/**
 * Pure logic for the flight list and detail screens: search, filters, grouping,
 * summary stats, countdowns and per-flight history. Reference lookups are sync
 * (they return undefined until reference data has loaded), so callers should
 * re-run these once `useReferenceReady()` flips.
 */
import { getAirline, getAirport, getCountry, normalize } from '@/data/reference';
import { airlineKey, airportCode, flightAircraftName, flightAirlineName, flightDistanceKm, parseFlightNumber } from '@/lib/flight-utils';
import { estimateDurationMin, kmToMiles } from '@/lib/geo';
import { zonedToUtc } from '@/lib/time';
import type { CabinClass, Flight, FlightReason, Settings } from '@/lib/types';

// ---------- formatting ----------

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "1,234 mi" / "1,986 km". */
export function formatDistance(km: number | undefined, unit: Settings['distanceUnit'], withUnit = true): string {
  if (km === undefined || !Number.isFinite(km)) return '—';
  const v = unit === 'mi' ? kmToMiles(km) : km;
  return withUnit ? `${nf.format(v)} ${unit}` : nf.format(v);
}

/** Compact large numbers: 12,400 → "12.4k", 1,250,000 → "1.25M". */
export function formatCompact(n: number): string {
  if (n < 10_000) return nf.format(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
}

/** Total minutes as "12d 4h" / "18h 20m". */
export function formatLongDuration(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0h';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${String(Math.round(min % 60)).padStart(2, '0')}m`;
}

/** Short tz abbreviation at a given local wall time, e.g. "PDT", "GMT+1". */
export function tzAbbrev(date: string, time: string | undefined, tz: string | undefined): string {
  if (!tz) return '';
  try {
    const at = zonedToUtc(date, time && /^\d\d:\d\d$/.test(time) ? time : '12:00', tz);
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(at))
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

// ---------- upcoming ----------

export { departureInstant, isUpcoming } from '@/lib/flight-utils';
import { isUpcoming } from '@/lib/flight-utils';

/** Splits into upcoming (soonest first) and past (newest first; input order preserved). */
export function splitUpcoming(flights: Flight[], now: number, today: string): { upcoming: Flight[]; past: Flight[] } {
  const upcoming: Flight[] = [];
  const past: Flight[] = [];
  for (const f of flights) (isUpcoming(f, now, today) ? upcoming : past).push(f);
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? ''));
  return { upcoming, past };
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** "Today" / "Tomorrow" / "in 3 days" / "in 2 weeks" / "in 4 months". */
export function countdownLabel(date: string, today: string): string {
  const days = dayNumber(date) - dayNumber(today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 365) return `in ${Math.round(days / 30.44)} months`;
  const y = Math.round(days / 365);
  return y === 1 ? 'in a year' : `in ${y} years`;
}

// ---------- search & filters ----------

/** Stable key for grouping/filtering by airline (same normalization as stats). */
export { airlineKey };

// "United States"/"United Kingdom" would make "united" match every flight there, not United Airlines.
const COUNTRY_ALIASES: Record<string, string> = { US: 'USA America', GB: 'UK Britain England Scotland', AE: 'UAE Emirates' };
function countrySearchName(code: string): string | undefined {
  return COUNTRY_ALIASES[code] ?? getCountry(code)?.name;
}

/** Normalized text blob covering everything the search box should match. */
export function flightSearchText(f: Flight): string {
  const parts: (string | undefined)[] = [f.flightNumber, f.registration, f.aircraftType, flightAircraftName(f), f.note, f.seatNumber];
  const fn = parseFlightNumber(f.flightNumber);
  if (fn) parts.push(`${fn.prefix} ${fn.number}`);
  const airline = getAirline(f.airlineIcao) ?? getAirline(f.airlineIata);
  parts.push(f.airlineIcao, f.airlineIata, f.airlineName, airline?.name);
  for (const ident of [f.from, f.to]) {
    const a = getAirport(ident);
    parts.push(ident);
    if (a) parts.push(a.iata, a.city, a.name, countrySearchName(a.country));
  }
  if (f.registration) parts.push(f.registration.replace(/-/g, ''));
  return ` ${normalize(parts.filter(Boolean).join(' '))} `;
}

/** Every whitespace-separated term must occur (as a word prefix) in the text. */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return q.split(' ').every((t) => text.includes(` ${t}`));
}

export interface FlightFilters {
  year?: string;
  airline?: string;
  airport?: string;
  cabin?: CabinClass;
  reason?: FlightReason;
}

export function activeFilterCount(f: FlightFilters): number {
  return Object.values(f).filter(Boolean).length;
}

export function matchesFilters(f: Flight, filters: FlightFilters): boolean {
  if (filters.year && !f.date.startsWith(filters.year)) return false;
  if (filters.airline && airlineKey(f) !== filters.airline) return false;
  if (filters.airport && f.from !== filters.airport && f.to !== filters.airport) return false;
  if (filters.cabin && f.cabinClass !== filters.cabin) return false;
  if (filters.reason && f.reason !== filters.reason) return false;
  return true;
}

export interface FilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterOptions {
  years: FilterOption[];
  airlines: FilterOption[];
  airports: FilterOption[];
  cabins: FilterOption[];
  reasons: FilterOption[];
}

const CABIN_LABEL: Record<CabinClass, string> = {
  economy: 'Economy',
  premium: 'Premium economy',
  business: 'Business',
  first: 'First',
  private: 'Private',
};
const REASON_LABEL: Record<FlightReason, string> = { leisure: 'Leisure', business: 'Business', crew: 'Crew', other: 'Other' };

export const cabinLabel = (c: CabinClass | undefined) => (c ? CABIN_LABEL[c] : undefined);
export const reasonLabel = (r: FlightReason | undefined) => (r ? REASON_LABEL[r] : undefined);

function tally<K extends string>(items: (K | undefined)[]): Map<K, number> {
  const m = new Map<K, number>();
  for (const k of items) if (k) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

/** Options for each filter chip, derived from the user's flights (most frequent first). */
export function filterOptions(flights: Flight[]): FilterOptions {
  const byCount = (a: FilterOption, b: FilterOption) => b.count - a.count || a.label.localeCompare(b.label);

  const years = [...tally(flights.map((f) => f.date.slice(0, 4)))]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.value.localeCompare(a.value));

  const airlineNames = new Map<string, string>();
  for (const f of flights) {
    const k = airlineKey(f);
    if (k && !airlineNames.has(k)) airlineNames.set(k, flightAirlineName(f) ?? k);
  }
  const airlines = [...tally(flights.map(airlineKey))].map(([value, count]) => ({ value, label: airlineNames.get(value) ?? value, count })).sort(byCount);

  const airports = [...tally(flights.flatMap((f) => [f.from, f.to]))]
    .map(([value, count]) => {
      const a = getAirport(value);
      return { value, label: a ? `${airportCode(value)} · ${a.city || a.name}` : value, count };
    })
    .sort(byCount);

  const cabins = [...tally(flights.map((f) => f.cabinClass))].map(([value, count]) => ({ value, label: CABIN_LABEL[value], count })).sort(byCount);
  const reasons = [...tally(flights.map((f) => f.reason))].map(([value, count]) => ({ value, label: REASON_LABEL[value], count })).sort(byCount);

  return { years, airlines, airports, cabins, reasons };
}

// ---------- grouping ----------

export interface MonthGroup {
  /** "2024-03", or "2024-??" for year-precision flights. */
  key: string;
  label: string;
  flights: Flight[];
}

export interface YearGroup {
  year: string;
  count: number;
  distanceKm: number;
  months: MonthGroup[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Groups flights (already sorted newest first) by year → month, keeping order. */
export function groupFlights(flights: Flight[]): YearGroup[] {
  const years: YearGroup[] = [];
  const yearIndex = new Map<string, YearGroup>();
  const monthIndex = new Map<string, MonthGroup>();
  for (const f of flights) {
    const year = f.date.slice(0, 4);
    let y = yearIndex.get(year);
    if (!y) {
      y = { year, count: 0, distanceKm: 0, months: [] };
      yearIndex.set(year, y);
      years.push(y);
    }
    y.count++;
    y.distanceKm += flightDistanceKm(f) ?? 0;
    const known = f.datePrecision !== 'year';
    const key = known ? f.date.slice(0, 7) : `${year}-??`;
    let m = monthIndex.get(key);
    if (!m) {
      m = { key, label: known ? MONTHS[Number(f.date.slice(5, 7)) - 1] : 'Date unknown', flights: [] };
      monthIndex.set(key, m);
      y.months.push(m);
    }
    m.flights.push(f);
  }
  // Keep "Date unknown" at the end of its year.
  for (const y of years) y.months.sort((a, b) => (a.key.endsWith('??') ? 1 : 0) - (b.key.endsWith('??') ? 1 : 0));
  return years;
}

// ---------- summary ----------

export interface FlightSummary {
  flights: number;
  distanceKm: number;
  minutes: number;
  airports: number;
  countries: number;
  airlines: number;
  thisYear: number;
  year: string;
  firstYear?: string;
  /** Flights per calendar year from the first year through the current year. */
  perYear: { year: string; count: number }[];
}

export function flightMinutes(f: Flight): number {
  if (f.durationMin) return f.durationMin;
  const km = flightDistanceKm(f);
  return km ? estimateDurationMin(km) : 0;
}

/** Summary of flown (past) flights. */
export function computeSummary(flights: Flight[], today: string): FlightSummary {
  const year = today.slice(0, 4);
  let distanceKm = 0;
  let minutes = 0;
  let thisYear = 0;
  const airports = new Set<string>();
  const countries = new Set<string>();
  const airlines = new Set<string>();
  const perYearMap = new Map<string, number>();
  for (const f of flights) {
    distanceKm += flightDistanceKm(f) ?? 0;
    minutes += flightMinutes(f);
    for (const id of [f.from, f.to]) {
      const a = getAirport(id);
      // Same identity as stats: "LAX" and "KLAX" are one airport.
      const key = a?.ident ?? (id || '').toUpperCase();
      if (key) airports.add(key);
      if (a?.country) countries.add(a.country);
    }
    const ak = airlineKey(f);
    if (ak) airlines.add(ak);
    const y = f.date.slice(0, 4);
    if (y === year) thisYear++;
    perYearMap.set(y, (perYearMap.get(y) ?? 0) + 1);
  }
  const years = [...perYearMap.keys()].sort();
  const firstYear = years[0];
  const perYear: { year: string; count: number }[] = [];
  if (firstYear) {
    const last = Math.max(Number(year), Number(years[years.length - 1]));
    for (let y = Number(firstYear); y <= last; y++) perYear.push({ year: String(y), count: perYearMap.get(String(y)) ?? 0 });
  }
  return {
    flights: flights.length,
    distanceKm,
    minutes,
    airports: airports.size,
    countries: countries.size,
    airlines: airlines.size,
    thisYear,
    year,
    firstYear,
    perYear,
  };
}

// ---------- history (detail screen) ----------

/** Direction-agnostic route key, e.g. "KLAX|KSFO". */
export function routeKey(f: Pick<Flight, 'from' | 'to'>): string {
  return [f.from, f.to].sort().join('|');
}

export interface FlightHistory {
  /** Other flights on this route, either direction (newest first). */
  sameRoute: Flight[];
  /** Totals including this flight. */
  routeCount: number;
  airlineCount: number;
  aircraftCount: number;
  tailCount: number;
  /** 1-based index of this flight among the route's flights in chronological order. */
  routeOrdinal: number;
}

export function flightHistory(flight: Flight, all: Flight[]): FlightHistory {
  const rk = routeKey(flight);
  const ak = airlineKey(flight);
  const listed = all.filter((f) => routeKey(f) === rk);
  // The flight itself may be missing from a stale list (e.g. just saved): count it anyway.
  const route = listed.some((f) => f.id === flight.id) ? listed : [...listed, flight];
  const chrono = [...route].sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? '') || a.createdAt - b.createdAt);
  const reg = flight.registration?.replace(/-/g, '').toUpperCase();
  return {
    sameRoute: route.filter((f) => f.id !== flight.id),
    routeCount: route.length,
    airlineCount: ak ? all.filter((f) => airlineKey(f) === ak).length : 0,
    aircraftCount: flight.aircraftType ? all.filter((f) => f.aircraftType === flight.aircraftType).length : 0,
    tailCount: reg ? all.filter((f) => f.registration?.replace(/-/g, '').toUpperCase() === reg).length : 0,
    routeOrdinal: chrono.findIndex((f) => f.id === flight.id) + 1,
  };
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function flightDistanceSum(flights: Flight[]): number {
  let km = 0;
  for (const f of flights) km += flightDistanceKm(f) ?? 0;
  return km;
}

/** Truncates grouped flights to the first `limit` flights (for progressive rendering). */
export function limitGroups(groups: YearGroup[], limit: number): YearGroup[] {
  const out: YearGroup[] = [];
  let left = limit;
  for (const y of groups) {
    if (left <= 0) break;
    const months: MonthGroup[] = [];
    for (const m of y.months) {
      if (left <= 0) break;
      const flights = m.flights.length <= left ? m.flights : m.flights.slice(0, left);
      left -= flights.length;
      months.push(flights === m.flights ? m : { ...m, flights });
    }
    out.push(months.length === y.months.length && months[months.length - 1] === y.months[y.months.length - 1] ? y : { ...y, months });
  }
  return out;
}

export interface Memory {
  flight: Flight;
  yearsAgo: number;
  exact: boolean;
}

/**
 * Flights from this date in earlier years ("On this day"). Falls back to the surrounding
 * week when nothing matches the exact day. Day-precision flights only; newest first.
 */
export function onThisDay(flights: Flight[], today: string, windowDays = 3, max = 3): Memory[] {
  const [ty, tm, td] = today.split('-').map(Number);
  const dayOfYear = (m: number, d: number) => Date.UTC(2000, m - 1, d) / 86_400_000; // leap-year calendar
  const target = dayOfYear(tm, td);
  const candidates: Memory[] = [];
  for (const f of flights) {
    if (f.datePrecision !== 'day') continue;
    const [y, m, d] = f.date.split('-').map(Number);
    if (y >= ty) continue;
    let diff = Math.abs(dayOfYear(m, d) - target);
    diff = Math.min(diff, 366 - diff);
    if (diff > windowDays) continue;
    candidates.push({ flight: f, yearsAgo: ty - y, exact: diff === 0 });
  }
  const exact = candidates.filter((c) => c.exact);
  const pick = exact.length ? exact : candidates;
  return pick.sort((a, b) => a.yearsAgo - b.yearsAgo || b.flight.date.localeCompare(a.flight.date)).slice(0, max);
}
