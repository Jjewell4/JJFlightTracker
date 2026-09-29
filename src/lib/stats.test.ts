import { describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { getAirport } from '@/data/reference';
import { distanceKm, estimateDurationMin } from './geo';
import type { Flight } from './types';
import {
  EARTH_CIRCUMFERENCE_KM,
  MOON_DISTANCE_KM,
  aircraftManufacturer,
  airlineKey,
  availableYears,
  co2PerPassengerKg,
  computeStats,
  computeTotals,
  filterByYear,
  flagEmoji,
  flightsByHour,
  flightsByMonth,
  flightsByWeekday,
  flightsByYear,
  haulBand,
  isPlausibleDuration,
  isoWeekday,
  longestMonthStreak,
  rankAirlines,
  rankAirports,
  rankRoutes,
  resolveFlight,
  routeKey,
  summarizeTotals,
} from './stats';

installReference();

let seq = 0;
function fl(p: Partial<Flight> & Pick<Flight, 'from' | 'to'>): Flight {
  seq++;
  return {
    id: `f${seq}`,
    date: '2024-03-04',
    datePrecision: 'day',
    source: 'manual',
    createdAt: seq,
    updatedAt: seq,
    ...p,
  };
}

const km = (a: string, b: string) => distanceKm(getAirport(a)!, getAirport(b)!);

describe('helpers', () => {
  it('computes ISO weekdays (Monday = 0)', () => {
    expect(isoWeekday('2024-03-04')).toBe(0); // Monday
    expect(isoWeekday('2024-03-10')).toBe(6); // Sunday
    expect(isoWeekday('garbage')).toBeUndefined();
  });
  it('builds direction-agnostic route keys', () => {
    expect(routeKey('KSFO', 'KLAX')).toBe('KLAX-KSFO');
    expect(routeKey('KLAX', 'KSFO')).toBe('KLAX-KSFO');
  });
  it('makes flag emoji', () => {
    expect(flagEmoji('us')).toBe('🇺🇸');
    expect(flagEmoji('GB')).toBe('🇬🇧');
    expect(flagEmoji('')).toBe('');
    expect(flagEmoji('USA')).toBe('');
  });
  it('keys airlines by ICAO, IATA (resolved) or name', () => {
    expect(airlineKey({ airlineIcao: 'ual' })).toBe('UAL');
    expect(airlineKey({ airlineIata: 'UA' })).toBe('UAL');
    expect(airlineKey({ airlineName: 'Tiny Air!' })).toBe('name:tiny air');
    expect(airlineKey({})).toBeUndefined();
  });
  it('lists and filters years', () => {
    const fs = [fl({ from: 'LAX', to: 'SFO', date: '2022-01-01' }), fl({ from: 'LAX', to: 'SFO', date: '2024-01-01' }), fl({ from: 'LAX', to: 'SFO', date: '2024-05-01' })];
    expect(availableYears(fs)).toEqual([2024, 2022]);
    expect(filterByYear(fs, 2024)).toHaveLength(2);
    expect(filterByYear(fs, 'all')).toHaveLength(3);
    expect(filterByYear(fs, 2023)).toHaveLength(0);
  });
});

describe('resolveFlight', () => {
  it('computes distance from airports and estimates duration when missing', () => {
    const r = resolveFlight(fl({ from: 'KLAX', to: 'KJFK' }));
    expect(r.distanceKm).toBeCloseTo(km('LAX', 'JFK'), 0);
    expect(r.durationEstimated).toBe(true);
    expect(r.durationMin).toBe(estimateDurationMin(r.distanceKm!));
    expect(r.international).toBe(false);
  });
  it('prefers cached distance and real duration', () => {
    const r = resolveFlight(fl({ from: 'KLAX', to: 'KJFK', distanceKm: 4000, durationMin: 320 }));
    expect(r.distanceKm).toBe(4000);
    expect(r.durationMin).toBe(320);
    expect(r.durationEstimated).toBe(false);
  });
  it('replaces implausible durations with an estimate', () => {
    // SAN–PHX (~480 km) in 12 minutes, and LHR–SAN in 19½ hours: both bogus.
    const fast = resolveFlight(fl({ from: 'KSAN', to: 'KPHX', durationMin: 12 }));
    expect(fast).toMatchObject({ durationImplausible: true, durationEstimated: true });
    expect(fast.durationMin).toBe(estimateDurationMin(fast.distanceKm!));
    expect(resolveFlight(fl({ from: 'EGLL', to: 'KSAN', durationMin: 1176 })).durationImplausible).toBe(true);
    expect(resolveFlight(fl({ from: 'EGLL', to: 'KSAN', durationMin: 665 })).durationImplausible).toBe(false);
    expect(resolveFlight(fl({ from: 'KSAN', to: 'KPHX', durationMin: 75 })).durationImplausible).toBe(false);
    expect(isPlausibleDuration(60, 0)).toBe(true);
  });
  it('handles unknown airports gracefully', () => {
    const r = resolveFlight(fl({ from: 'ZZZZ', to: 'KLAX' }));
    expect(r.distanceKm).toBeUndefined();
    expect(r.durationMin).toBeUndefined();
    expect(r.international).toBeUndefined();
    expect(r.fromKey).toBe('ZZZZ');
    expect(r.co2Kg).toBe(0);
  });
  it('respects date precision', () => {
    expect(resolveFlight(fl({ from: 'LAX', to: 'SFO', date: '2024-03-01', datePrecision: 'month' }))).toMatchObject({ month: 3, weekday: undefined });
    expect(resolveFlight(fl({ from: 'LAX', to: 'SFO', date: '2024-01-01', datePrecision: 'year' }))).toMatchObject({ month: undefined, weekday: undefined, year: 2024 });
    expect(resolveFlight(fl({ from: 'LAX', to: 'SFO', depTime: '07:45' })).hour).toBe(7);
    expect(resolveFlight(fl({ from: 'LAX', to: 'SFO', depTime: 'bad' })).hour).toBeUndefined();
  });
});

describe('CO2 model', () => {
  it('uses haul bands and cabin multipliers', () => {
    expect(haulBand(500)).toBe('short');
    expect(haulBand(1500)).toBe('short');
    expect(haulBand(3000)).toBe('medium');
    expect(haulBand(9000)).toBe('long');
    expect(co2PerPassengerKg(1000)).toBeCloseTo(140);
    expect(co2PerPassengerKg(3000)).toBeCloseTo(345);
    expect(co2PerPassengerKg(10000)).toBeCloseTo(1000);
    expect(co2PerPassengerKg(10000, 'business')).toBeCloseTo(2500);
    expect(co2PerPassengerKg(1000, 'first')).toBeCloseTo(490);
    expect(co2PerPassengerKg(0)).toBe(0);
    expect(co2PerPassengerKg(Number.NaN)).toBe(0);
  });
  it('lands a realistic mix near ~0.12 kg/km', () => {
    const fs = [
      fl({ from: 'SAN', to: 'SFO' }),
      fl({ from: 'SFO', to: 'SAN' }),
      fl({ from: 'SAN', to: 'ORD' }),
      fl({ from: 'ORD', to: 'SAN' }),
      fl({ from: 'LAX', to: 'JFK' }),
      fl({ from: 'JFK', to: 'LAX' }),
      fl({ from: 'LAX', to: 'LHR' }),
      fl({ from: 'LHR', to: 'LAX' }),
    ];
    const t = summarizeTotals(fs);
    const perKm = t.co2Kg / t.distanceKm;
    expect(perKm).toBeGreaterThan(0.1);
    expect(perKm).toBeLessThan(0.13);
  });
});

describe('totals', () => {
  it('sums distance, time, domestic/international and comparisons', () => {
    const fs = [
      fl({ from: 'KLAX', to: 'KSFO', durationMin: 80 }),
      fl({ from: 'KSFO', to: 'KLAX' }), // duration estimated
      fl({ from: 'KLAX', to: 'EGLL', durationMin: 630 }),
      fl({ from: 'XXXX', to: 'KLAX' }), // unknown airport
    ];
    const t = computeTotals(fs.map(resolveFlight));
    const d = 2 * km('LAX', 'SFO') + km('LAX', 'LHR');
    expect(t.flights).toBe(4);
    expect(t.domestic).toBe(2);
    expect(t.international).toBe(1);
    expect(t.unknownScope).toBe(1);
    expect(t.distanceKm).toBeCloseTo(d, 3);
    expect(t.distanceMi).toBeCloseTo(d / 1.609344, 3);
    expect(t.missingDistance).toBe(1);
    expect(t.aroundEarth).toBeCloseTo(d / EARTH_CIRCUMFERENCE_KM, 6);
    expect(t.toMoon).toBeCloseTo(d / MOON_DISTANCE_KM, 6);
    expect(t.estimatedDuration).toBe(1);
    expect(t.missingDuration).toBe(1);
    expect(t.durationMin).toBe(80 + 630 + estimateDurationMin(km('SFO', 'LAX')));
    expect(t.days).toBeCloseTo(t.durationMin / 1440);
    expect(t.avgDistanceKm).toBeCloseTo(d / 3, 3);
  });
  it('is all zeros for no flights', () => {
    const t = computeTotals([]);
    expect(t).toMatchObject({ flights: 0, distanceKm: 0, durationMin: 0, avgDistanceKm: 0, avgDurationMin: 0, co2Kg: 0 });
  });
  it('counts domestic relative to the same country, not the home country', () => {
    const t = summarizeTotals([fl({ from: 'EGLL', to: 'EGPH' }), fl({ from: 'EGLL', to: 'LFPG' })]);
    expect(t.domestic).toBe(1);
    expect(t.international).toBe(1);
  });
});

describe('distributions', () => {
  const fs = [
    fl({ from: 'LAX', to: 'SFO', date: '2023-12-31', depTime: '06:10' }), // Sunday
    fl({ from: 'SFO', to: 'LAX', date: '2024-01-01', depTime: '18:30' }), // Monday
    fl({ from: 'LAX', to: 'SEA', date: '2024-01-01', depTime: '21:00' }), // Monday
    fl({ from: 'SEA', to: 'LAX', date: '2024-02-01', datePrecision: 'month' }),
    fl({ from: 'LAX', to: 'JFK', date: '2026-01-01', datePrecision: 'year' }),
  ];
  const rs = fs.map(resolveFlight);

  it('fills year gaps', () => {
    const y = flightsByYear(rs);
    expect(y.map((b) => b.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(y.map((b) => b.flights)).toEqual([1, 3, 0, 1]);
    expect(y[1].distanceKm).toBeGreaterThan(0);
  });
  it('excludes year-precision flights from months', () => {
    const m = flightsByMonth(rs);
    expect(m).toHaveLength(12);
    expect(m[0].flights).toBe(2); // Jan 2024 x2 (the Jan 2026 one is year precision)
    expect(m[1].flights).toBe(1);
    expect(m[11].flights).toBe(1);
    expect(m.reduce((a, b) => a + b.flights, 0)).toBe(4);
  });
  it('uses day precision only for weekdays', () => {
    const w = flightsByWeekday(rs);
    expect(w[0]).toBe(2);
    expect(w[6]).toBe(1);
    expect(w.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('bins departure hours', () => {
    const h = flightsByHour(rs);
    expect(h[6]).toBe(1);
    expect(h[18]).toBe(1);
    expect(h[21]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it('returns empty series for no flights', () => {
    expect(flightsByYear([])).toEqual([]);
    expect(flightsByWeekday([]).every((x) => x === 0)).toBe(true);
  });
});

describe('rankings', () => {
  const fs = [
    fl({ from: 'KLAX', to: 'KSFO', airlineIcao: 'UAL', airlineIata: 'UA' }),
    fl({ from: 'KSFO', to: 'KLAX', airlineIata: 'UA' }),
    fl({ from: 'KLAX', to: 'KSEA', airlineIcao: 'ASA' }),
    fl({ from: 'KSEA', to: 'KSFO', airlineName: 'Mystery Air' }),
  ];
  const rs = fs.map(resolveFlight);

  it('ranks airports by departures + arrivals', () => {
    const a = rankAirports(rs);
    expect(a[0]).toMatchObject({ key: 'KLAX', count: 3, departures: 2, arrivals: 1 });
    expect(a[1]).toMatchObject({ key: 'KSFO', count: 3 });
    expect(a.map((x) => x.key)).toHaveLength(3);
  });
  it('ranks routes direction-agnostically', () => {
    const r = rankRoutes(rs);
    expect(r[0]).toMatchObject({ key: 'KLAX-KSFO', count: 2 });
    expect(r[0].airportA?.iata).toBe('LAX');
    expect(r).toHaveLength(3);
  });
  it('merges airlines by code and keeps name-only airlines', () => {
    const a = rankAirlines(rs);
    expect(a[0]).toMatchObject({ key: 'UAL', count: 2, name: 'United Airlines', iata: 'UA' });
    expect(a.find((x) => x.key === 'name:mystery air')?.name).toBe('Mystery Air');
    expect(a[0].distanceKm).toBeCloseTo(2 * km('LAX', 'SFO'), 3);
  });
});

describe('records & streaks', () => {
  it('finds the longest month streak across year boundaries', () => {
    const rs = ['2023-11-02', '2023-12-15', '2024-01-03', '2024-01-20', '2024-03-01', '2024-04-01'].map((date) => resolveFlight(fl({ from: 'LAX', to: 'SFO', date })));
    expect(longestMonthStreak(rs)).toEqual({ months: 3, start: '2023-11', end: '2024-01' });
    expect(longestMonthStreak([])).toBeUndefined();
  });

  it('computes records', () => {
    const fs = [
      fl({ id: 'short', from: 'KLAX', to: 'KSAN', date: '2019-05-01', durationMin: 55 }),
      fl({ id: 'long', from: 'KLAX', to: 'EGLL', date: '2020-01-01', durationMin: 620 }),
      fl({ id: 'est', from: 'KLAX', to: 'KJFK', date: '2019-05-01', depTime: '23:00' }),
      fl({ id: 'first', from: 'KSFO', to: 'KLAX', date: '2019-05-01', depTime: '06:00', durationMin: 70 }),
      fl({ id: 'yr', from: 'KSFO', to: 'KLAX', date: '2021-01-01', datePrecision: 'year' }),
    ];
    const s = computeStats(fs);
    expect(s.records.longestDistance?.flight.id).toBe('long');
    expect(s.records.shortestDistance?.flight.id).toBe('short');
    expect(s.records.longestDuration).toMatchObject({ value: 620, estimated: false });
    expect(s.records.longestDuration?.flight.id).toBe('long');
    expect(s.records.shortestDuration?.flight.id).toBe('short');
    expect(s.records.first?.id).toBe('short'); // 2019-05-01 without time sorts first (00:00)
    expect(s.records.latest?.id).toBe('yr');
    expect(s.records.busiestYear).toEqual({ year: 2019, flights: 3 });
    expect(s.records.busiestMonth).toEqual({ month: '2019-05', flights: 3 });
    expect(s.records.busiestDay).toEqual({ date: '2019-05-01', flights: 3 });
    expect(s.records.mostVisitedAirport?.key).toBe('KLAX');
    expect(s.records.mostFlownRoute?.key).toBe('KLAX-KSFO');
  });

  it('falls back to estimated durations when no real ones exist', () => {
    const s = computeStats([fl({ from: 'LAX', to: 'SFO' }), fl({ from: 'LAX', to: 'JFK' })]);
    expect(s.records.longestDuration?.estimated).toBe(true);
    expect(s.records.longestDuration?.flight.to).toBe('JFK');
  });

  it('returns empty records for no flights', () => {
    expect(computeStats([]).records).toEqual({});
  });
});

describe('computeStats', () => {
  const fs = [
    fl({ from: 'KLAX', to: 'KSFO', cabinClass: 'economy', seatType: 'window', reason: 'business', depTime: '07:00' }),
    fl({ from: 'KSFO', to: 'KLAX', cabinClass: 'economy', seatType: 'window', reason: 'business', depTime: '08:00', registration: 'n123ua' }),
    fl({ from: 'KLAX', to: 'EGLL', cabinClass: 'business', seatType: 'aisle', reason: 'leisure', depTime: '09:00', registration: 'N123UA' }),
    fl({ from: 'EGLL', to: 'LFPG', seatType: 'window', aircraftType: 'A320', depTime: '10:00' }),
    fl({ from: 'LFPG', to: 'RJTT', aircraftName: 'Boeing 777-300ER', depTime: '11:00' }),
    fl({ from: 'ZZZZ', to: 'KLAX' }),
  ];
  const s = computeStats(fs, { homeCountry: 'US' });

  it('counts categories with unknowns', () => {
    expect(s.cabin.known).toBe(3);
    expect(s.cabin.unknown).toBe(3);
    expect(s.cabin.items.find((i) => i.key === 'economy')).toMatchObject({ count: 2, share: 2 / 3 });
    expect(s.seat.items.map((i) => i.count)).toEqual([3, 0, 1]);
    expect(s.reason.items.find((i) => i.key === 'business')?.count).toBe(2);
    expect(s.scope.items.map((i) => i.count)).toEqual([2, 3]);
    expect(s.scope.unknown).toBe(1);
  });

  it('computes countries & continents', () => {
    expect(s.countries.map((c) => c.code)).toEqual(['US', 'FR', 'GB', 'JP']);
    expect(s.countries[0]).toMatchObject({ flag: '🇺🇸', name: 'United States', flights: 4, airports: 2 });
    expect(s.countriesAbroad).toBe(3);
    const eu = s.continents.find((c) => c.continent === 'EU')!;
    expect(eu).toMatchObject({ airports: 2, flights: 3, countries: 2 });
    const as = s.continents.find((c) => c.continent === 'AS')!;
    expect(as).toMatchObject({ airports: 1, flights: 1 });
    expect(s.unique.continents).toBe(3);
  });

  it('computes uniques and rankings', () => {
    expect(s.unique.airports).toBe(6); // incl. unknown ZZZZ
    expect(s.unique.countries).toBe(4);
    expect(s.unique.registrations).toBe(1);
    expect(s.registrations[0]).toMatchObject({ key: 'N123UA', count: 2 });
    expect(s.unique.aircraft).toBe(2);
    expect(s.aircraft.map((a) => a.name)).toContain('Boeing 777-300ER');
    expect(s.quality.unknownAirports).toBe(1);
    expect(s.quality.noDepTime).toBe(1);
  });

  it('derives insights', () => {
    expect(s.insights.find((i) => i.id === 'seat')?.title).toBe('Window seat person');
    expect(s.insights.find((i) => i.id === 'hour')?.title).toBe('Early bird');
    expect(s.insights.find((i) => i.id === 'haul')).toBeDefined();
  });

  it('handles empty input', () => {
    const e = computeStats([]);
    expect(e.totals.flights).toBe(0);
    expect(e.countries).toEqual([]);
    expect(e.byYear).toEqual([]);
    expect(e.insights).toEqual([]);
  });
});

describe('emissions split', () => {
  it('splits CO2 by haul and cabin', () => {
    const s = computeStats([fl({ from: 'LAX', to: 'SFO', cabinClass: 'business' }), fl({ from: 'LAX', to: 'LHR' })]);
    expect(s.emissions.byCabin.business).toBeCloseTo(co2PerPassengerKg(km('LAX', 'SFO'), 'business'), 3);
    expect(s.emissions.byCabin.unknown).toBeCloseTo(co2PerPassengerKg(km('LAX', 'LHR')), 3);
    expect(s.emissions.byHaul.short).toBeGreaterThan(0);
    expect(s.emissions.byHaul.long).toBeGreaterThan(0);
    expect(s.emissions.byHaul.medium).toBe(0);
    expect(s.emissions.byHaul.short + s.emissions.byHaul.long).toBeCloseTo(s.totals.co2Kg, 3);
  });
});

describe('manufacturers', () => {
  it('classifies airframes by name or type code', () => {
    expect(aircraftManufacturer({ aircraftType: 'B38M' })).toBe('boeing');
    expect(aircraftManufacturer({ aircraftType: 'BCS3' })).toBe('airbus');
    expect(aircraftManufacturer({ aircraftName: 'Airbus A350-900' })).toBe('airbus');
    expect(aircraftManufacturer({ aircraftType: 'E75L' })).toBe('embraer');
    expect(aircraftManufacturer({ aircraftType: 'CRJ9' })).toBe('bombardier');
    expect(aircraftManufacturer({ aircraftType: 'DH8D' })).toBe('bombardier');
    expect(aircraftManufacturer({ aircraftType: 'AT76' })).toBe('other');
    expect(aircraftManufacturer({})).toBeUndefined();
    const s = computeStats([fl({ from: 'LAX', to: 'SFO', aircraftType: 'A320' }), fl({ from: 'LAX', to: 'SFO' })]);
    expect(s.manufacturer.items.find((i) => i.key === 'airbus')?.count).toBe(1);
    expect(s.manufacturer.unknown).toBe(1);
  });
});
