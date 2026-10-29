import { beforeAll, describe, expect, it } from 'vitest';
import type { Flight } from '@/lib/types';
import { installReference } from '@/test/reference-fixture';
import { duplicateDate, findDuplicates, type DuplicateQuery } from './duplicates';

beforeAll(installReference);

let n = 0;
const flight = (p: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`,
  date: '2026-10-29',
  datePrecision: 'day',
  from: 'KSAN',
  to: 'KJFK',
  source: 'manual',
  createdAt: n,
  updatedAt: n,
  ...p,
});

const q = (p: Partial<DuplicateQuery> = {}): DuplicateQuery => ({ date: '2026-10-29', datePrecision: 'day', from: 'KSAN', to: 'KJFK', ...p });
const kinds = (query: DuplicateQuery, flights: Flight[], excludeId?: string) => findDuplicates(query, flights, { excludeId }).map((m) => `${m.flight.id}:${m.kind}:${m.by}:${m.dayOffset}`);

describe('findDuplicates', () => {
  it('flags the same route on the same day as a duplicate', () => {
    const f = flight({ id: 'a' });
    expect(kinds(q(), [f])).toEqual(['a:duplicate:route:0']);
    // Airports compare by identity whatever code the form holds.
    expect(kinds(q({ from: 'SAN', to: 'JFK' }), [f])).toEqual(['a:duplicate:route:0']);
  });

  it('flags the same flight number on the same day, across IATA and ICAO forms', () => {
    const f = flight({ id: 'a', flightNumber: 'UA123', from: 'KSFO', to: 'KEWR' });
    // Route not entered yet: the number alone is enough.
    expect(kinds(q({ from: '', to: '', flightNumber: 'UAL 123' }), [f])).toEqual(['a:duplicate:flightNumber:0']);
    expect(kinds(q({ from: 'KSFO', to: '', flightNumber: 'UA123' }), [f])).toEqual(['a:duplicate:flightNumber:0']);
    // A different route under the same number is only a soft hint (likely a typo somewhere)…
    expect(kinds(q({ flightNumber: 'UA 123' }), [f])).toEqual(['a:similar:flightNumber:0']);
    // …and consecutive legs of a through flight are not flagged at all.
    expect(kinds(q({ from: 'KEWR', to: 'KBOS', flightNumber: 'UA123' }), [f])).toEqual([]);
    expect(kinds(q({ from: 'KLAX', to: 'KSFO', flightNumber: 'UA123' }), [f])).toEqual([]);
  });

  it('does not nag about same-day round trips', () => {
    const out = flight({ from: 'KSAN', to: 'KLAX', depTime: '07:00' });
    expect(findDuplicates(q({ from: 'KLAX', to: 'KSAN', depTime: '18:00' }), [out])).toEqual([]);
    expect(findDuplicates(q({ from: 'KLAX', to: 'KSAN' }), [out])).toEqual([]);
  });

  it('treats the same route twice in a day as two flights when departures are over 2h apart', () => {
    const morning = flight({ id: 'am', depTime: '07:00' });
    expect(kinds(q({ depTime: '15:30' }), [morning])).toEqual([]);
    expect(kinds(q({ depTime: '08:45' }), [morning])).toEqual(['am:duplicate:route:0']);
    // Only one side has a time: can't tell them apart, so it still counts.
    expect(kinds(q(), [morning])).toEqual(['am:duplicate:route:0']);
    expect(kinds(q({ depTime: '15:30', flightNumber: '' }), [flight({ id: 'x' })])).toEqual(['x:duplicate:route:0']);
  });

  it('softens same-route matches with two different flight numbers (codeshare or a second flight)', () => {
    const f = flight({ id: 'a', flightNumber: 'AS1234' });
    expect(kinds(q({ flightNumber: 'AA 5678' }), [f])).toEqual(['a:similar:route:0']);
    expect(kinds(q({ flightNumber: 'AS 1234' }), [f])).toEqual(['a:duplicate:route:0']);
  });

  it('flags the same route one day either side as similar (time-zone date slip)', () => {
    const before = flight({ id: 'b', date: '2026-10-28' });
    const after = flight({ id: 'c', date: '2026-10-30' });
    const far = flight({ id: 'd', date: '2026-10-31' });
    expect(kinds(q(), [before, after, far])).toEqual(['b:similar:route:-1', 'c:similar:route:1']);
    // A different number on the neighbouring day is just the daily schedule.
    expect(kinds(q({ flightNumber: 'B6 2' }), [flight({ id: 'e', date: '2026-10-28', flightNumber: 'B61' })])).toEqual([]);
    // The same number next day with no airports yet.
    expect(kinds(q({ from: '', to: '', flightNumber: 'B61' }), [flight({ id: 'g', date: '2026-10-30', flightNumber: 'B61' })])).toEqual(['g:similar:flightNumber:1']);
  });

  it('ranks duplicates before similar flights and skips the flight being edited', () => {
    const editing = flight({ id: 'self' });
    const slip = flight({ id: 'slip', date: '2026-10-28' });
    const dup = flight({ id: 'dup' });
    expect(kinds(q(), [slip, editing, dup], 'self')).toEqual(['dup:duplicate:route:0', 'slip:similar:route:-1']);
  });

  it('compares month- and year-precision flights only with the same month or year', () => {
    const month = flight({ id: 'm', date: '2019-06-01', datePrecision: 'month', flightNumber: 'UA1' });
    expect(kinds(q({ date: '2019-06-01', datePrecision: 'month' }), [month])).toEqual(['m:similar:route:0']);
    expect(kinds(q({ date: '2019-06-01', datePrecision: 'month', flightNumber: 'UA 1' }), [month])).toEqual(['m:duplicate:route:0']);
    expect(kinds(q({ date: '2019-07-01', datePrecision: 'month' }), [month])).toEqual([]);
    // A day-precision entry never matches a month-precision one (and vice versa).
    expect(kinds(q({ date: '2019-06-01' }), [month])).toEqual([]);
  });

  it('needs a valid date and either a full route or a flight number', () => {
    const f = flight();
    expect(findDuplicates(q({ date: '' }), [f])).toEqual([]);
    expect(findDuplicates(q({ to: '' }), [f])).toEqual([]);
    expect(findDuplicates(q(), undefined)).toEqual([]);
  });

  it('is fast enough to run on every keystroke with a large log', () => {
    const many = Array.from({ length: 3000 }, (_, i) => flight({ date: `20${10 + (i % 16)}-0${1 + (i % 9)}-1${i % 9}`, flightNumber: `UA${i}` }));
    const t = performance.now();
    for (let i = 0; i < 20; i++) findDuplicates(q({ flightNumber: 'UA 77' }), many);
    expect((performance.now() - t) / 20).toBeLessThan(25);
  });
});

describe('duplicateDate', () => {
  it('drops the year for this year and honours coarse precision', () => {
    expect(duplicateDate({ date: '2026-10-29', datePrecision: 'day' }, 2026)).toBe('Oct 29');
    expect(duplicateDate({ date: '2019-10-29', datePrecision: 'day' }, 2026)).toBe('Oct 29, 2019');
    expect(duplicateDate({ date: '2019-06-01', datePrecision: 'month' }, 2026)).toBe('Jun 2019');
    expect(duplicateDate({ date: '2019-01-01', datePrecision: 'year' }, 2026)).toBe('2019');
  });
});
