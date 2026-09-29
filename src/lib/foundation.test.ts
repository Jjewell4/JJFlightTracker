import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { getAirline, getAirport, searchAirlines, searchAirports } from '@/data/reference';
import { addDays, computeDuration, formatDuration } from './time';
import { distanceKm, greatCirclePoints, kmToMiles } from './geo';
import { enrichFlight, flownFlights, isUpcoming, parseFlightNumber } from './flight-utils';
import { addFlight, getAllFlights, getSettings, saveSettings } from './db';

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
  it('rejects explicit day offsets that give a duration of a day or more', () => {
    const base = { date: '2024-06-01', depTime: '08:00', arrTime: '16:30', fromTz: 'America/Los_Angeles', toTz: 'America/New_York' };
    expect(computeDuration({ ...base, arrDayOffset: 1 })).toBeUndefined();
    expect(computeDuration({ ...base, arrDayOffset: 0 })).toEqual({ durationMin: 330, arrDayOffset: 0 });
  });
  it('addDays never throws on malformed input', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('garbage', 1)).toBe('garbage');
    expect(addDays('2024-01-01', 1e12)).toBe('2024-01-01');
    expect(addDays('2024-01-01', NaN)).toBe('2024-01-01');
  });
  it('assumes the known zone when one airport has none', () => {
    // LGB 09:00 PDT -> a strip missing from the dataset, 10:10 local: same day, 1h10
    const d = computeDuration({ date: '2024-05-04', depTime: '09:00', arrTime: '10:10', fromTz: 'America/Los_Angeles' });
    expect(d).toEqual({ durationMin: 70, arrDayOffset: 0 });
  });
  it('draws great-circle arcs, including between antipodal points, without NaN', () => {
    const lax = { lat: 33.94, lon: -118.41 };
    const jfk = { lat: 40.64, lon: -73.78 };
    const arc = greatCirclePoints(lax, jfk, 32);
    expect(arc).toHaveLength(33);
    expect(arc[0][0]).toBeCloseTo(-118.41, 6);
    expect(arc[32][1]).toBeCloseTo(40.64, 6);
    for (const [a, b] of [
      [{ lat: 10, lon: 20 }, { lat: -10, lon: -160 }],
      [{ lat: 90, lon: 0 }, { lat: -90, lon: 0 }],
      [{ lat: 0, lon: 0 }, { lat: 0, lon: 180 }],
    ]) {
      const pts = greatCirclePoints(a, b, 16);
      expect(pts.length).toBeGreaterThanOrEqual(2);
      expect(pts.flat().every(Number.isFinite)).toBe(true);
      expect(pts[0][1]).toBeCloseTo(a.lat, 6);
      expect(pts[pts.length - 1][1]).toBeCloseTo(b.lat, 6);
    }
    expect(greatCirclePoints({ lat: NaN, lon: 0 }, jfk)).toEqual([]);
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

describe('flown vs upcoming', () => {
  it('keeps only flights that have departed', () => {
    const now = Date.parse('2026-09-29T20:00:00Z'); // 13:00 in San Diego
    const today = '2026-09-29';
    const base = { datePrecision: 'day' as const, from: 'KSAN', to: 'KSEA', source: 'manual' as const, createdAt: 0, updatedAt: 0 };
    const flights = [
      { ...base, id: 'past', date: '2026-09-01' },
      { ...base, id: 'earlier-today', date: today, depTime: '08:00' },
      { ...base, id: 'later-today', date: today, depTime: '18:00' },
      { ...base, id: 'future', date: '2026-10-20' },
      { ...base, id: 'year-only', date: '2027-01-01', datePrecision: 'year' as const },
    ];
    expect(isUpcoming(flights[2], now, today)).toBe(true);
    expect(flownFlights(flights, now, today).map((f) => f.id)).toEqual(['past', 'earlier-today', 'year-only']);
  });
});

describe('db', () => {
  it('stores flights', async () => {
    await addFlight({ date: '2024-01-01', datePrecision: 'day', from: 'KLAX', to: 'KSFO', source: 'manual' });
    expect((await getAllFlights()).length).toBe(1);
  });
  it('keeps every field from concurrent settings saves', async () => {
    await Promise.all([saveSettings({ clock: '24h' }), saveSettings({ theme: 'dark' }), saveSettings({ distanceUnit: 'km' })]);
    expect(await getSettings()).toMatchObject({ clock: '24h', theme: 'dark', distanceUnit: 'km' });
  });
});
