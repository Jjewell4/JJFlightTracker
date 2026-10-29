import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import { filterByYear } from './map-data';
import {
  buildTimeline,
  compareChrono,
  frameAt,
  gapUnits,
  landingTime,
  liveGeoJSON,
  nextSpeed,
  nextStepTime,
  partialArc,
  pastGeoJSON,
  pointAlong,
  replayDateLabel,
  targetDuration,
  visibleAirports,
  visitedCountries,
} from './replay';

let n = 0;
function flight(from: string, to: string, date: string, extra: Partial<Flight> = {}): Flight {
  n++;
  return { id: `f${n}`, date, datePrecision: 'day', from, to, source: 'manual', createdAt: n, updatedAt: n, ...extra };
}

beforeAll(() => installReference());

// Deliberately out of order (newest first, as the app passes them).
const FLIGHTS: Flight[] = [
  flight('EGLL', 'KJFK', '2024-06-10'),
  flight('KJFK', 'EGLL', '2024-06-01', { depTime: '21:00' }),
  flight('KSFO', 'KJFK', '2024-06-01', { depTime: '07:00' }),
  flight('KSAN', 'KSFO', '2019-03-15'),
  flight('KSAN', 'ZZZZ', '2020-01-01'), // unknown airport: not drawable
  flight('KSFO', 'KSAN', '2019-03-18'),
];

describe('ordering & scope', () => {
  it('orders chronologically by date, departure time, then entry order', () => {
    const a = flight('KSAN', 'KSFO', '2020-01-01', { createdAt: 5 });
    const b = flight('KSAN', 'KSFO', '2020-01-01', { createdAt: 2 });
    const c = flight('KSAN', 'KSFO', '2020-01-01', { depTime: '06:00', createdAt: 1 });
    expect([a, c, b].sort(compareChrono).map((f) => f.id)).toEqual([b.id, a.id, c.id]);
  });

  it('builds items oldest first and skips undrawable flights', () => {
    const tl = buildTimeline(FLIGHTS);
    expect(tl.items.map((i) => `${i.from.iata}-${i.to.iata}`)).toEqual(['SAN-SFO', 'SFO-SAN', 'SFO-JFK', 'JFK-LHR', 'LHR-JFK']);
    expect(tl.items[0].start).toBe(0);
    for (let i = 1; i < tl.items.length; i++) expect(tl.items[i].start).toBeGreaterThan(tl.items[i - 1].start);
    expect(tl.duration).toBeCloseTo(tl.items[tl.items.length - 1].start + tl.fly);
  });

  it('respects a year scope', () => {
    const tl = buildTimeline(filterByYear(FLIGHTS, 2019));
    expect(tl.items).toHaveLength(2);
    expect(tl.countryOrder).toEqual(['US']);
  });

  it('handles an empty scope', () => {
    const tl = buildTimeline([]);
    expect(tl.items).toEqual([]);
    expect(tl.duration).toBe(0);
    const fr = frameAt(tl, 1000);
    expect(fr).toMatchObject({ started: 0, landed: 0, flights: 0, distanceKm: 0, countries: 0, current: -1 });
    expect(liveGeoJSON(tl, fr).features).toEqual([]);
  });
});

describe('pacing', () => {
  it('compresses calendar gaps logarithmically and caps them', () => {
    expect(gapUnits(0)).toBe(0);
    expect(gapUnits(1)).toBeGreaterThan(0);
    expect(gapUnits(30)).toBeGreaterThan(gapUnits(1));
    expect(gapUnits(365)).toBeCloseTo(1.5);
    expect(gapUnits(3650)).toBeCloseTo(1.5);
  });

  it('gives a five-year gap far less than five years of screen time', () => {
    const tl = buildTimeline(FLIGHTS);
    const [, b, c, d] = tl.items;
    const sameDay = d.start - c.start; // SFO-JFK → JFK-LHR, same date
    const fiveYears = c.start - b.start; // 2019 → 2024
    expect(fiveYears / sameDay).toBeLessThanOrEqual(2.5 + 1e-9);
    expect(fiveYears).toBeGreaterThan(sameDay);
  });

  it('keeps total length within ~8–36 s at 1×', () => {
    expect(targetDuration(1)).toBe(8000);
    expect(targetDuration(10)).toBe(15000);
    expect(targetDuration(500)).toBe(36000);
    const many = Array.from({ length: 300 }, (_, i) => flight('KSAN', 'KSFO', `20${10 + Math.floor(i / 30)}-0${1 + (i % 9)}-1${i % 9}`));
    const tl = buildTimeline(many);
    expect(tl.duration).toBeCloseTo(36000);
    expect(tl.fly).toBeGreaterThanOrEqual(500);
  });

  it('honours a target override and a single flight', () => {
    expect(buildTimeline(FLIGHTS, { targetMs: 20000 }).duration).toBeCloseTo(20000);
    const one = buildTimeline([flight('KSAN', 'KSFO', '2020-01-01')]);
    expect(one.items[0].start).toBe(0);
    expect(one.duration).toBe(one.fly);
  });
});

