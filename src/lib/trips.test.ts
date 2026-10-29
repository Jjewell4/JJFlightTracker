import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from './types';
import { awaySpans, detectTrips, homeAirport, tripDates, tripOf, tripTitle } from './trips';

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
