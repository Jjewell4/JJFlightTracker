import { describe, it, expect } from 'vitest';
import { defaultDistanceUnit, publicFields, publicFlights, validHandle, publicHandleFromPath } from './profile';
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
