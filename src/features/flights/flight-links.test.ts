import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import { buildIcs, isTrackable, trackingLinks } from './flight-links';

beforeAll(installReference);

const base: Flight = {
  id: 'f1', date: '2026-11-15', datePrecision: 'day', from: 'KSAN', to: 'KJFK', flightNumber: 'AS1234',
  depTime: '22:30', arrTime: '07:05', arrDayOffset: 1, source: 'manual', createdAt: 0, updatedAt: 0,
};

describe('tracking links', () => {
  it('builds Flightradar24 and FlightAware links', () => {
    expect(trackingLinks({ flightNumber: 'AS1234' })).toEqual([
      { label: 'Flightradar24', url: 'https://www.flightradar24.com/data/flights/as1234' },
      { label: 'FlightAware', url: 'https://flightaware.com/live/flight/ASA1234' },
    ]);
    expect(trackingLinks({ flightNumber: undefined })).toEqual([]);
  });
  it('is trackable only around the day of travel', () => {
    expect(isTrackable(base, '2026-11-15')).toBe(true);
    expect(isTrackable(base, '2026-11-14')).toBe(true);
    expect(isTrackable(base, '2026-11-17')).toBe(false);
    expect(isTrackable({ ...base, flightNumber: undefined }, '2026-11-15')).toBe(false);
  });
});

describe('calendar export', () => {
  it('converts local times to UTC across time zones and the date line of an overnight flight', () => {
    const ics = buildIcs(base, Date.UTC(2026, 9, 1))!;
    expect(ics).toContain('DTSTART:20261116T063000Z'); // 22:30 PST = 06:30Z next day
    expect(ics).toContain('DTEND:20261116T120500Z'); // 07:05 EST = 12:05Z
    expect(ics).toContain('SUMMARY:✈ AS1234 SAN → JFK');
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);
  });
  it('makes an all-day event without times and skips imprecise dates', () => {
    const ics = buildIcs({ ...base, depTime: undefined, arrTime: undefined })!;
    expect(ics).toContain('DTSTART;VALUE=DATE:20261115');
    expect(buildIcs({ ...base, datePrecision: 'month' })).toBeUndefined();
  });
  it('escapes notes', () => {
    expect(buildIcs({ ...base, note: 'Window, row 12; bring snacks' })).toContain('Window\\, row 12\\; bring snacks');
  });
});
