/**
 * Pure map logic: route aggregation, airport visit counts, GeoJSON builders and
 * projection-agnostic bounds. No MapLibre / DOM imports so it's unit-testable.
 * Requires reference data (airport lookups) to be loaded.
 */
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { getAirport } from '@/data/reference';
import { flightAirlineName, flightDistanceKm } from '@/lib/flight-utils';
import { distanceKm, greatCirclePoints } from '@/lib/geo';
import type { Airport, Flight } from '@/lib/types';

export interface CountItem {
  key: string;
  label: string;
  count: number;
}

export interface RouteAgg {
  /** Direction-agnostic key: the two idents sorted and joined with "|". */
  key: string;
  a: Airport;
  b: Airport;
  count: number;
  /** Flights on this route in either direction, newest first. */
  flights: Flight[];
  distanceKm: number;
  firstDate: string;
  lastDate: string;
  airlines: CountItem[];
}

export interface AirportAgg {
  airport: Airport;
  /** Flights departing from or arriving at this airport. */
  visits: number;
  departures: number;
  arrivals: number;
  firstDate: string;
  lastDate: string;
  /** Other airports flown to/from here, most frequent first. */
  destinations: { airport: Airport; count: number }[];
}

export interface MapSummary {
  flights: number;
  routes: number;
  airports: number;
  countries: number;
  distanceKm: number;
}

export interface MapAnalysis {
  routes: RouteAgg[];
  airports: AirportAgg[];
  summary: MapSummary;
  /** ISO country codes of every airport touched. */
  countries: string[];
  /** Flights whose airports couldn't be resolved (not drawable). */
  unmapped: number;
}

export const routeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const flightYear = (f: Pick<Flight, 'date'>) => Number(f.date.slice(0, 4));

/** Distinct years present in the log, newest first. */
export function flightYears(flights: Flight[]): number[] {
  return [...new Set(flights.map(flightYear))].filter((y) => Number.isFinite(y)).sort((a, b) => b - a);
}

export function filterByYear(flights: Flight[], year: number | null): Flight[] {
  return year == null ? flights : flights.filter((f) => flightYear(f) === year);
}

const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

/** Aggregates flights into routes and airports. Flights keep their input order (pass newest first). */
export function analyzeFlights(flights: Flight[]): MapAnalysis {
  const routes = new Map<string, RouteAgg & { airlineCounts: Map<string, number> }>();
  const airports = new Map<string, AirportAgg & { destCounts: Map<string, number> }>();
  let unmapped = 0;
  let totalKm = 0;

  const touch = (ap: Airport, other: Airport, f: Flight, dep: boolean) => {
    let agg = airports.get(ap.ident);
    if (!agg) {
      agg = { airport: ap, visits: 0, departures: 0, arrivals: 0, firstDate: f.date, lastDate: f.date, destinations: [], destCounts: new Map() };
      airports.set(ap.ident, agg);
    }
    agg.visits++;
    if (dep) agg.departures++;
    else agg.arrivals++;
    agg.firstDate = minDate(agg.firstDate, f.date);
    agg.lastDate = maxDate(agg.lastDate, f.date);
    if (other.ident !== ap.ident) agg.destCounts.set(other.ident, (agg.destCounts.get(other.ident) ?? 0) + 1);
  };

  for (const f of flights) {
    const a = getAirport(f.from);
    const b = getAirport(f.to);
    if (!a || !b) {
      unmapped++;
      continue;
    }
    totalKm += flightDistanceKm(f) ?? 0;
    touch(a, b, f, true);
    touch(b, a, f, false);
    const key = routeKey(a.ident, b.ident);
    let r = routes.get(key);
    if (!r) {
      const [ra, rb] = a.ident < b.ident ? [a, b] : [b, a];
      r = {
        key,
        a: ra,
        b: rb,
        count: 0,
        flights: [],
        distanceKm: distanceKm(a, b),
        firstDate: f.date,
        lastDate: f.date,
        airlines: [],
        airlineCounts: new Map(),
      };
      routes.set(key, r);
    }
    r.count++;
    r.flights.push(f);
    r.firstDate = minDate(r.firstDate, f.date);
    r.lastDate = maxDate(r.lastDate, f.date);
    const airline = flightAirlineName(f);
    if (airline) r.airlineCounts.set(airline, (r.airlineCounts.get(airline) ?? 0) + 1);
  }

  const routeList: RouteAgg[] = [...routes.values()]
    .map(({ airlineCounts, ...r }) => ({
      ...r,
      airlines: [...airlineCounts]
        .map(([label, count]) => ({ key: label, label, count }))
        .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label)),
    }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));

  const airportList: AirportAgg[] = [...airports.values()]
    .map(({ destCounts, ...ap }) => ({
      ...ap,
      destinations: [...destCounts]
        .map(([ident, count]) => ({ airport: airports.get(ident)!.airport, count }))
        .sort((x, y) => y.count - x.count || x.airport.ident.localeCompare(y.airport.ident)),
    }))
    .sort((x, y) => y.visits - x.visits || x.airport.ident.localeCompare(y.airport.ident));

  const countries = [...new Set(airportList.map((a) => a.airport.country).filter(Boolean))].sort();

  return {
    routes: routeList,
    airports: airportList,
    countries,
    unmapped,
    summary: {
      flights: flights.length - unmapped,
      routes: routeList.length,
      airports: airportList.length,
      countries: countries.length,
      distanceKm: totalKm,
    },
  };
}

