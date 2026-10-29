import { describe, it, expect } from 'vitest';
import { asFlights, defaultDistanceUnit, normalizeShare, publicFields, publicFlights, sharedSummary, validHandle, publicHandleFromPath } from './profile';
import { applyPatch, parseView } from './journal-state';
import type { Flight } from '@/lib/types';
const base = {
  id: 'private-id',
  from: 'KSAN',
  to: 'KLAX',
  date: '2024-01-14',
  datePrecision: 'day',
  note: 'secret',
  seatNumber: '12A',
  registration: 'N123',
  flightNumber: 'UA1',
  depTime: '10:30',
  createdAt: 1,
  updatedAt: 2,
  source: 'manual',
  airlineIcao: 'UAL',
  aircraftType: 'B738',
} as Flight;
describe('public flight projection', () => {
  it('uses an explicit field allowlist and hides exact dates by default', () => {
    expect(publicFlights([base], false, '2026-10-28')).toEqual([
      {
        from: 'KSAN',
        to: 'KLAX',
        date: '2024-01-01',
        datePrecision: 'month',
        airlineIcao: 'UAL',
        aircraftType: 'B738',
      },
    ]);
  });
  it('only includes flights before today, conservatively handling partial dates', () => {
    const flights = [
      base,
      { ...base, date: '2026-10-28' },
      { ...base, date: '2026-11-01' },
      { ...base, date: '2026-10-01', datePrecision: 'month' as const },
      { ...base, date: '2026-01-01', datePrecision: 'year' as const },
    ];
    expect(publicFlights(flights, true, '2026-10-28')).toHaveLength(1);
    expect(publicFlights([base], true, '2026-10-28')[0].date).toBe(
      '2024-01-14',
    );
  });
  it('adds only the categories the owner switches on, normalized like the database', () => {
    const rich = { ...base, arrTime: '12:05', arrDayOffset: 0, durationMin: 95.6, cabinClass: 'first', seatType: 'aisle', reason: 'business', airlineName: 'Typed' } as Flight;
    const keys = (share: Parameters<typeof publicFlights>[3]) => Object.keys(publicFlights([rich], false, '2026-10-28', share)[0]).sort();
    const basics = ['aircraftType', 'airlineIcao', 'date', 'datePrecision', 'from', 'to'];
    expect(keys({})).toEqual(basics);
    expect(keys({ times: true })).toEqual([...basics, 'arrDayOffset', 'arrTime', 'depTime', 'durationMin'].sort());
    const all = publicFlights([rich], true, '2026-10-28', { times: true, cabin: true, seat: true, reason: true, flightNumber: true, registration: true })[0];
    expect(all).toMatchObject({ durationMin: 96, cabinClass: 'first', seatNumber: '12A', seatType: 'aisle', reason: 'business', flightNumber: 'UA1', registration: 'N123' });
    for (const k of ['note', 'airlineName', 'id', 'source', 'createdAt', 'updatedAt']) expect(all).not.toHaveProperty(k);
    // Malformed values are dropped, never the flight.
    const odd = publicFlights([{ ...rich, depTime: '9:30', seatNumber: '12AB', cabinClass: 'coach' } as unknown as Flight], false, '2026-10-28', { times: true, seat: true, cabin: true })[0];
    expect(odd).not.toHaveProperty('depTime');
    expect(odd).not.toHaveProperty('seatNumber');
    expect(odd).not.toHaveProperty('cabinClass');
    expect(odd.seatType).toBe('aisle');
  });
  it('keeps only known share switches that are on', () => {
    expect(normalizeShare({ times: true, seat: false, notes: true, cabin: 'yes' })).toEqual({ times: true });
    expect(normalizeShare(null)).toEqual({});
  });
  it('reserves application routes and enforces canonical handles', () => {
    for (const slug of [
      'ab',
      'Jordan',
      'jordan-',
      '-jordan',
      'settings',
      'api',
      'a/b',
      'a'.repeat(31),
    ])
      expect(validHandle(slug)).toBe(false);
    expect(validHandle('jordan-4')).toBe(true);
    expect(publicHandleFromPath('/jordan')).toBe('jordan');
    expect(publicHandleFromPath('/assets/main.js')).toBeNull();
    expect(publicHandleFromPath('/')).toBeNull();
  });
});

describe('public journal fields and view state', () => {
  it('never offers private fields; exact dates only when shared', () => {
    const month = publicFields(publicFlights([base], false, '2026-10-28'));
    expect(month).toEqual({ times: false, cabin: false, seat: false, reason: false, registration: false, flightNumber: false, exactDates: false });
    expect(publicFields(publicFlights([base], true, '2026-10-28')).exactDates).toBe(true);
    expect(publicFields([]).exactDates).toBe(false);
  });
  it('reports exactly the categories present in the shared flights', () => {
    const shared = publicFlights([base], false, '2026-10-28', { times: true, seat: true, flightNumber: true });
    expect(publicFields(shared)).toEqual({ times: true, cabin: false, seat: true, reason: false, registration: false, flightNumber: true, exactDates: false });
    expect(sharedSummary(publicFields(shared))).toBe('routes, months, airlines, aircraft types, flight times, seats, flight numbers and saved trips');
    expect(sharedSummary(publicFields([]))).toBe('routes, months, airlines, aircraft types and saved trips');
  });
  it('picks a customary distance unit for visitors', () => {
    expect(defaultDistanceUnit('en-US')).toBe('mi');
    expect(defaultDistanceUnit('en-GB')).toBe('mi');
    expect(defaultDistanceUnit('de-DE')).toBe('km');
    expect(defaultDistanceUnit('not a locale')).toBe('km');
  });
  it('keeps journal views in the query string, separate from app hash routes', () => {
    expect(parseView(null)).toBe('overview');
    expect(parseView('map')).toBe('map');
    expect(parseView('settings')).toBe('overview');
    expect(applyPatch('', { view: 'stats', year: '2019' })).toBe('?view=stats&year=2019');
    expect(applyPatch('?view=stats&year=2019', { year: null })).toBe('?view=stats');
    expect(applyPatch('?view=map', { view: null })).toBe('');
  });
});

describe('public flight order', () => {
  it('keeps legs of a saved trip in sequence when only months are shared', async () => {
    const { savedTrips } = await import('./PublicTripList');
    const leg = (from: string, to: string) => ({ date: '2026-06-01', datePrecision: 'month' as const, from, to, tripId: 't1', tripName: 'Europe' });
    // Newest first, as the server sends them.
    const flights = asFlights([leg('CDG', 'LAX'), leg('LHR', 'CDG'), leg('LAX', 'LHR')]).sort((a, b) => b.date.localeCompare(a.date));
    const [trip] = savedTrips(flights);
    expect(trip.flights.map((f) => `${f.from}-${f.to}`)).toEqual(['LAX-LHR', 'LHR-CDG', 'CDG-LAX']);
  });
});
