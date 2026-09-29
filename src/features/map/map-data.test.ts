import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import {
  analyzeFlights,
  arcSegments,
  boundsOfRoutes,
  buildAirportsGeoJSON,
  buildRoutesGeoJSON,
  compactNumber,
  computeBounds,
  filterByYear,
  flagEmoji,
  flightYears,
  logWeight,
  routeKey,
} from './map-data';

let n = 0;
function flight(from: string, to: string, date: string, extra: Partial<Flight> = {}): Flight {
  n++;
  return { id: `f${n}`, date, datePrecision: 'day', from, to, source: 'manual', createdAt: n, updatedAt: n, ...extra };
}

beforeAll(() => installReference());

const FLIGHTS: Flight[] = [
  flight('KSAN', 'KSFO', '2024-05-02', { airlineIcao: 'SWA' }),
  flight('KSFO', 'KSAN', '2024-05-05', { airlineIcao: 'SWA' }),
  flight('KSAN', 'KSFO', '2019-01-10', { airlineIcao: 'UAL' }),
  flight('KSAN', 'KSEA', '2023-03-01', { airlineIcao: 'ASA' }),
  flight('KSEA', 'PANC', '2023-03-04', { airlineIcao: 'ASA' }),
  flight('KSAN', 'ZZZZ', '2023-03-04'), // unknown airport
];

describe('analyzeFlights', () => {
  const a = () => analyzeFlights(FLIGHTS);

  it('aggregates routes regardless of direction', () => {
    const r = a().routes.find((x) => x.key === routeKey('KSFO', 'KSAN'))!;
    expect(r.count).toBe(3);
    expect(r.a.ident < r.b.ident).toBe(true);
    expect(r.firstDate).toBe('2019-01-10');
    expect(r.lastDate).toBe('2024-05-05');
    expect(r.airlines[0]).toMatchObject({ label: 'Southwest Airlines', count: 2 });
    expect(r.distanceKm).toBeGreaterThan(700);
    expect(r.distanceKm).toBeLessThan(750);
  });

  it('sorts routes by frequency and skips unmapped flights', () => {
    const res = a();
    expect(res.routes.map((r) => r.count)).toEqual([3, 1, 1]);
    expect(res.unmapped).toBe(1);
    expect(res.summary.flights).toBe(5);
    expect(res.summary.routes).toBe(3);
  });

  it('counts airport visits, departures, arrivals and destinations', () => {
    const san = a().airports.find((x) => x.airport.ident === 'KSAN')!;
    expect(san.visits).toBe(4);
    expect(san.departures).toBe(3);
    expect(san.arrivals).toBe(1);
    expect(san.firstDate).toBe('2019-01-10');
    expect(san.lastDate).toBe('2024-05-05');
    expect(san.destinations.map((d) => [d.airport.iata, d.count])).toEqual([
      ['SFO', 3],
      ['SEA', 1],
    ]);
    expect(a().airports[0].airport.ident).toBe('KSAN');
  });

  it('summarises distance and countries', () => {
    const res = a();
    expect(res.summary.airports).toBe(4);
    expect(res.countries).toEqual(['US']);
    expect(res.summary.distanceKm).toBeGreaterThan(3 * 700 + 1200 + 2300);
  });

  it('handles an empty log', () => {
    const res = analyzeFlights([]);
    expect(res.routes).toEqual([]);
    expect(res.summary).toMatchObject({ flights: 0, routes: 0, airports: 0, distanceKm: 0 });
  });
});

describe('year helpers', () => {
  it('lists years newest first and filters', () => {
    expect(flightYears(FLIGHTS)).toEqual([2024, 2023, 2019]);
    expect(filterByYear(FLIGHTS, 2024)).toHaveLength(2);
    expect(filterByYear(FLIGHTS, null)).toHaveLength(FLIGHTS.length);
  });
});

describe('GeoJSON builders', () => {
  it('builds weighted great-circle route lines, busiest drawn last', () => {
    const res = analyzeFlights(FLIGHTS);
    const fc = buildRoutesGeoJSON(res.routes, { min: 2019, max: 2024 });
    expect(fc.features).toHaveLength(3);
    const last = fc.features[fc.features.length - 1];
    expect(last.properties).toMatchObject({ id: 'KSAN|KSFO', count: 3, w: 1, r: 1, year: 2024 });
    expect(fc.features[0].properties.w).toBe(0);
    expect(last.geometry.coordinates.length).toBeGreaterThan(8);
    const sea = fc.features.find((f) => f.properties.id === 'KSAN|KSEA')!;
    expect(sea.properties.r).toBe(0.8);
  });

  it('builds airport points with sqrt visit weights and label ranks', () => {
    const res = analyzeFlights(FLIGHTS);
    const fc = buildAirportsGeoJSON(res.airports);
    const san = fc.features.find((f) => f.properties.id === 'KSAN')!;
    expect(san.properties).toMatchObject({ code: 'SAN', visits: 4, w: 1, rank: 0 });
    expect(san.geometry.coordinates[0]).toBeCloseTo(-117.19, 1);
    // Busiest airport rendered last (on top).
    expect(fc.features[fc.features.length - 1].properties.id).toBe('KSAN');
    const anc = fc.features.find((f) => f.properties.id === 'PANC')!;
    expect(anc.properties.w).toBeCloseTo(Math.sqrt(1 / 4), 2);
  });

  it('log weight and arc segments are bounded', () => {
    expect(logWeight(1, 1)).toBe(1);
    expect(logWeight(1, 10)).toBe(0);
    expect(logWeight(10, 10)).toBe(1);
    expect(arcSegments(10)).toBe(8);
    expect(arcSegments(20000)).toBe(128);
  });
});

describe('computeBounds', () => {
  it('returns null for no points', () => {
    expect(computeBounds([])).toBeNull();
  });

  it('computes a plain box', () => {
    expect(
      computeBounds([
        [-117, 32],
        [-73, 40],
        [-122, 47],
      ]),
    ).toEqual([
      [-122, 32],
      [-73, 47],
    ]);
  });

  it('crosses the antimeridian when that is the smaller box', () => {
    // Tokyo, Honolulu, Sydney – the tight box spans 139°E → 158°W.
    const b = computeBounds([
      [139.8, 35.5],
      [-157.9, 21.3],
      [151.2, -33.9],
    ])!;
    expect(b[0][0]).toBeCloseTo(139.8);
    expect(b[1][0]).toBeCloseTo(202.1);
    expect(b[1][0] - b[0][0]).toBeLessThan(90);
  });

  it('normalises unwrapped longitudes from great-circle arcs', () => {
    const b = computeBounds([
      [170, 10],
      [190, 12],
    ])!;
    expect(b).toEqual([
      [170, 10],
      [190, 12],
    ]);
  });

  it('includes the poleward bulge of long arcs', () => {
    const res = analyzeFlights([flight('KLAX', 'EGLL', '2020-01-01')]);
    const b = boundsOfRoutes(buildRoutesGeoJSON(res.routes))!;
    expect(b[1][1]).toBeGreaterThan(60); // LAX–LHR peaks well north of both airports
  });
});

describe('display helpers', () => {
  it('formats flags and compact numbers', () => {
    expect(flagEmoji('us')).toBe('🇺🇸');
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('USA')).toBe('');
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(1234)).toBe('1.2k');
    expect(compactNumber(497312)).toBe('497k');
    expect(compactNumber(1_250_000)).toBe('1.25M');
  });
});
