import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { enrichFlight } from '@/lib/flight-utils';
import type { Flight } from '@/lib/types';
import type { FlightLookupResult } from '@/services/lookup';
import {
  applyLookup,
  clearFields,
  duplicateValues,
  emptyValues,
  flightToValues,
  inferSeatType,
  lookupDiff,
  prettyFlightNumber,
  returnValues,
  timing,
  validate,
  valuesToInput,
} from './form-model';
import { routePartners, usageStats } from './history-stats';
import { boostUsed } from './pickers';
import { flagEmoji, tzAbbr } from './format';
import { yearOptions } from './DateField';

beforeAll(installReference);

const flight = (p: Partial<Flight> = {}): Flight => ({
  id: 'f1',
  date: '2024-03-04',
  datePrecision: 'day',
  flightNumber: 'UA123',
  airlineIcao: 'UAL',
  airlineIata: 'UA',
  airlineName: 'United Airlines',
  from: 'KSAN',
  to: 'KEWR',
  depTime: '06:05',
  arrTime: '14:30',
  aircraftType: 'B739',
  seatNumber: '12A',
  seatType: 'window',
  cabinClass: 'economy',
  reason: 'business',
  registration: 'N37470',
  note: 'hi',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

const result = (p: Partial<FlightLookupResult> = {}): FlightLookupResult => ({
  key: 'history:KSAN>KEWR',
  flightNumber: 'UA123',
  airline: { icao: 'UAL', iata: 'UA', name: 'United Airlines' },
  from: 'KSAN',
  to: 'KEWR',
  depTime: '06:05',
  arrTime: '14:30',
  aircraftType: 'B739',
  aircraftName: 'Boeing 737-900',
  source: 'history',
  sourceLabel: 'x',
  confidence: 0.8,
  dateSpecific: false,
  ...p,
});

describe('seat type inference', () => {
  it('handles narrowbody layouts', () => {
    expect(inferSeatType('12A')).toBe('window');
    expect(inferSeatType('12f')).toBe('window');
    expect(inferSeatType('12B')).toBe('middle');
    expect(inferSeatType('12E', 'B738')).toBe('middle');
    expect(inferSeatType('3C')).toBe('aisle');
    expect(inferSeatType(' 3 D ')).toBe('aisle');
  });
  it('handles widebody layouts', () => {
    expect(inferSeatType('40K', 'B77W')).toBe('window');
    expect(inferSeatType('40A', 'A359')).toBe('window');
    expect(inferSeatType('40F', 'B789')).toBe('middle');
    expect(inferSeatType('40G', 'A333')).toBe('aisle');
    expect(inferSeatType('40J', 'B77W')).toBe('middle');
  });
  it('returns undefined without a seat letter', () => {
    expect(inferSeatType('')).toBeUndefined();
    expect(inferSeatType('12')).toBeUndefined();
    expect(inferSeatType('A')).toBeUndefined();
  });
});

describe('applying lookups', () => {
  it('fills empty fields and reports what changed', () => {
    const v = emptyValues({ flightNumber: 'UA 123' });
    const { values, filled } = applyLookup(v, result(), { edited: new Set() });
    expect(values).toMatchObject({ from: 'KSAN', to: 'KEWR', depTime: '06:05', aircraftType: 'B739', aircraftName: 'Boeing 737-900' });
    expect(filled).toEqual(['airline', 'from', 'to', 'times', 'aircraft']);
  });
  it('never overwrites user-edited or already-filled fields', () => {
    const v = emptyValues({ from: 'KLAX', aircraftName: 'My jet' });
    const { values, filled } = applyLookup(v, result(), { edited: new Set(['from']) });
    expect(values.from).toBe('KLAX');
    expect(values.aircraftName).toBe('My jet');
    expect(filled).not.toContain('from');
    expect(filled).not.toContain('aircraft');
  });
  it('replaces fields that a previous lookup filled', () => {
    const v = emptyValues({ from: 'KLAX', to: 'KSFO' });
    const { values } = applyLookup(v, result(), { edited: new Set(), replaceable: new Set(['from', 'to']) });
    expect(values.from).toBe('KSAN');
    expect(values.to).toBe('KEWR');
  });
  it('refuses to create an identical origin and destination', () => {
    const v = emptyValues({ to: 'KSAN' });
    const out = applyLookup(v, result({ to: undefined }), { edited: new Set(['to']) });
    expect(out.filled).toEqual([]);
    expect(out.values).toBe(v);
  });
  it('computes the diff and clears groups for undo', () => {
    const v = emptyValues({ from: 'KSAN' });
    expect(lookupDiff(v, result(), new Set())).toEqual(['airline', 'to', 'times', 'aircraft']);
    const cleared = clearFields({ ...v, to: 'KEWR', depTime: '1', arrTime: '2', arrDayOffset: 1 }, ['to', 'times']);
    expect(cleared).toMatchObject({ from: 'KSAN', to: '', depTime: '', arrTime: '', arrDayOffset: undefined });
  });
});

describe('validation', () => {
  it('requires date and both airports', () => {
    const e = validate(emptyValues({ date: '' }));
    expect(Object.keys(e).sort()).toEqual(['date', 'from', 'to']);
  });
  it('rejects the same airport twice, even as IATA vs ICAO', () => {
    expect(validate(emptyValues({ from: 'KSAN', to: 'SAN' })).to).toMatch(/differ/);
  });
  it('flags impossible explicit day offsets', () => {
    const v = emptyValues({ from: 'KSAN', to: 'KEWR', depTime: '10:00', arrTime: '09:00', arrDayOffset: 0 });
    expect(validate(v).times).toBeTruthy();
    expect(validate({ ...v, arrDayOffset: undefined }).times).toBeUndefined();
  });
  it('accepts a complete flight', () => {
    expect(validate(flightToValues(flight()))).toEqual({});
  });
});

describe('timing', () => {
  it('computes tz-aware duration and overnight offsets', () => {
    const t = timing({ date: '2024-03-04', depTime: '06:05', arrTime: '14:30', from: 'KSAN', to: 'KEWR' });
    expect(t).toEqual({ durationMin: 325, arrDayOffset: 0 });
    const redeye = timing({ date: '2024-03-04', depTime: '22:30', arrTime: '07:05', from: 'KSFO', to: 'KJFK' });
    expect(redeye?.arrDayOffset).toBe(1);
  });
});

describe('form ⇄ flight', () => {
  it('round-trips an existing flight', () => {
    const f = flight();
    const v = flightToValues(f);
    expect(v.flightNumber).toBe('UA 123');
    const input = enrichFlight(valuesToInput(v, { source: 'manual', base: f }));
    expect(input).toMatchObject({ from: 'KSAN', to: 'KEWR', flightNumber: 'UA123', airlineIcao: 'UAL', seatNumber: '12A', durationMin: 325, source: 'manual' });
  });
  it('drops times for month precision and cleared fields become undefined', () => {
    const v = { ...flightToValues(flight()), datePrecision: 'month' as const, date: '2024-03-01', registration: '', note: '  ' };
    const input = valuesToInput(v, { source: 'manual' });
    expect(input.depTime).toBeUndefined();
    expect(input.registration).toBeUndefined();
    expect(input.note).toBeUndefined();
    expect('registration' in input).toBe(true); // explicit undefined clears the stored value on update
  });
  it('prefills return and duplicate flights', () => {
    const r = returnValues(flight());
    expect(r).toMatchObject({ from: 'KEWR', to: 'KSAN', date: '', flightNumber: '', depTime: '', airline: { icao: 'UAL' }, cabinClass: 'economy' });
    const d = duplicateValues(flight());
    expect(d).toMatchObject({ from: 'KSAN', to: 'KEWR', flightNumber: 'UA 123', registration: '', seatNumber: '', depTime: '06:05' });
  });
  it('re-infers the day offset when an overnight flight is edited to a day flight', () => {
    const f = { ...flight(), ...enrichFlight({ ...flight(), from: 'KLAX', to: 'KJFK', depTime: '22:00', arrTime: '06:00' }) } as Flight;
    expect(f).toMatchObject({ arrDayOffset: 1, durationMin: 300 });
    const v = flightToValues(f);
    expect(v.arrDayOffset).toBeUndefined();
    const edited = { ...v, depTime: '08:00', arrTime: '16:30' };
    expect(validate(edited)).toEqual({});
    expect(enrichFlight(valuesToInput(edited, { source: 'manual', base: f }))).toMatchObject({ arrDayOffset: 0, durationMin: 330 });
  });
  it('re-infers the day offset when a same-day flight is edited to overnight', () => {
    const f = { ...flight(), ...enrichFlight(flight()) } as Flight;
    expect(f.arrDayOffset).toBe(0);
    const edited = { ...flightToValues(f), depTime: '22:30', arrTime: '07:05' };
    expect(validate(edited)).toEqual({});
    expect(enrichFlight(valuesToInput(edited, { source: 'manual', base: f }))).toMatchObject({ arrDayOffset: 1 });
  });
  it('rejects an explicit day offset that makes the flight implausibly long', () => {
    const v = emptyValues({ date: '2024-03-04', from: 'KLAX', to: 'KJFK', depTime: '08:00', arrTime: '16:30', arrDayOffset: 1 });
    expect(validate(v).times).toMatch(/too long/);
  });
  it('pretty-prints flight numbers', () => {
    expect(prettyFlightNumber('ua0123')).toBe('UA 123');
    expect(prettyFlightNumber('n123ab')).toBe('N123AB');
  });
});

describe('usage stats & ranking', () => {
  const flights = [
    flight({ id: 'a', from: 'KSAN', to: 'KSFO', airlineIcao: 'ASA', aircraftType: 'A320' }),
    flight({ id: 'b', from: 'KSAN', to: 'KEWR' }),
    flight({ id: 'c', from: 'KSAN', to: 'KSFO' }),
    flight({ id: 'd', from: 'KLAX', to: 'KSFO' }),
  ];
  it('derives recent, frequent and route partners', () => {
    const s = usageStats(flights);
    expect(s.recentAirports.slice(0, 2)).toEqual(['KSFO', 'KSAN']);
    expect(s.frequentAirports[0]).toBe('KSFO');
    expect(routePartners(s, 'KSAN')).toEqual(['KSFO', 'KEWR']);
    expect(routePartners(s, 'KSFO', true)).toEqual(['KSAN', 'KLAX']);
    expect(s.airlines[0]).toBe('ASA');
    expect(s.aircraft[0]).toBe('A320');
  });
  it('boosts used items unless the top hit is an exact code', () => {
    const items = ['X', 'Y', 'Z'];
    expect(boostUsed(items, ['Z'], (i) => i, () => false)).toEqual(['Z', 'X', 'Y']);
    expect(boostUsed(items, ['Z'], (i) => i, (i) => i === 'X')).toEqual(items);
  });
});

describe('year picker', () => {
  it('reaches back to 1903 and to an older imported year', () => {
    const y = yearOptions(2026, '2024-01-01');
    expect(y[0]).toBe(2027);
    expect(y[y.length - 1]).toBe(1903);
    expect(yearOptions(2026, '1925-01-01')).toContain(1925);
    const old = yearOptions(2026, '1890-01-01');
    expect(old[old.length - 1]).toBe(1890);
    expect(yearOptions(2026, '')).toContain(1903);
  });
});

describe('format helpers', () => {
  it('builds flags and tz abbreviations', () => {
    expect(flagEmoji('us')).toBe('🇺🇸');
    expect(flagEmoji('')).toBe('');
    expect(tzAbbr('America/Los_Angeles', '2024-07-01')).toBe('PDT');
    expect(tzAbbr('America/Los_Angeles', '2024-01-01')).toBe('PST');
    expect(tzAbbr(undefined)).toBe('');
  });
});
