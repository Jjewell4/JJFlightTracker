import { describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import {
  airlineHistory,
  airportHistory,
  airportKeyOf,
  airportPlace,
  resolveAirlineParam,
  resolveAirportParam,
  tzDeltaLabel,
  yearSeries,
} from './explore-logic';
import { airlineHref, airportHref } from './links';

installReference();

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

const opts = { now: Date.UTC(2026, 9, 29, 12), today: '2026-10-29' };

describe('links', () => {
  it('builds encoded hrefs', () => {
    expect(airportHref('KSAN')).toBe('/airports/KSAN');
    expect(airportHref('ksan')).toBe('/airports/KSAN');
    expect(airlineHref('ASA')).toBe('/airlines/ASA');
    expect(airlineHref('name:acme air')).toBe('/airlines/name%3Aacme%20air');
  });
});

describe('resolveAirportParam', () => {
  it('accepts idents and redirects IATA / lower case to the ident', () => {
    expect(resolveAirportParam('KSAN')).toMatchObject({ key: 'KSAN', redirect: undefined });
    expect(resolveAirportParam('KSAN').airport?.iata).toBe('SAN');
    expect(resolveAirportParam('SAN')).toMatchObject({ key: 'KSAN', redirect: 'KSAN' });
    expect(resolveAirportParam('lhr')).toMatchObject({ key: 'EGLL', redirect: 'EGLL' });
  });

  it('keeps unknown codes (upper-cased) without an airport', () => {
    const r = resolveAirportParam('kxyz-unknown');
    expect(r.airport).toBeUndefined();
    expect(r.key).toBe('KXYZ-UNKNOWN');
    expect(r.redirect).toBe('KXYZ-UNKNOWN');
    expect(resolveAirportParam('KXYZ-UNKNOWN').redirect).toBeUndefined();
    expect(resolveAirportParam(undefined).key).toBe('');
  });

  it('decodes escaped params once', () => {
    expect(resolveAirportParam('K%53AN').key).toBe('KSAN');
  });
});

describe('resolveAirlineParam', () => {
  it('maps IATA codes to the ICAO key like airlineKey()', () => {
    expect(resolveAirlineParam('ASA')).toMatchObject({ key: 'ASA', redirect: undefined });
    expect(resolveAirlineParam('ASA').airline?.name).toMatch(/Alaska/);
    expect(resolveAirlineParam('AS')).toMatchObject({ key: 'ASA', redirect: 'ASA' });
    expect(resolveAirlineParam('asa')).toMatchObject({ key: 'ASA', redirect: 'ASA' });
  });

  it('handles name keys and unknown codes', () => {
    expect(resolveAirlineParam('name:Acme  Air!')).toMatchObject({ key: 'name:acme air', redirect: 'name:acme air' });
    expect(resolveAirlineParam('name%3Aacme%20air')).toMatchObject({ key: 'name:acme air' });
    const unknown = resolveAirlineParam('XQZ');
    expect(unknown.key).toBe('XQZ');
    expect(unknown.airline).toBeUndefined();
  });
});

describe('airportHistory', () => {
  const flights: Flight[] = [
    fl({ date: '2026-12-01', from: 'KSAN', to: 'KSEA', airlineIcao: 'ASA', airlineIata: 'AS' }), // upcoming
    fl({ date: '2025-06-10', from: 'KSFO', to: 'KSAN', airlineIcao: 'UAL', aircraftType: 'B739', depTime: '09:00' }),
    fl({ date: '2025-06-01', from: 'KSAN', to: 'KSFO', airlineIcao: 'UAL', aircraftType: 'B739', depTime: '07:00' }),
    fl({ date: '2023-02-01', from: 'KSAN', to: 'KSEA', airlineIcao: 'ASA', aircraftType: 'B38M' }),
    fl({ date: '2022-08-01', from: 'KLAX', to: 'EGLL', airlineIcao: 'BAW' }),
    fl({ date: '2021-01-15', from: 'SAN', to: 'ZZZ' }), // IATA + an unknown airport
  ];

  it('counts visits as departures + arrivals and excludes upcoming flights', () => {
    const h = airportHistory(flights, 'KSAN', opts);
    expect(h.airport?.iata).toBe('SAN');
    expect(h.flights).toHaveLength(4);
    expect(h.upcoming).toHaveLength(1);
    expect(h.departures).toBe(3);
    expect(h.arrivals).toBe(1);
    expect(h.visits).toBe(4);
    expect(h.firstFlight?.date).toBe('2021-01-15');
    expect(h.lastFlight?.date).toBe('2025-06-10');
    expect(h.distanceKm).toBeGreaterThan(2 * 700);
  });

  it('ranks destinations with direction counts', () => {
    const h = airportHistory(flights, 'KSAN', opts);
    expect(h.destinations.map((d) => d.key)).toEqual(['KSFO', 'KSEA', 'ZZZ']);
    expect(h.destinations[0]).toMatchObject({ count: 2, outbound: 1, inbound: 1 });
    expect(h.destinations[2].airport).toBeUndefined();
    expect(h.destinationCountries).toBe(1);
  });

  it('ranks airlines and aircraft and fills the per-year series through this year', () => {
    const h = airportHistory(flights, 'KSAN', opts);
    expect(h.airlines[0]).toMatchObject({ key: 'UAL', count: 2 });
    expect(h.aircraft[0]).toMatchObject({ key: 'B739', count: 2 });
    expect(h.perYear.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    expect(h.perYear.find((y) => y.year === 2025)?.count).toBe(2);
    expect(h.perYear.find((y) => y.year === 2022)?.count).toBe(0);
  });

  it('accepts an IATA key and matches unknown raw codes', () => {
    expect(airportHistory(flights, 'SAN', opts).visits).toBe(4);
    const z = airportHistory(flights, 'zzz', opts);
    expect(z.airport).toBeUndefined();
    expect(z.visits).toBe(1);
    expect(z.arrivals).toBe(1);
    expect(z.destinations[0].key).toBe('KSAN');
  });

  it('is empty (not broken) for airports never visited', () => {
    const h = airportHistory(flights, 'RJTT', opts);
    expect(h.airport?.iata).toBe('HND');
    expect(h.visits).toBe(0);
    expect(h.flights).toEqual([]);
    expect(h.perYear).toEqual([]);
    expect(h.firstFlight).toBeUndefined();
  });

  it('counts a same-airport flight once as departure and once as arrival', () => {
    const h = airportHistory([fl({ from: 'KSAN', to: 'KSAN' })], 'KSAN', opts);
    expect(h).toMatchObject({ visits: 2, departures: 1, arrivals: 1 });
    expect(h.destinations).toEqual([]);
  });
});

describe('airlineHistory', () => {
  const flights: Flight[] = [
    fl({ date: '2026-12-24', airlineIcao: 'ASA', from: 'KSAN', to: 'PANC' }), // upcoming
    fl({ date: '2025-05-01', airlineIcao: 'ASA', airlineIata: 'AS', from: 'KSEA', to: 'KSAN', cabinClass: 'first', seatType: 'window', aircraftType: 'B739' }),
    fl({ date: '2024-05-01', airlineIata: 'AS', from: 'KSAN', to: 'KSEA', cabinClass: 'economy', aircraftType: 'B739' }),
    fl({ date: '2023-01-01', airlineIcao: 'ASA', from: 'KSAN', to: 'KPDX', durationMin: 140 }),
    fl({ date: '2023-01-02', airlineIcao: 'UAL', from: 'KSAN', to: 'KSFO' }),
    fl({ date: '2022-01-02', airlineName: 'Acme Air', from: 'KSAN', to: 'KLAS' }),
  ];

  it('aggregates flights, share, distance and time with IATA-only flights included', () => {
    const h = airlineHistory(flights, 'ASA', opts);
    expect(h.name).toMatch(/Alaska/);
    expect(h.iata).toBe('AS');
    expect(h.icao).toBe('ASA');
    expect(h.country).toBe('United States');
    expect(h.flights).toHaveLength(3);
    expect(h.upcoming).toHaveLength(1);
    expect(h.totalFlights).toBe(5);
    expect(h.share).toBeCloseTo(3 / 5);
    expect(h.distanceKm).toBeGreaterThan(3000);
    expect(h.durationMin).toBeGreaterThan(140);
    expect(h.estimatedDuration).toBe(2);
    expect(h.firstFlight?.date).toBe('2023-01-01');
    expect(h.lastFlight?.date).toBe('2025-05-01');
  });

  it('orients routes from the busier airport and ranks aircraft, airports and cabins', () => {
    const h = airlineHistory(flights, 'ASA', opts);
    expect(h.routes[0]).toMatchObject({ a: 'KSAN', b: 'KSEA', count: 2 });
    expect(h.routes[1]).toMatchObject({ a: 'KSAN', b: 'KPDX', count: 1 });
    expect(h.aircraft[0]).toMatchObject({ key: 'B739', count: 2 });
    expect(h.airports[0]).toMatchObject({ key: 'KSAN', count: 3 });
    expect(h.cabin.known).toBe(2);
    expect(h.cabin.items.find((i) => i.key === 'first')?.count).toBe(1);
    expect(h.seat.known).toBe(1);
    expect(h.perYear.map((y) => [y.year, y.count])).toEqual([
      [2023, 1],
      [2024, 1],
      [2025, 1],
      [2026, 0],
    ]);
  });

  it('supports name keys and unknown keys', () => {
    const acme = airlineHistory(flights, 'name:acme air', opts);
    expect(acme.name).toBe('Acme Air');
    expect(acme.flights).toHaveLength(1);
    const none = airlineHistory(flights, 'XQZ', opts);
    expect(none.flights).toEqual([]);
    expect(none.name).toBe('XQZ');
    expect(none.share).toBe(0);
  });
});

describe('helpers', () => {
  it('resolves airport keys', () => {
    expect(airportKeyOf('SAN')).toBe('KSAN');
    expect(airportKeyOf('zzz')).toBe('ZZZ');
    expect(airportKeyOf(undefined)).toBe('');
  });

  it('fills year gaps and extends to the current year', () => {
    expect(yearSeries(new Map([[2020, 2], [2022, 1]]), 2023)).toEqual([
      { year: 2020, count: 2 },
      { year: 2021, count: 0 },
      { year: 2022, count: 1 },
      { year: 2023, count: 0 },
    ]);
    expect(yearSeries(new Map())).toEqual([]);
    expect(yearSeries(new Map([[2030, 1]]), 2026)).toEqual([{ year: 2030, count: 1 }]);
  });

  it('formats places and time-zone deltas', () => {
    const san = resolveAirportParam('KSAN').airport!;
    expect(airportPlace(san)).toEqual({ city: 'San Diego, CA', country: 'United States' });
    const lhr = resolveAirportParam('EGLL').airport!;
    expect(airportPlace(lhr).country).toBe('United Kingdom');
    expect(tzDeltaLabel(0)).toBe('Same time as you');
    expect(tzDeltaLabel(180)).toBe('3h ahead of you');
    expect(tzDeltaLabel(-330)).toBe('5h 30m behind you');
    expect(tzDeltaLabel(undefined)).toBeUndefined();
  });
});