// ---------- GeoJSON ----------

export interface RouteProps {
  id: string;
  a: string;
  b: string;
  count: number;
  /** Frequency weight 0..1 (log-scaled relative to the busiest route). */
  w: number;
  /** Recency 0..1 of the route's last flight within [minYear, maxYear]. */
  r: number;
  year: number;
}

export interface AirportProps {
  id: string;
  code: string;
  visits: number;
  /** Visit weight 0..1 (sqrt-scaled relative to the busiest airport). */
  w: number;
  /** Label priority: lower = more important (for symbol-sort-key). */
  rank: number;
}

/** Log-scaled 0..1 weight; a single-count dataset maps to 1. */
export function logWeight(count: number, max: number): number {
  if (max <= 1) return 1;
  return Math.log(count) / Math.log(max);
}

/** Arc segment count proportional to length so short hops stay light and long hauls smooth. */
export function arcSegments(km: number): number {
  return Math.max(8, Math.min(128, Math.round(km / 60)));
}

export function buildRoutesGeoJSON(
  routes: RouteAgg[],
  yearRange?: { min: number; max: number },
): FeatureCollection<LineString, RouteProps> {
  const max = routes.reduce((m, r) => Math.max(m, r.count), 0);
  const minY = yearRange?.min ?? Math.min(...routes.map((r) => flightYear({ date: r.lastDate })));
  const maxY = yearRange?.max ?? Math.max(...routes.map((r) => flightYear({ date: r.lastDate })));
  // Draw rarely-flown routes first so busy routes sit on top.
  const ordered = [...routes].sort((x, y) => x.count - y.count);
  const features: Feature<LineString, RouteProps>[] = ordered.map((r) => {
    const year = flightYear({ date: r.lastDate });
    return {
      type: 'Feature',
      properties: {
        id: r.key,
        a: r.a.ident,
        b: r.b.ident,
        count: r.count,
        w: round3(logWeight(r.count, max)),
        r: maxY > minY ? round3((year - minY) / (maxY - minY)) : 1,
        year,
      },
      geometry: { type: 'LineString', coordinates: greatCirclePoints(r.a, r.b, arcSegments(r.distanceKm)) },
    };
  });
  return { type: 'FeatureCollection', features };
}

export function buildAirportsGeoJSON(airports: AirportAgg[]): FeatureCollection<Point, AirportProps> {
  const max = airports.reduce((m, a) => Math.max(m, a.visits), 0);
  const ordered = [...airports].sort((x, y) => y.visits - x.visits);
  const features: Feature<Point, AirportProps>[] = ordered.map((a, i) => ({
    type: 'Feature',
    properties: {
      id: a.airport.ident,
      code: a.airport.iata || a.airport.ident,
      visits: a.visits,
      w: max > 0 ? round3(Math.sqrt(a.visits / max)) : 1,
      rank: i,
    },
    geometry: { type: 'Point', coordinates: [a.airport.lon, a.airport.lat] },
  }));
  // Reverse so the busiest airports render on top.
  return { type: 'FeatureCollection', features: features.reverse() };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- bounds ----------

/** [[west, south], [east, north]]; east may exceed 180 when the box crosses the antimeridian. */
export type Bounds = [[number, number], [number, number]];

const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Smallest longitude span containing all points (handles the antimeridian by
 * finding the largest empty longitude gap), plus latitude extent.
 */
export function computeBounds(points: [number, number][]): Bounds | null {
  if (!points.length) return null;
  let south = 90;
  let north = -90;
  const lons: number[] = [];
  for (const [lon, lat] of points) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    lons.push(wrapLon(lon));
  }
  if (!lons.length) return null;
  lons.sort((a, b) => a - b);
  // Largest gap between consecutive longitudes; the wrap-around gap is last → first + 360.
  let gap = lons[0] + 360 - lons[lons.length - 1];
  let gapEnd = 0; // index of the first longitude after the gap
  for (let i = 1; i < lons.length; i++) {
    const g = lons[i] - lons[i - 1];
    if (g > gap) {
      gap = g;
      gapEnd = i;
    }
  }
  const west = lons[gapEnd];
  let east = lons[(gapEnd - 1 + lons.length) % lons.length];
  if (east < west) east += 360;
  return [
    [west, south],
    [east, north],
  ];
}

/** Bounds of every arc (arcs bulge poleward, so arc points matter, not just endpoints). */
export function boundsOfRoutes(fc: FeatureCollection<LineString>, extra: [number, number][] = []): Bounds | null {
  const pts: [number, number][] = [...extra];
  for (const f of fc.features) for (const c of f.geometry.coordinates) pts.push([c[0], c[1]]);
  return computeBounds(pts);
}

// ---------- display helpers ----------

/** 🇺🇸 from "US". Empty string for invalid codes. */
export function flagEmoji(country: string | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return '';
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Compact number: 1234 → "1.2k", 497312 → "497k". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1).replace(/\.?0+$/, '')}M`;
}

/** Lat/lon points of every airport, for bounds when there are no arcs (e.g. only round-trips to self). */
export function airportPoints(airports: AirportAgg[]): [number, number][] {
  return airports.map((a) => [a.airport.lon, a.airport.lat]);
}
