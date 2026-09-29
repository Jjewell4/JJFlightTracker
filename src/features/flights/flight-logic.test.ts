import { describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import {
  activeFilterCount,
  computeSummary,
  countdownLabel,
  filterOptions,
  flightHistory,
  flightSearchText,
  formatCompact,
  formatDistance,
  formatLongDuration,
  groupFlights,
  limitGroups,
  isUpcoming,
  matchesFilters,
  matchesSearch,
  ordinal,
  routeKey,
  splitUpcoming,
  tzAbbrev,
} from './flight-logic';

let seq = 0;
function fl(p: Partial<Flight>): Flight {
  seq++;
  return {
    id: `f${seq}`,
    date: '2024-03-04',
    datePrecision: 'day',
    from: 'KSAN',
    to: 'KSFO',
    source: 'manual',
    createdAt: seq,
    updatedAt: seq,
    ...p,
  };
}

// Installed at import time: some fixtures below are built while collecting tests.
installReference();

describe('formatting', () => {
  it('formats distance in both units', () => {
    expect(formatDistance(1609.344, 'mi')).toBe('1,000 mi');
    expect(formatDistance(1234.4, 'km')).toBe('1,234 km');
    expect(formatDistance(undefined, 'km')).toBe('—');
    expect(formatDistance(1609.344, 'mi', false)).toBe('1,000');
  });
  it('formats compact numbers and long durations', () => {
    expect(formatCompact(9876)).toBe('9,876');
    expect(formatCompact(12_400)).toBe('12.4k');
    expect(formatCompact(412_000)).toBe('412k');
    expect(formatCompact(1_250_000)).toBe('1.25M');
    expect(formatLongDuration(0)).toBe('0h');
    expect(formatLongDuration(125)).toBe('2h 05m');
    expect(formatLongDuration(3 * 1440 + 5 * 60 + 12)).toBe('3d 5h');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
  it('tz abbreviations', () => {
    expect(tzAbbrev('2024-07-01', '10:00', 'America/Los_Angeles')).toBe('PDT');
    expect(tzAbbrev('2024-01-01', '10:00', 'America/Los_Angeles')).toBe('PST');
    expect(tzAbbrev('2024-01-01', undefined, undefined)).toBe('');
  });
});

describe('upcoming', () => {
  const today = '2026-09-29';
  const now = Date.UTC(2026, 8, 29, 18, 0); // 11:00 PDT
  it('classifies by date and departure time', () => {
    expect(isUpcoming(fl({ date: '2026-10-02' }), now, today)).toBe(true);
    expect(isUpcoming(fl({ date: '2026-09-28' }), now, today)).toBe(false);
    expect(isUpcoming(fl({ date: today, depTime: '15:00' }), now, today)).toBe(true);
    expect(isUpcoming(fl({ date: today, depTime: '08:00' }), now, today)).toBe(false);
    expect(isUpcoming(fl({ date: today }), now, today)).toBe(false);
    expect(isUpcoming(fl({ date: '2027-01-01', datePrecision: 'year' }), now, today)).toBe(false);
  });
  it('splits and sorts soonest first', () => {
    const a = fl({ date: '2026-12-01' });
    const b = fl({ date: '2026-10-01' });
    const c = fl({ date: '2026-01-01' });
    const { upcoming, past } = splitUpcoming([a, b, c], now, today);
    expect(upcoming.map((f) => f.id)).toEqual([b.id, a.id]);
    expect(past).toEqual([c]);
  });
  it('countdown labels', () => {
    expect(countdownLabel(today, today)).toBe('Today');
    expect(countdownLabel('2026-09-30', today)).toBe('Tomorrow');
    expect(countdownLabel('2026-10-02', today)).toBe('in 3 days');
    expect(countdownLabel('2026-10-20', today)).toBe('in 3 weeks');
    expect(countdownLabel('2027-01-29', today)).toBe('in 4 months');
    expect(countdownLabel('2028-10-01', today)).toBe('in 2 years');
  });
});

describe('search', () => {
  const f = fl({
    flightNumber: 'UA1234',
    airlineIcao: 'UAL',
    airlineIata: 'UA',
    aircraftType: 'B738',
    registration: 'N12345',
    note: 'Upgraded! Great sunset',
  });
  const text = flightSearchText(f);
  it('does not match "united" via United States', () => {
    const delta = flightSearchText(fl({ flightNumber: 'DL5', airlineIcao: 'DAL', from: 'KSAN', to: 'KJFK' }));
    expect(matchesSearch(delta, 'united')).toBe(false);
    expect(matchesSearch(flightSearchText(fl({ from: 'KSFO', to: 'BIKF' })), 'iceland')).toBe(true);
  });
  it.each([
    ['UA1234', true],
    ['ua 1234', true],
    ['united', true],
    ['SAN', true],
    ['san diego', true],
    ['francisco', true],
    ['KSFO', true],
    ['737', true],
    ['b738', true],
    ['n12345', true],
    ['sunset', true],
    ['', true],
    ['delta', false],
    ['LAX', false],
    ['san jfk', false],
    ['usa', true],
    ['united 737', true],
  ])('%s → %s', (q, expected) => {
    expect(matchesSearch(text, q)).toBe(expected);
  });
});

describe('filters', () => {
  const flights = [
    fl({ date: '2024-01-02', airlineIcao: 'UAL', cabinClass: 'economy', reason: 'business' }),
    fl({ date: '2024-05-02', airlineIcao: 'UAL', from: 'KSFO', to: 'KSEA', cabinClass: 'first', reason: 'leisure' }),
    fl({ date: '2023-05-02', airlineIcao: 'ASA', from: 'KSEA', to: 'KSAN', reason: 'leisure' }),
    fl({ date: '2022-05-02', airlineName: 'Mystery Air', from: 'KLAX', to: 'KJFK' }),
  ];
  it('matches each filter dimension', () => {
    expect(flights.filter((f) => matchesFilters(f, { year: '2024' }))).toHaveLength(2);
    expect(flights.filter((f) => matchesFilters(f, { airline: 'UAL' }))).toHaveLength(2);
    expect(flights.filter((f) => matchesFilters(f, { airline: 'name:mystery air' }))).toHaveLength(1);
    expect(flights.filter((f) => matchesFilters(f, { airport: 'KSEA' }))).toHaveLength(2);
    expect(flights.filter((f) => matchesFilters(f, { cabin: 'first' }))).toHaveLength(1);
    expect(flights.filter((f) => matchesFilters(f, { reason: 'leisure', year: '2023' }))).toHaveLength(1);
    expect(activeFilterCount({ year: '2024', airline: undefined, reason: 'leisure' })).toBe(2);
  });
  it('builds filter options sorted sensibly', () => {
    const o = filterOptions(flights);
    expect(o.years.map((y) => y.value)).toEqual(['2024', '2023', '2022']);
    expect(o.airlines[0]).toMatchObject({ value: 'UAL', count: 2 });
    expect(o.airlines.find((a) => a.value === 'name:mystery air')?.label).toBe('Mystery Air');
    expect(o.airports[0].count).toBe(2);
    expect(o.airports.find((a) => a.value === 'KSAN')?.label).toBe('SAN · San Diego');
    expect(o.reasons[0]).toMatchObject({ value: 'leisure', count: 2 });
  });
});

describe('grouping', () => {
  it('groups by year and month preserving order', () => {
    const flights = [
      fl({ date: '2024-05-20' }),
      fl({ date: '2024-05-02' }),
      fl({ date: '2024-01-01', datePrecision: 'year' }),
      fl({ date: '2024-02-10' }),
      fl({ date: '2023-12-31', distanceKm: 1000 }),
    ];
    const g = groupFlights(flights);
    expect(g.map((y) => y.year)).toEqual(['2024', '2023']);
    expect(g[0].count).toBe(4);
    expect(g[0].months.map((m) => m.label)).toEqual(['May', 'February', 'Date unknown']);
    expect(g[0].months[0].flights).toHaveLength(2);
    expect(g[1].distanceKm).toBe(1000);
    expect(g[0].distanceKm).toBeGreaterThan(4 * 700); // SAN–SFO ≈ 717 km, computed from airports
  });
});

describe('limitGroups', () => {
  it('keeps the first N flights, preserving group totals', () => {
    const flights = [fl({ date: '2024-05-20' }), fl({ date: '2024-05-02' }), fl({ date: '2024-02-10' }), fl({ date: '2023-12-31' })];
    const g = groupFlights(flights);
    expect(limitGroups(g, 100)).toEqual(g);
    expect(limitGroups(g, 100)[0]).toBe(g[0]);
    const l = limitGroups(g, 1);
    expect(l).toHaveLength(1);
    expect(l[0].months).toHaveLength(1);
    expect(l[0].months[0].flights).toHaveLength(1);
    expect(l[0].count).toBe(3);
    expect(limitGroups(g, 3).map((y) => y.year)).toEqual(['2024']);
    expect(limitGroups(g, 0)).toEqual([]);
  });
});

describe('summary', () => {
  it('computes totals and per-year series', () => {
    const flights = [
      fl({ date: '2026-02-01', durationMin: 90, airlineIcao: 'UAL' }),
      fl({ date: '2024-02-01', from: 'KSFO', to: 'EGLL', airlineIcao: 'BAW' }),
      fl({ date: '2022-02-01', distanceKm: 500, durationMin: 60 }),
    ];
    const s = computeSummary(flights, '2026-09-29');
    expect(s.flights).toBe(3);
    expect(s.thisYear).toBe(1);
    expect(s.year).toBe('2026');
    expect(s.airports).toBe(3);
    expect(s.countries).toBe(2);
    expect(s.airlines).toBe(2);
    expect(s.minutes).toBeGreaterThan(90 + 60 + 600);
    expect(s.perYear.map((p) => p.count)).toEqual([1, 0, 1, 0, 1]);
    expect(s.firstYear).toBe('2022');
  });
  it('handles no flights', () => {
    const s = computeSummary([], '2026-09-29');
    expect(s.flights).toBe(0);
    expect(s.perYear).toEqual([]);
  });
});

describe('history', () => {
  it('counts route (both directions), airline, aircraft and tail', () => {
    const a = fl({ date: '2020-01-01', from: 'KSAN', to: 'KSFO', airlineIcao: 'UAL', aircraftType: 'B738', registration: 'N123UA' });
    const b = fl({ date: '2021-01-01', from: 'KSFO', to: 'KSAN', airlineIcao: 'UAL', aircraftType: 'A320', registration: 'N-123UA' });
    const c = fl({ date: '2022-01-01', from: 'KSAN', to: 'KSEA', airlineIcao: 'ASA', aircraftType: 'B738' });
    const d = fl({ date: '2023-01-01', from: 'KSAN', to: 'KSFO', airlineIcao: 'ASA' });
    const h = flightHistory(b, [d, c, b, a]);
    expect(routeKey(a)).toBe(routeKey(b));
    expect(h.routeCount).toBe(3);
    expect(h.sameRoute.map((f) => f.id)).toEqual([d.id, a.id]);
    expect(h.routeOrdinal).toBe(2);
    expect(h.airlineCount).toBe(2);
    expect(h.aircraftCount).toBe(1);
    expect(h.tailCount).toBe(2);
  });
});