describe('frames', () => {
  const tl = () => buildTimeline(FLIGHTS);

  it('starts with the first flight departing', () => {
    const fr = frameAt(tl(), 0);
    expect(fr).toMatchObject({ started: 1, landed: 0, current: 0, flights: 1, countries: 1, routes: 0 });
    expect(fr.active).toEqual([{ index: 0, frac: 0 }]);
    expect(fr.airports).toBe(2);
  });

  it('tracks the flight in the air and partial distance', () => {
    const t = tl();
    const fr = frameAt(t, t.fly / 2);
    expect(fr.active).toHaveLength(1);
    expect(fr.active[0].frac).toBeCloseTo(0.5);
    expect(fr.distanceKm).toBeCloseTo(t.items[0].km / 2, 0);
  });

  it('accumulates counters as flights land', () => {
    const t = tl();
    const fr = frameAt(t, landingTime(t, 2));
    expect(fr.landed).toBe(3);
    expect(fr.routes).toBe(2); // SAN–SFO (twice) + SFO–JFK
    expect(fr.countries).toBe(fr.started > 3 ? 2 : 1); // JFK–LHR (same day) may already be airborne
    expect(fr.distanceKm).toBeGreaterThanOrEqual(t.cumKm[3]);
  });

  it('ends with everything landed and counted', () => {
    const t = tl();
    const fr = frameAt(t, t.duration + 999);
    expect(fr).toMatchObject({ started: 5, landed: 5, flights: 5, countries: 2, airports: 4, routes: 3 });
    expect(fr.active).toEqual([]);
    expect(fr.distanceKm).toBeCloseTo(t.cumKm[5]);
  });

  it('overlaps flights when the log is dense', () => {
    const dense = Array.from({ length: 200 }, (_, i) => flight('KSAN', 'KSFO', '2020-05-05', { createdAt: 1000 + i }));
    const t = buildTimeline(dense);
    const fr = frameAt(t, t.duration / 2);
    expect(fr.active.length).toBeGreaterThan(1);
    // Ends are monotonic, so landed never exceeds started.
    expect(fr.landed).toBeLessThanOrEqual(fr.started);
  });

  it('steps one landing at a time for reduced motion', () => {
    const t = tl();
    const steps: number[] = [];
    let time = 0;
    for (let i = 0; i < 10 && time < t.duration; i++) {
      time = nextStepTime(t, time);
      steps.push(frameAt(t, time).landed);
    }
    expect(steps).toEqual([1, 2, 3, 4, 5]);
  });

  it('reveals several flights per step when asked to advance further', () => {
    const t = tl();
    const time = nextStepTime(t, 0, t.duration / 2);
    expect(frameAt(t, time).landed).toBeGreaterThan(1);
    expect(nextStepTime(t, t.duration)).toBe(t.duration);
  });
});

describe('GeoJSON', () => {
  it('dedupes past routes and reveals airports / countries progressively', () => {
    const t = buildTimeline(FLIGHTS);
    expect(pastGeoJSON(t, 0).features).toHaveLength(0);
    expect(pastGeoJSON(t, 2).features.map((f) => f.properties.id)).toEqual(['KSAN|KSFO']);
    expect(pastGeoJSON(t, 5).features).toHaveLength(3);
    expect(visibleAirports(t, 1)).toEqual(['KSAN', 'KSFO']);
    expect(visibleAirports(t, 4)).toEqual(['KSAN', 'KSFO', 'KJFK', 'EGLL']);
    expect(visitedCountries(t, 3)).toEqual(['US']);
    expect(visitedCountries(t, 4)).toEqual(['US', 'GB']);
  });

  it('draws the active trail up to the moving head', () => {
    const t = buildTimeline(FLIGHTS);
    const fr = frameAt(t, t.fly / 2);
    const fc = liveGeoJSON(t, fr);
    const trail = fc.features.find((f) => f.properties.kind === 'trail')!;
    const head = fc.features.find((f) => f.properties.kind === 'head')!;
    const coords = (trail.geometry as GeoJSON.LineString).coordinates;
    expect(coords[coords.length - 1]).toEqual((head.geometry as GeoJSON.Point).coordinates);
    expect(coords[0]).toEqual(t.items[0].coords[0]);
  });

  it('shows the last landed flight whole when still (reduced motion)', () => {
    const t = buildTimeline(FLIGHTS);
    const fc = liveGeoJSON(t, frameAt(t, landingTime(t, 1)), true);
    const trail = fc.features.find((f) => f.properties.kind === 'trail')!;
    expect((trail.geometry as GeoJSON.LineString).coordinates).toEqual(t.items[1].coords);
  });

  it('interpolates along a polyline', () => {
    const line: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
    ];
    expect(pointAlong(line, 0.25)).toEqual([5, 0]);
    expect(pointAlong(line, 1)).toEqual([20, 0]);
    expect(partialArc(line, 0)).toHaveLength(2);
    expect(partialArc(line, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [15, 0],
    ]);
    expect(partialArc(line, 1)).toBe(line);
  });
});

describe('labels', () => {
  it('formats the playhead date per precision', () => {
    expect(replayDateLabel({ date: '2019-03-15', datePrecision: 'day' })).toBe('Mar 2019');
    expect(replayDateLabel({ date: '2019-11-01', datePrecision: 'month' })).toBe('Nov 2019');
    expect(replayDateLabel({ date: '2019-01-01', datePrecision: 'year' })).toBe('2019');
    expect(replayDateLabel(undefined)).toBe('');
  });

  it('cycles speeds', () => {
    expect(nextSpeed(1)).toBe(2);
    expect(nextSpeed(2)).toBe(4);
    expect(nextSpeed(4)).toBe(1);
  });
});
