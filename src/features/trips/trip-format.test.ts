import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { detectTrips } from '@/lib/trips';
import type { Flight } from '@/lib/types';
import { nightsLabel, routeText, stopLabel, tripShareText, tripStatsLine } from './trip-format';
import { placeLabels, tripDrawing } from './trip-geometry';
import { flightsSignature, tripsFor } from './use-trips';

beforeAll(installReference);

let n = 0;
const leg = (date: string, from: string, to: string, depTime: string, arrTime: string, extra: Partial<Flight> = {}): Flight => ({
  id: `g${++n}`, date, datePrecision: 'day', from, to, depTime, arrTime, source: 'manual', createdAt: n, updatedAt: n, ...extra,
});

const bostonLegs = () => [
  leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30', { flightNumber: 'UA123' }),
  leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50', { flightNumber: 'UA456' }),
  leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40', { flightNumber: 'B6789' }),
];

describe('trip text', () => {
  it('summarises a trip', () => {
    const [t] = detectTrips(bostonLegs());
    expect(routeText(t)).toBe('SAN → DEN → BOS → SAN');
    expect(tripStatsLine(t, 'mi')).toMatch(/^3 flights · 5 nights · [\d,]+ mi$/);
    expect(tripStatsLine(t, 'km')).toMatch(/ km$/);
  });

  it('labels what happens between legs', () => {
    const [t] = detectTrips(bostonLegs());
    expect(stopLabel(t.stops[0], t.flights[0], t.flights[1])).toEqual({ kind: 'connection', text: 'Connection in Denver', detail: '1h 15m' });
    expect(stopLabel(t.stops[1], t.flights[1], t.flights[2])).toEqual({ kind: 'stay', text: '5 nights in Boston', detail: undefined });

    const [night] = detectTrips([
      leg('2026-04-01', 'KSAN', 'KJFK', '13:00', '21:30'),
      leg('2026-04-02', 'KLGA', 'KBOS', '07:00', '08:20'),
      leg('2026-04-05', 'KBOS', 'KSAN', '09:00', '12:40'),
    ]);
    expect(stopLabel(night.stops[0], night.flights[0], night.flights[1])).toEqual({ kind: 'overnight', text: 'Overnight in New York', detail: '9h 30m · JFK → LGA' });
  });

  it('calls a same-day round trip a day trip and leaves a lone leg unlabelled', () => {
    const [day] = detectTrips([leg('2026-05-01', 'KSAN', 'KSFO', '07:00', '08:30'), leg('2026-05-01', 'KSFO', 'KSAN', '19:00', '20:30')]);
    expect(nightsLabel(day)).toBe('Day trip');
    const [solo] = detectTrips([leg('2026-05-03', 'KSAN', 'KSFO', '07:00', '08:30', { tripId: 'x' })]);
    expect(nightsLabel(solo)).toBe('');
    expect(tripStatsLine(solo, 'mi')).toMatch(/^1 flight · [\d,]+ mi$/);
  });

  it('builds share text with every leg', () => {
    const [t] = detectTrips(bostonLegs());
    const text = tripShareText(t, 'mi');
    expect(text.split('\n').slice(0, 2)).toEqual(['Boston · Mar 1 – 6, 2026', 'SAN → DEN → BOS → SAN']);
    expect(text).toContain('Mar 1  UA 123  SAN → DEN');
    expect(text).toContain('Mar 6  B6 789  BOS → SAN');
  });
});

describe('trips cache', () => {
  it('recomputes only when ids or updatedAt change', () => {
    const legs = bostonLegs();
    const a = tripsFor(legs);
    expect(tripsFor([...legs])).toBe(a);
    expect(flightsSignature(legs)).toBe(flightsSignature(legs.map((f) => ({ ...f }))));
    const edited = legs.map((f, i) => (i === 2 ? { ...f, updatedAt: f.updatedAt + 1, tripId: 't', tripName: 'Saved' } : f));
    expect(flightsSignature(edited)).not.toBe(flightsSignature(legs));
    const b = tripsFor(edited);
    expect(b).not.toBe(a);
    expect(b.some((t) => t.saved)).toBe(true);
  });
});

describe('trip drawing', () => {
  it('projects every leg and airport inside the viewport, numbering only long legs', () => {
    const [t] = detectTrips(bostonLegs());
    const g = tripDrawing(t, 640, 340);
    expect(g.legs.map((l) => l.n)).toEqual([1, 2, 3]);
    expect(g.airports.map((a) => [a.code, a.role]).sort()).toEqual([
      ['BOS', 'stay'],
      ['DEN', 'connection'],
      ['SAN', 'origin'],
    ]);
    for (const a of g.airports) {
      expect(a.x).toBeGreaterThan(0);
      expect(a.x).toBeLessThan(640);
      expect(a.y).toBeGreaterThan(0);
      expect(a.y).toBeLessThan(340);
    }
    expect(g.dots.length).toBeGreaterThan(100);
    expect(placeLabels(g, 22, 15)).toHaveLength(3);
  });

  it('keeps trips across the antimeridian on one side', () => {
    const [t] = detectTrips([leg('2026-07-01', 'PHNL', 'RJTT', '10:00', '14:00', { arrDayOffset: 1 }), leg('2026-07-08', 'RJTT', 'PHNL', '21:00', '09:00')]);
    const g = tripDrawing(t, 640, 340);
    const xs = g.airports.map((a) => a.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(640);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
  });
});
