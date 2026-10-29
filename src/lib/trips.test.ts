import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from './types';
import {
  awaySpans,
  cityName,
  detectTrips,
  groupTripsByYear,
  homeAirport,
  resolveTrip,
  stopNights,
  tripCounts,
  tripDates,
  tripMinutes,
  tripOf,
  tripRoute,
  tripTitle,
} from './trips';

beforeAll(installReference);

let n = 0;
const leg = (date: string, from: string, to: string, depTime = '09:00', arrTime?: string, extra: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`, date, datePrecision: 'day', from, to, depTime, arrTime, source: 'manual', createdAt: n, updatedAt: n, ...extra,
});

describe('detectTrips', () => {
  it('groups an out-and-back with a connection, ending when back home', () => {
    const flights = [
      leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30'),
      leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50'), // connection in DEN
      leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40'),
      leg('2026-04-10', 'KSAN', 'KSFO', '08:00', '09:30'),
      leg('2026-04-12', 'KSFO', 'KSAN', '18:00', '19:30'),
      leg('2026-05-01', 'KSAN', 'KSEA'), // one-way, no return: not a trip
    ];
    const trips = detectTrips(flights);
    expect(trips).toHaveLength(2);
    const [sf, boston] = trips;
    expect(boston.flights.map((f) => f.to)).toEqual(['KDEN', 'KBOS', 'KSAN']);
    expect(boston.stops.map((s) => [s.airport, s.kind])).toEqual([['KDEN', 'connection'], ['KBOS', 'stay']]);
    expect(boston.main).toBe('KBOS');
    expect(boston.roundTrip).toBe(true);
    expect(boston.nights).toBe(5);
    expect(tripTitle(boston)).toBe('Boston');
    expect(tripTitle(sf)).toBe('San Francisco');
    expect(homeAirport(flights)).toBe('KSAN');
  });

  it('breaks chains on long gaps and airport mismatches, but treats same-city airports as connected', () => {
    const trips = detectTrips([
      leg('2026-06-01', 'KSAN', 'KJFK', '07:00', '15:30'),
      leg('2026-06-04', 'KLGA', 'KORD'), // JFK → LGA same city
      leg('2026-06-05', 'KORD', 'KSAN'),
      leg('2026-08-01', 'KSAN', 'KLAS'),
      leg('2026-09-30', 'KLAS', 'KSAN'), // 60 days later: separate
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0].flights).toHaveLength(3);
  });

  it('keeps saved trips intact and excludes their legs from suggestions', () => {
    const a = leg('2026-07-01', 'KSAN', 'PHNL', '08:00', '11:00', { tripId: 't1', tripName: 'Honeymoon' });
    const b = leg('2026-07-08', 'PHNL', 'KSAN', '13:00', '21:00', { tripId: 't1' });
    const trips = detectTrips([a, b, leg('2026-07-20', 'KSAN', 'KPDX'), leg('2026-07-22', 'KPDX', 'KSAN')]);
    const saved = trips.find((t) => t.saved)!;
    expect(saved).toMatchObject({ id: 't1', name: 'Honeymoon' });
    expect(tripTitle(saved)).toBe('Honeymoon');
    expect(tripOf(trips, b.id)?.id).toBe('t1');
    expect(trips.filter((t) => !t.saved)).toHaveLength(1);
  });

  it('ignores imprecise dates and formats ranges', () => {
    const trips = detectTrips([leg('2025-12-28', 'KSAN', 'KJFK'), leg('2026-01-04', 'KJFK', 'KSAN'), { ...leg('2026-02-01', 'KSAN', 'KSEA'), datePrecision: 'month' }]);
    expect(trips).toHaveLength(1);
    expect(tripDates(trips[0])).toBe('Dec 28, 2025 – Jan 4, 2026');
    expect(awaySpans(trips)).toEqual([{ start: '2025-12-28', end: '2026-01-04', tripId: trips[0].id }]);
  });
});

describe('trip helpers', () => {
  const boston = () => [
    leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30', { airlineIcao: 'UAL', durationMin: 150 }),
    leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50', { airlineIcao: 'UAL', durationMin: 245 }),
    leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40', { airlineIcao: 'JBU' }),
  ];

  it('describes the route, time aloft, counts and nights per stop', () => {
    const [t] = detectTrips(boston());
    expect(tripRoute(t).map((s) => [s.airport, s.role])).toEqual([
      ['KSAN', 'origin'],
      ['KDEN', 'connection'],
      ['KBOS', 'stay'],
      ['KSAN', 'finish'],
    ]);
    // Recorded durations, plus a distance-based estimate for the leg without one.
    expect(tripMinutes(t)).toBeGreaterThan(150 + 245 + 300);
    expect(tripMinutes(t)).toBeLessThan(150 + 245 + 420);
    expect(tripCounts(t)).toEqual({ airlines: 2, airports: 3 });
    expect(stopNights(t.flights[1], t.flights[2])).toBe(5);
    expect(stopNights(t.flights[0], t.flights[1])).toBe(0);
  });

  it('detects the same trips whatever order the log comes in (newest first from the db)', () => {
    const legs = boston();
    expect(homeAirport([...legs].reverse())).toBe('KSAN');
    expect(detectTrips([...legs].reverse()).map((t) => t.flights.length)).toEqual([3]);
  });

  it('groups trips by the year they start in, newest first, with nights per year', () => {
    const trips = detectTrips([
      ...boston(),
      leg('2025-12-28', 'KSAN', 'KJFK'),
      leg('2026-01-04', 'KJFK', 'KSAN'),
      leg('2024-05-01', 'KSAN', 'KSEA'),
      leg('2024-05-03', 'KSEA', 'KSAN'),
    ]);
    const years = groupTripsByYear(trips);
    expect(years.map((y) => [y.year, y.trips.length, y.nights])).toEqual([
      ['2026', 1, 5],
      ['2025', 1, 7],
      ['2024', 1, 2],
    ]);
    expect(groupTripsByYear([])).toEqual([]);
  });

  it('resolves stale suggestion ids to the trip that now holds the flight', () => {
    const legs = boston();
    const [suggested] = detectTrips(legs);
    expect(suggested.id).toBe(`auto-${legs[0].id}`);
    expect(resolveTrip(detectTrips(legs), suggested.id)).toMatchObject({ exact: true, trip: { id: suggested.id } });

    // A leg logged before it changes the suggestion's id; the old link still finds the trip.
    const earlier = leg('2026-02-28', 'KLAX', 'KSAN', '20:00', '21:00');
    const shifted = detectTrips([earlier, ...legs]);
    const r = resolveTrip(shifted, suggested.id);
    expect(r?.exact).toBe(false);
    expect(r?.trip.flights.map((f) => f.id)).toContain(legs[0].id);

    // Saved since: the suggestion id now leads to the saved trip.
    const saved = detectTrips(legs.map((f) => ({ ...f, tripId: 'trip-1', tripName: 'Boston' })));
    expect(resolveTrip(saved, suggested.id)).toMatchObject({ exact: false, trip: { id: 'trip-1', saved: true } });

    // Ungrouped: the saved id is gone, but the legs last shown point at the new suggestion.
    expect(resolveTrip(detectTrips(legs), 'trip-1')).toBeUndefined();
    expect(resolveTrip(detectTrips(legs), 'trip-1', [legs[1].id])).toMatchObject({ exact: false, trip: { id: suggested.id } });

    // Nothing left to find.
    expect(resolveTrip(detectTrips(legs), 'auto-missing')).toBeUndefined();
    expect(resolveTrip(detectTrips(legs.slice(0, 1)), suggested.id)).toBeUndefined();
  });

  it('keeps a saved trip with one remaining leg, and never trips month-precision flights', () => {
    const solo = leg('2026-04-02', 'KSAN', 'KDEN', '09:00', '12:00', { tripId: 'ski', tripName: 'Ski weekend' });
    const vague = leg('2026-04-01', 'KDEN', 'KSAN', '09:00', undefined, { datePrecision: 'month', tripId: 'ski' });
    const trips = detectTrips([solo, vague]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ id: 'ski', saved: true, nights: 0, stops: [] });
    expect(trips[0].flights.map((f) => f.id)).toEqual([solo.id]);
  });

  it('treats airports of one city as connected and titles trips with clean city names', () => {
    const trips = detectTrips([
      leg('2026-06-01', 'KSAN', 'LFPG', '07:00', '08:00', { arrDayOffset: 1 }),
      leg('2026-06-05', 'LFPO', 'KSAN', '10:00', '13:00'), // CDG in, Orly out
    ]);
    expect(trips).toHaveLength(1);
    expect(tripTitle(trips[0])).toBe('Paris');
    expect(cityName('LFPG')).toBe('Paris');
    expect(cityName('EGSS')).toBe('London');
    expect(cityName('ZZZZ')).toBe('ZZZZ');
  });
});

describe('home region', () => {
  it('treats a regularly used nearby airport as home, so trips from it end there', () => {
    const flights = [
      // SAN is the main home; LAX (180 km) is used regularly too.
      leg('2026-01-05', 'KSAN', 'KSEA', '07:00', '09:30'), leg('2026-01-08', 'KSEA', 'KSAN', '18:00', '20:30'),
      leg('2026-02-02', 'KLAX', 'KDEN', '07:00', '10:30'), leg('2026-02-05', 'KDEN', 'KLAX', '18:00', '19:30'),
      leg('2026-02-12', 'KLAX', 'KBOS', '07:00', '15:30'), leg('2026-02-16', 'KBOS', 'KLAX', '08:00', '11:30'),
      leg('2026-03-01', 'KSAN', 'KJFK', '07:00', '15:30'), leg('2026-03-04', 'KJFK', 'KLAX', '08:00', '11:30'),
      leg('2026-04-01', 'KSAN', 'KPDX'), leg('2026-04-03', 'KPDX', 'KSAN'),
      leg('2026-05-01', 'KLAX', 'KSFO'), leg('2026-05-03', 'KSFO', 'KLAX'),
    ];
    const trips = detectTrips(flights);
    const byMain = Object.fromEntries(trips.map((t) => [t.main, t]));
    expect(byMain.KDEN.flights).toHaveLength(2); // not chained with the Boston trip a week later
    expect(byMain.KBOS.flights).toHaveLength(2);
    expect(byMain.KJFK.roundTrip).toBe(true); // SAN → JFK → LAX is back home
  });
});
