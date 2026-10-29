import { beforeAll, describe, expect, it } from 'vitest';
import type { Flight } from '@/lib/types';
import { installReference } from '@/test/reference-fixture';
import { buildTravelCalendar, dayOfYear, monthStarts, pickItem, tripDays, yearLabel, yearSummary, type CalendarItem } from './travel-calendar';

beforeAll(installReference);

let n = 0;
const leg = (date: string, from: string, to: string, extra: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`,
  date,
  datePrecision: 'day',
  from,
  to,
  depTime: '09:00',
  source: 'manual',
  createdAt: n,
  updatedAt: n,
  ...extra,
});

const sample = () => [
  // Boston, Mar 1–6 (with a connection)
  leg('2026-03-01', 'KSAN', 'KDEN', { depTime: '07:00', arrTime: '10:30' }),
  leg('2026-03-01', 'KDEN', 'KBOS', { depTime: '11:45', arrTime: '17:50' }),
  leg('2026-03-06', 'KBOS', 'KSAN', { depTime: '08:00', arrTime: '11:40' }),
  // New Year in New York: Dec 28 2025 – Jan 4 2026
  leg('2025-12-28', 'KSAN', 'KJFK'),
  leg('2026-01-04', 'KJFK', 'KSAN'),
  // One-way, not a trip
  leg('2026-05-01', 'KSAN', 'KSEA'),
  // Month precision: off the calendar
  leg('2026-07-01', 'KSAN', 'KSFO', { datePrecision: 'month' }),
];

describe('buildTravelCalendar', () => {
  it('lays out trips as spans and flight days, newest year first', () => {
    const cal = buildTravelCalendar(sample(), 'all', { today: '2026-10-29' });
    expect(cal.years.map((y) => y.year)).toEqual([2026, 2025]);
    const [y26, y25] = cal.years;
    expect(y26.days).toBe(365);
    expect(y26.today).toBe(dayOfYear('2026-10-29'));
    expect(y25.today).toBeUndefined();

    // Boston: Mar 1 (day 59) – Mar 6, plus the New York trip clipped to Jan 1–4.
    const spans = y26.spans.map((s) => [s.start, s.end, s.fromPrev, s.intoNext]);
    expect(spans).toContainEqual([0, 3, true, false]);
    expect(spans).toContainEqual([59, 64, false, false]);
    expect(y25.spans.map((s) => [s.start, s.end, s.fromPrev, s.intoNext])).toEqual([[361, 364, false, true]]);

    // Two flights on Mar 1, sorted by departure; the one-way Seattle flight is a standalone day.
    const mar1 = y26.flightDays.find((d) => d.date === '2026-03-01')!;
    expect(mar1.flights.map((f) => f.to)).toEqual(['KDEN', 'KBOS']);
    expect(mar1.inTrip).toBe(true);
    const may1 = y26.flightDays.find((d) => d.date === '2026-05-01')!;
    expect(may1.inTrip).toBe(false);

    // Interactive items: the two trips and the lone flight day, chronological.
    expect(y26.items.map((i) => `${i.kind}@${i.start}`)).toEqual(['trip@0', 'trip@59', `day@${dayOfYear('2026-05-01')}`]);
  });

  it('counts days away per year (inclusive, clipped at New Year) and in total', () => {
    const cal = buildTravelCalendar(sample(), 'all');
    const [y26, y25] = cal.years;
    expect(y26.daysAway).toBe(4 + 6); // Jan 1–4, Mar 1–6
    expect(y25.daysAway).toBe(4); // Dec 28–31
    expect(cal.daysAway).toBe(14);
    expect(cal.trips).toBe(2);
    expect(y26.trips).toBe(2);
    expect(y26.flights).toBe(5);
    expect(cal.undated).toBe(1);
    expect(cal.firstYear).toBe(2025);
    // New York (8 days) beats Boston (6 days).
    expect(cal.longest?.days).toBe(8);
    expect(cal.longest?.trip.start).toBe('2025-12-28');
  });

  it('scopes to a single year', () => {
    const cal = buildTravelCalendar(sample(), 2025);
    expect(cal.years.map((y) => y.year)).toEqual([2025]);
    expect(cal.daysAway).toBe(4);
    expect(cal.trips).toBe(1);
    expect(cal.undated).toBe(0);
    expect(buildTravelCalendar(sample(), 2019).years).toEqual([]);
  });

  it('counts overlapping trips once', () => {
    const a = leg('2024-06-01', 'KSAN', 'KSEA', { tripId: 'a' });
    const b = leg('2024-06-10', 'KSEA', 'KSAN', { tripId: 'a' });
    const c = leg('2024-06-05', 'KSAN', 'KPDX', { tripId: 'b' });
    const d = leg('2024-06-12', 'KPDX', 'KSAN', { tripId: 'b' });
    const cal = buildTravelCalendar([a, b, c, d], 'all');
    expect(cal.years[0].spans).toHaveLength(2);
    expect(cal.years[0].daysAway).toBe(12); // Jun 1–12
  });

  it('handles leap years and builds 1,000 flights quickly', () => {
    expect(monthStarts(2024)[2]).toBe(60);
    expect(monthStarts(2023)[2]).toBe(59);
    expect(tripDays({ start: '2024-02-28', end: '2024-03-01' })).toBe(3);
    const flights: Flight[] = [];
    for (let i = 0; i < 500; i++) {
      const day = new Date(Date.UTC(2015, 0, 1 + i * 8)).toISOString().slice(0, 10);
      const back = new Date(Date.UTC(2015, 0, 4 + i * 8)).toISOString().slice(0, 10);
      flights.push(leg(day, 'KSAN', 'KSFO'), leg(back, 'KSFO', 'KSAN'));
    }
    const t = performance.now();
    const cal = buildTravelCalendar(flights, 'all');
    expect(performance.now() - t).toBeLessThan(500);
    expect(cal.trips).toBe(500);
    expect(cal.daysAway).toBe(2000);
  });
});

describe('pickItem', () => {
  const items = [
    { kind: 'trip', start: 10, end: 20 },
    { kind: 'day', start: 22, end: 22 },
    { kind: 'trip', start: 15, end: 15 },
    { kind: 'day', start: 100, end: 100 },
  ] as unknown as CalendarItem[];

  it('prefers the shortest item containing the position, else the nearest within tolerance', () => {
    expect(pickItem(items, 12.5, 4)).toBe(0);
    expect(pickItem(items, 15.5, 4)).toBe(2); // day trip inside a longer trip
    expect(pickItem(items, 21.6, 4)).toBe(1); // 0.4 to the day vs 0.6 past the trip
    expect(pickItem(items, 96.5, 4)).toBe(3);
    expect(pickItem(items, 60, 4)).toBe(-1);
  });
});

describe('labels', () => {
  it('summarizes a year', () => {
    const cal = buildTravelCalendar(sample(), 'all', { today: '2026-10-29' });
    expect(yearSummary(cal.years[0])).toBe('10 days away · 5 flights');
    expect(yearSummary({ daysAway: 0, flights: 1 })).toBe('1 flight');
    expect(yearLabel(cal.years[0])).toBe('2026 so far: 10 days away on 2 trips, 5 flights');
    expect(yearLabel(cal.years[1])).toBe('2025: 4 days away on 1 trip, 1 flight');
  });
});
