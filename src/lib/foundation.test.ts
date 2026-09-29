import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { getAirline, getAirport, searchAirlines, searchAirports } from '@/data/reference';
import { computeDuration, formatDuration } from './time';
import { distanceKm, kmToMiles } from './geo';
import { enrichFlight, parseFlightNumber } from './flight-utils';
import { addFlight, getAllFlights } from './db';

beforeAll(installReference);

describe('reference', () => {
  it('finds airports by code and text', () => {
    expect(getAirport('LAX')?.ident).toBe('KLAX');
    expect(getAirport('klax')?.iata).toBe('LAX');
    expect(searchAirports('LAX')[0].iata).toBe('LAX');
    expect(searchAirports('san francisco')[0].iata).toBe('SFO');
    expect(searchAirports('sao paulo').map((a) => a.iata)).toContain('GRU');
  });
  it('finds airlines', () => {
    expect(getAirline('UA')?.name).toBe('United Airlines');
    expect(getAirline('ASA')?.iata).toBe('AS');
    expect(searchAirlines('united')[0].icao).toBe('UAL');
  });
});

describe('time & geo', () => {
  it('computes tz-aware durations', () => {
    // LAX 08:00 PDT -> JFK 16:30 EDT = 5h30
    const d = computeDuration({ date: '2024-06-01', depTime: '08:00', arrTime: '16:30', fromTz: 'America/Los_Angeles', toTz: 'America/New_York' });
    expect(d).toEqual({ durationMin: 330, arrDayOffset: 0 });
    // red-eye SFO 22:30 -> JFK 07:05 next day
    const r = computeDuration({ date: '2024-01-10', depTime: '22:30', arrTime: '07:05', fromTz: 'America/Los_Angeles', toTz: 'America/New_York' });
    expect(r).toEqual({ durationMin: 335, arrDayOffset: 1 });
    expect(formatDuration(335)).toBe('5h 35m');
  });
  it('computes distance', () => {
    const mi = kmToMiles(distanceKm(getAirport('LAX')!, getAirport('JFK')!));
    expect(mi).toBeGreaterThan(2460);
    expect(mi).toBeLessThan(2480);
  });
});

describe('flight utils', () => {
  it('parses flight numbers', () => {
    expect(parseFlightNumber('ua 0123')).toEqual({ prefix: 'UA', number: '123' });
    expect(parseFlightNumber('B61234')).toEqual({ prefix: 'B6', number: '1234' });
    expect(parseFlightNumber('UAL5')).toEqual({ prefix: 'UAL', number: '5' });
  });
  it('enriches a flight', () => {
    const f = enrichFlight({ date: '2024-06-01', datePrecision: 'day', flightNumber: 'as 1234', from: 'SAN', to: 'SEA', depTime: '07:00', arrTime: '09:45', source: 'manual' });
    expect(f.from).toBe('KSAN');
    expect(f.airlineIcao).toBe('ASA');
    expect(f.flightNumber).toBe('AS1234');
    expect(f.durationMin).toBe(165);
    expect(f.distanceKm).toBeGreaterThan(1600);
  });
});

describe('db', () => {
  it('stores flights', async () => {
    await addFlight({ date: '2024-01-01', datePrecision: 'day', from: 'KLAX', to: 'KSFO', source: 'manual' });
    expect((await getAllFlights()).length).toBe(1);
  });
});
