import { beforeAll, describe, expect, it } from 'vitest';
import { setReference } from '@/data/reference';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from './types';
import {
  awaySpans,
  cityName,
  detectTrips,
  groupTripsByYear,
  homeAirport,
  resolveTrip,
  stopNights,
  suggestTripName,
  tripCounts,
  tripDates,
  tripFromLegs,
  tripMinutes,
  tripOf,
  tripRoute,
  tripTitle,
} from './trips';

beforeAll(installReference);

let n = 0;
const leg = (date: string, from: string, to: string, depTime = '09:00', arrTime?: string, extra: Partial<Flight> = {}): Flight => ({
  id: `f${++n}`, date, datePrecision: 'day', from, to, depTime, arrTime, source: 'manual', createdAt: n, updatedAt: n, ...extra,
});

describe('detectTrips', () => {
  it('groups an out-and-back with a connection, ending when back home', () => {
    const flights = [
      leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30'),
      leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50'), // connection in DEN
      leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40'),
      leg('2026-04-10', 'KSAN', 'KSFO', '08:00', '09:30'),
      leg('2026-04-12', 'KSFO', 'KSAN', '18:00', '19:30'),
      leg('2026-05-01', 'KSAN', 'KSEA'), // one-way, no return: not a trip
    ];
    const trips = detectTrips(flights);
    expect(trips).toHaveLength(2);
    const [sf, boston] = trips;
    expect(boston.flights.map((f) => f.to)).toEqual(['KDEN', 'KBOS', 'KSAN']);
    expect(boston.stops.map((s) => [s.airport, s.kind])).toEqual([['KDEN', 'connection'], ['KBOS', 'stay']]);
    expect(boston.main).toBe('KBOS');
    expect(boston.roundTrip).toBe(true);
    expect(boston.nights).toBe(5);
    expect(tripTitle(boston)).toBe('Boston');
    expect(tripTitle(sf)).toBe('Weekend in San Francisco'); // Fri → Sun
    expect(homeAirport(flights)).toBe('KSAN');
  });

  it('keeps long trips together and treats same-city airports as connected', () => {
    const trips = detectTrips([
      leg('2026-06-01', 'KSAN', 'KJFK', '07:00', '15:30'),
      leg('2026-06-04', 'KLGA', 'KORD'), // JFK → LGA same city
      leg('2026-06-05', 'KORD', 'KSAN'),
      leg('2026-08-01', 'KSAN', 'KLAS'),
      leg('2026-09-30', 'KLAS', 'KSAN'), // two months in Las Vegas is still one trip
    ]);
    expect(trips.map((t) => t.flights.length).sort()).toEqual([2, 3]);
    const vegas = trips.find((t) => t.main === 'KLAS')!;
    expect(vegas.nights).toBe(60);
    expect(tripTitle(vegas)).toBe('Two months in Las Vegas');
  });

  it('keeps saved trips intact and excludes their legs from suggestions', () => {
    const a = leg('2026-07-01', 'KSAN', 'PHNL', '08:00', '11:00', { tripId: 't1', tripName: 'Honeymoon' });
    const b = leg('2026-07-08', 'PHNL', 'KSAN', '13:00', '21:00', { tripId: 't1' });
    const trips = detectTrips([a, b, leg('2026-07-20', 'KSAN', 'KPDX'), leg('2026-07-22', 'KPDX', 'KSAN')]);
    const saved = trips.find((t) => t.saved)!;
    expect(saved).toMatchObject({ id: 't1', name: 'Honeymoon' });
    expect(tripTitle(saved)).toBe('Honeymoon');
    expect(tripOf(trips, b.id)?.id).toBe('t1');
    expect(trips.filter((t) => !t.saved)).toHaveLength(1);
  });

  it('ignores imprecise dates and formats ranges', () => {
    const trips = detectTrips([leg('2025-12-28', 'KSAN', 'KJFK'), leg('2026-01-04', 'KJFK', 'KSAN'), { ...leg('2026-02-01', 'KSAN', 'KSEA'), datePrecision: 'month' }]);
    expect(trips).toHaveLength(1);
    expect(tripDates(trips[0])).toBe('Dec 28, 2025 – Jan 4, 2026');
    expect(awaySpans(trips)).toEqual([{ start: '2025-12-28', end: '2026-01-04', tripId: trips[0].id }]);
  });
});

describe('trip helpers', () => {
  const boston = () => [
    leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30', { airlineIcao: 'UAL', durationMin: 150 }),
    leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50', { airlineIcao: 'UAL', durationMin: 245 }),
    leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40', { airlineIcao: 'JBU' }),
  ];

  it('describes the route, time aloft, counts and nights per stop', () => {
    const [t] = detectTrips(boston());
    expect(tripRoute(t).map((s) => [s.airport, s.role])).toEqual([
      ['KSAN', 'origin'],
      ['KDEN', 'connection'],
      ['KBOS', 'stay'],
      ['KSAN', 'finish'],
    ]);
    // Recorded durations, plus a distance-based estimate for the leg without one.
    expect(tripMinutes(t)).toBeGreaterThan(150 + 245 + 300);
    expect(tripMinutes(t)).toBeLessThan(150 + 245 + 420);
    expect(tripCounts(t)).toEqual({ airlines: 2, airports: 3 });
    expect(stopNights(t.flights[1], t.flights[2])).toBe(5);
    expect(stopNights(t.flights[0], t.flights[1])).toBe(0);
  });

  it('detects the same trips whatever order the log comes in (newest first from the db)', () => {
    const legs = boston();
    expect(homeAirport([...legs].reverse())).toBe('KSAN');
    expect(detectTrips([...legs].reverse()).map((t) => t.flights.length)).toEqual([3]);
  });

  it('groups trips by the year they start in, newest first, with nights per year', () => {
    const trips = detectTrips([
      ...boston(),
      leg('2025-12-28', 'KSAN', 'KJFK'),
      leg('2026-01-04', 'KJFK', 'KSAN'),
      leg('2024-05-01', 'KSAN', 'KSEA'),
      leg('2024-05-03', 'KSEA', 'KSAN'),
    ]);
    const years = groupTripsByYear(trips);
    expect(years.map((y) => [y.year, y.trips.length, y.nights])).toEqual([
      ['2026', 1, 5],
      ['2025', 1, 7],
      ['2024', 1, 2],
    ]);
    expect(groupTripsByYear([])).toEqual([]);
  });

  it('resolves stale suggestion ids to the trip that now holds the flight', () => {
    const legs = boston();
    const [suggested] = detectTrips(legs);
    expect(suggested.id).toBe(`auto-${legs[0].id}`);
    expect(resolveTrip(detectTrips(legs), suggested.id)).toMatchObject({ exact: true, trip: { id: suggested.id } });

    // A leg logged before it changes the suggestion's id; the old link still finds the trip.
    const earlier = leg('2026-02-28', 'KLAX', 'KSAN', '20:00', '21:00');
    const shifted = detectTrips([earlier, ...legs]);
    const r = resolveTrip(shifted, suggested.id);
    expect(r?.exact).toBe(false);
    expect(r?.trip.flights.map((f) => f.id)).toContain(legs[0].id);

    // Saved since: the suggestion id now leads to the saved trip.
    const saved = detectTrips(legs.map((f) => ({ ...f, tripId: 'trip-1', tripName: 'Boston' })));
    expect(resolveTrip(saved, suggested.id)).toMatchObject({ exact: false, trip: { id: 'trip-1', saved: true } });

    // Ungrouped: the saved id is gone, but the legs last shown point at the new suggestion.
    expect(resolveTrip(detectTrips(legs), 'trip-1')).toBeUndefined();
    expect(resolveTrip(detectTrips(legs), 'trip-1', [legs[1].id])).toMatchObject({ exact: false, trip: { id: suggested.id } });

    // Nothing left to find.
    expect(resolveTrip(detectTrips(legs), 'auto-missing')).toBeUndefined();
    expect(resolveTrip(detectTrips(legs.slice(0, 1)), suggested.id)).toBeUndefined();
  });

  it('keeps a saved trip with one remaining leg, and never trips month-precision flights', () => {
    const solo = leg('2026-04-02', 'KSAN', 'KDEN', '09:00', '12:00', { tripId: 'ski', tripName: 'Ski weekend' });
    const vague = leg('2026-04-01', 'KDEN', 'KSAN', '09:00', undefined, { datePrecision: 'month', tripId: 'ski' });
    const trips = detectTrips([solo, vague]);
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ id: 'ski', saved: true, nights: 0, stops: [] });
    expect(trips[0].flights.map((f) => f.id)).toEqual([solo.id]);
  });

  it('treats airports of one city as connected and titles trips with clean city names', () => {
    const trips = detectTrips([
      leg('2026-06-01', 'KSAN', 'LFPG', '07:00', '08:00', { arrDayOffset: 1 }),
      leg('2026-06-05', 'LFPO', 'KSAN', '10:00', '13:00'), // CDG in, Orly out
    ]);
    expect(trips).toHaveLength(1);
    expect(tripTitle(trips[0])).toBe('Paris');
    expect(cityName('LFPG')).toBe('Paris');
    expect(cityName('EGSS')).toBe('London');
    expect(cityName('ZZZZ')).toBe('ZZZZ');
  });
});

describe('home region', () => {
  it('treats a regularly used nearby airport as home, so trips from it end there', () => {
    const flights = [
      // SAN is the main home; LAX (180 km) is used regularly too.
      leg('2026-01-05', 'KSAN', 'KSEA', '07:00', '09:30'), leg('2026-01-08', 'KSEA', 'KSAN', '18:00', '20:30'),
      leg('2026-02-02', 'KLAX', 'KDEN', '07:00', '10:30'), leg('2026-02-05', 'KDEN', 'KLAX', '18:00', '19:30'),
      leg('2026-02-12', 'KLAX', 'KBOS', '07:00', '15:30'), leg('2026-02-16', 'KBOS', 'KLAX', '08:00', '11:30'),
      leg('2026-03-01', 'KSAN', 'KJFK', '07:00', '15:30'), leg('2026-03-04', 'KJFK', 'KLAX', '08:00', '11:30'),
      leg('2026-04-01', 'KSAN', 'KPDX'), leg('2026-04-03', 'KPDX', 'KSAN'),
      leg('2026-05-01', 'KLAX', 'KSFO'), leg('2026-05-03', 'KSFO', 'KLAX'),
    ];
    const trips = detectTrips(flights);
    const byMain = Object.fromEntries(trips.map((t) => [t.main, t]));
    expect(byMain.KDEN.flights).toHaveLength(2); // not chained with the Boston trip a week later
    expect(byMain.KBOS.flights).toHaveLength(2);
    expect(byMain.KJFK.roundTrip).toBe(true); // SAN → JFK → LAX is back home
  });
});

describe('time away (location over time)', () => {
  const homeBase = () => [
    // Enough SAN departures to make SAN home.
    leg('2025-01-05', 'KSAN', 'KSEA'), leg('2025-01-07', 'KSEA', 'KSAN'),
    leg('2025-02-05', 'KSAN', 'KPHX'), leg('2025-02-07', 'KPHX', 'KSAN'),
    leg('2025-03-05', 'KSAN', 'KDEN'), leg('2025-03-07', 'KDEN', 'KSAN'),
  ];

  it('keeps an open-jaw trip with ground legs together until you fly home', () => {
    const trips = detectTrips([
      ...homeBase(),
      leg('2025-06-01', 'KSAN', 'KJFK', '07:00', '15:30'),
      leg('2025-06-06', 'KBOS', 'KORD', '09:00', '11:00'), // train New York → Boston
      leg('2025-06-09', 'KORD', 'KSAN', '09:00', '11:30'),
    ]);
    const t = trips.find((x) => x.flights.some((f) => f.to === 'KJFK'))!;
    expect(t.flights.map((f) => f.to)).toEqual(['KJFK', 'KORD', 'KSAN']);
    expect(t).toMatchObject({ nights: 8, roundTrip: true, returnLogged: true, startLogged: true });
  });

  it('keeps a months-long multi-city trip as one', () => {
    const trips = detectTrips([
      ...homeBase(),
      leg('2025-07-05', 'KSAN', 'EGLL'), leg('2025-08-01', 'EGLL', 'LFPG'), leg('2025-09-20', 'LFPG', 'LIRF'), leg('2025-10-02', 'LIRF', 'KSAN'),
    ]);
    const t = trips.find((x) => x.flights.length === 4)!;
    expect(t.start).toBe('2025-07-05');
    expect(t.roundTrip).toBe(true);
    expect(t.nights).toBeGreaterThan(80);
    // "Three months in London, Paris & Rome" would be too long: the places win.
    expect(tripTitle(t)).toBe('London, Paris & Rome');
  });

  it('ends a trip when your next flight leaves from home (return not logged)', () => {
    const trips = detectTrips([
      ...homeBase(),
      leg('2025-04-01', 'KSAN', 'KDEN', '07:00', '10:00'), leg('2025-04-03', 'KDEN', 'KBOS', '09:00', '15:00'),
      // drove/flew home without logging it
      leg('2025-05-01', 'KSAN', 'KSFO'), leg('2025-05-03', 'KSFO', 'KSAN'),
    ]);
    const boston = trips.find((x) => x.flights.some((f) => f.to === 'KBOS'))!;
    expect(boston.flights).toHaveLength(2);
    expect(boston).toMatchObject({ returnLogged: false, roundTrip: false, end: '2025-04-03' });
    expect(trips.find((x) => x.main === 'KSFO')?.flights).toHaveLength(2);
  });

  it('does not mistake a long stint abroad with weekend trips for a move', () => {
    const before: Flight[] = [];
    for (let m = 1; m <= 6; m++) before.push(leg(`2025-0${m}-02`, 'KSAN', 'KSEA'), leg(`2025-0${m}-04`, 'KSEA', 'KSAN'));
    const london = [
      leg('2025-07-01', 'KSAN', 'EGLL'),
      leg('2025-07-12', 'EGLL', 'LFPG'), leg('2025-07-14', 'LFPG', 'EGLL'),
      leg('2025-08-09', 'EGLL', 'EHAM'), leg('2025-08-11', 'EHAM', 'EGLL'),
      leg('2025-09-06', 'EGLL', 'EIDW'), leg('2025-09-08', 'EIDW', 'EGLL'),
      leg('2025-09-30', 'EGLL', 'KSAN'),
    ];
    const after: Flight[] = [];
    for (let m = 10; m <= 12; m++) after.push(leg(`2025-${m}-02`, 'KSAN', 'KDEN'), leg(`2025-${m}-04`, 'KDEN', 'KSAN'));
    const trips = detectTrips([...before, ...london, ...after]);
    const stint = trips.find((t) => t.start === '2025-07-01')!;
    expect(stint.flights).toHaveLength(8);
    expect(stint).toMatchObject({ roundTrip: true, main: 'EGLL' });
  });

  it('follows a move: trips end at the new home once you live there', () => {
    const nyc: Flight[] = [];
    for (let m = 1; m <= 10; m++) {
      const mm = String(m).padStart(2, '0');
      nyc.push(leg(`2016-${mm}-05`, 'KJFK', m % 2 ? 'KORD' : 'KMIA'), leg(`2016-${mm}-08`, m % 2 ? 'KORD' : 'KMIA', 'KJFK'));
    }
    const move = leg('2017-01-15', 'KJFK', 'KSAN');
    const sd: Flight[] = [];
    for (let m = 3; m <= 12; m++) {
      const mm = String(m).padStart(2, '0');
      sd.push(leg(`2017-${mm}-05`, 'KSAN', m % 2 ? 'KSEA' : 'KDEN'), leg(`2017-${mm}-08`, m % 2 ? 'KSEA' : 'KDEN', 'KSAN'));
    }
    const trips = detectTrips([...nyc, move, ...sd]);
    // No trip swallows months of San Diego life after the move.
    expect(Math.max(...trips.map((t) => t.nights))).toBeLessThan(40);
    const late = trips.filter((t) => t.start >= '2017-03-01');
    expect(late).toHaveLength(10);
    expect(late.every((t) => t.roundTrip && t.flights.length === 2)).toBe(true);
    expect(trips.filter((t) => t.start < '2017-01-01').every((t) => t.roundTrip)).toBe(true);
  });
});

describe('automatic trip names', () => {
  // A few San Diego round trips first, so San Diego is clearly home.
  const base = () => [
    leg('2025-01-05', 'KSAN', 'KSEA'), leg('2025-01-07', 'KSEA', 'KSAN'),
    leg('2025-02-05', 'KSAN', 'KPHX'), leg('2025-02-07', 'KPHX', 'KSAN'),
    leg('2025-03-05', 'KSAN', 'KDEN'), leg('2025-03-07', 'KDEN', 'KSAN'),
  ];
  /** Title of the trip holding `probe` (default: the first leg given). */
  const title = (flights: Flight[], probe = flights[0]) => {
    const t = tripOf(detectTrips(flights), probe.id);
    if (!t) throw new Error(`no trip holds ${probe.from} → ${probe.to}`);
    return tripTitle(t);
  };
  /** A trip from San Diego: out on `out` to the first stop, on to each next stop on its date, home on `back`. */
  const away = (out: string, stops: [string, string][], back: string) => {
    const legs: Flight[] = [];
    let from = 'KSAN';
    for (const [date, to] of stops) {
      legs.push(leg(legs.length ? date : out, from, to, '08:00', '14:00'));
      from = to;
    }
    legs.push(leg(back, from, 'KSAN', '15:00', '21:00'));
    return legs;
  };

  it('names a single destination by how long and when you were there', () => {
    // Fri → Sun.
    expect(title([leg('2026-04-10', 'KSAN', 'KORD', '08:00', '14:00'), leg('2026-04-12', 'KORD', 'KSAN', '17:00', '19:30')])).toBe('Weekend in Chicago');
    // Out and back the same day: the stop is a "connection", but it's where you went.
    expect(title([leg('2026-05-01', 'KSAN', 'KSFO', '07:00', '08:30'), leg('2026-05-01', 'KSFO', 'KSAN', '19:00', '20:30')])).toBe('Day trip to San Francisco');
    // Sun → Fri: nothing to add.
    expect(title([leg('2026-03-01', 'KSAN', 'KBOS', '07:00', '15:30'), leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40')])).toBe('Boston');
    // Sat → Sun a week later.
    expect(title([leg('2026-06-06', 'KSAN', 'LPPT', '17:00', '13:00', { arrDayOffset: 1 }), leg('2026-06-14', 'LPPT', 'KSAN', '11:00', '15:00')])).toBe('Week in Lisbon');
    // Thu → Mon is more than a weekend.
    expect(title([leg('2026-04-09', 'KSAN', 'KORD', '08:00', '14:00'), leg('2026-04-13', 'KORD', 'KSAN', '17:00', '19:30')])).toBe('Chicago');
  });

  it('keeps names short: a prefix that makes it too long is dropped', () => {
    expect(title(away('2026-06-06', [['', 'LEST']], '2026-06-13'))).toBe('Santiago de Compostela');
    expect(title(away('2026-06-06', [['', 'LPPT']], '2026-06-13'))).toBe('Week in Lisbon');
  });

  it('never counts connections as destinations', () => {
    // The Denver connection on the way to Boston.
    expect(title([
      leg('2026-03-01', 'KSAN', 'KDEN', '07:00', '10:30'),
      leg('2026-03-01', 'KDEN', 'KBOS', '11:45', '17:50'),
      leg('2026-03-06', 'KBOS', 'KSAN', '08:00', '11:40'),
    ])).toBe('Boston');
    // Only "connections" (an overnight under 24h): the farthest point is the destination.
    expect(title([leg('2026-07-10', 'KSAN', 'KSEA', '18:00', '20:30'), leg('2026-07-11', 'KSEA', 'KSAN', '16:00', '18:30')])).toBe('Weekend in Seattle');
  });

  it('lists two destinations, and names a country for three or more in one country abroad', () => {
    expect(title(away('2026-06-06', [['', 'LPPT'], ['2026-06-10', 'LPPR']], '2026-06-15'))).toBe('Lisbon & Porto');
    expect(title(away('2026-06-06', [['', 'LPPT'], ['2026-06-10', 'LPPR']], '2026-06-13'))).toBe('Week in Lisbon & Porto');
    // Narita in, Haneda out: both are Tokyo.
    const japan = (back: string) => [
      leg('2026-10-01', 'KSAN', 'RJAA', '11:00', '15:00', { arrDayOffset: 1 }),
      leg('2026-10-05', 'RJTT', 'RJCC', '09:00', '10:30'),
      leg('2026-10-08', 'RJCC', 'RJBB', '09:00', '11:00'),
      leg(back, 'RJBB', 'KSAN', '17:00', '10:00'),
    ];
    expect(title(japan('2026-10-11'))).toBe('Japan');
    expect(title(japan('2026-10-15'))).toBe('Two weeks in Japan');
    expect(title(away('2026-06-01', [['', 'EGLL'], ['2026-06-03', 'EGPH'], ['2026-06-05', 'EGCC']], '2026-06-08'))).toBe('Week in the UK');
    expect(title(away('2026-06-01', [['', 'EGLL'], ['2026-06-03', 'EGPH'], ['2026-06-05', 'EGCC']], '2026-06-11'))).toBe('UK');
  });

  it('lists cities while they fit, then countries, a continent or "& 2 more"', () => {
    expect(title(away('2026-05-01', [['', 'KDEN'], ['2026-05-04', 'KAUS'], ['2026-05-07', 'KBNA']], '2026-05-11'))).toBe('Denver, Austin & Nashville');
    expect(title(away('2026-05-01', [['', 'KDEN'], ['2026-05-04', 'KAUS'], ['2026-05-07', 'KBNA'], ['2026-05-09', 'KATL']], '2026-05-12'))).toBe('Denver, Austin & 2 more');
    expect(title(away('2026-07-01', [['', 'LFPG'], ['2026-07-05', 'LIRF'], ['2026-07-08', 'LEBL']], '2026-07-11'))).toBe('Paris, Rome & Barcelona');
    // A long trip across Europe: too many cities to list, so the countries are counted.
    const europe = (back: string) => away('2026-07-01', [['', 'EGLL'], ['2026-07-06', 'LFPG'], ['2026-07-10', 'LIRF'], ['2026-07-15', 'LEBL']], back);
    expect(title(europe('2026-07-20'))).toBe('4 countries in Europe');
    expect(title(europe('2026-07-22'))).toBe('Three weeks in Europe');
    // Across continents.
    expect(title(away('2026-02-01', [['', 'RJTT'], ['2026-02-06', 'VTBS'], ['2026-02-12', 'YSSY'], ['2026-02-19', 'NZAA']], '2026-02-25'))).toBe('Japan, Thailand & 2 more');
  });

  it('names one-way trips and trips the log picks up already away', () => {
    // Out via Denver, home some other way: the next flight leaves from San Diego.
    const later = [leg('2025-05-01', 'KSAN', 'KSFO'), leg('2025-05-03', 'KSFO', 'KSAN')];
    const oneWay = [leg('2025-04-01', 'KSAN', 'KDEN', '07:00', '10:00'), leg('2025-04-01', 'KDEN', 'KBOS', '11:30', '17:00')];
    expect(title([...base(), ...oneWay, ...later], oneWay[0])).toBe('To Boston');
    const twoStops = [leg('2025-04-01', 'KSAN', 'KDEN', '07:00', '10:00'), leg('2025-04-03', 'KDEN', 'KBOS', '11:30', '17:00')];
    expect(title([...base(), ...twoStops, ...later], twoStops[0])).toBe('Denver & Boston');

    // The first flights in the log start in London; nothing claims they started at home.
    const homeward = [leg('2024-12-01', 'EGLL', 'KJFK', '09:00', '12:00'), leg('2024-12-01', 'KJFK', 'KSAN', '14:00', '17:30')];
    const t = tripOf(detectTrips([...homeward, ...base()]), homeward[0].id)!;
    expect(t).toMatchObject({ startLogged: false, roundTrip: true });
    expect(tripTitle(t)).toBe('Home from London');
    const between = [leg('2024-12-01', 'EGLL', 'LFPG', '09:00', '11:15'), leg('2024-12-01', 'LFPG', 'LIRF', '13:00', '15:00')];
    expect(title([...between, ...base()])).toBe('London to Rome');
  });

  it('ignores home-area airports', () => {
    // San Diego is home, and Los Angeles (regularly used, 180 km away) is part of it.
    const region = [
      leg('2026-01-05', 'KSAN', 'KSEA', '07:00', '09:30'), leg('2026-01-08', 'KSEA', 'KSAN', '18:00', '20:30'),
      leg('2026-02-02', 'KLAX', 'KDEN', '07:00', '10:30'), leg('2026-02-05', 'KDEN', 'KLAX', '18:00', '19:30'),
      leg('2026-02-12', 'KLAX', 'KBOS', '07:00', '15:30'), leg('2026-02-16', 'KBOS', 'KLAX', '08:00', '11:30'),
      leg('2026-04-01', 'KSAN', 'KPDX'), leg('2026-04-03', 'KPDX', 'KSAN'),
    ];
    // Out of San Diego, back into Los Angeles.
    const nyc = [leg('2026-03-01', 'KSAN', 'KJFK', '07:00', '15:30'), leg('2026-03-04', 'KJFK', 'KLAX', '08:00', '11:30')];
    expect(title([...region, ...nyc], nyc[0])).toBe('New York');
    // A saved trip without a name that stays a few days in Los Angeles first.
    const saved = [
      leg('2026-05-01', 'KSAN', 'KLAX', '08:00', '09:00', { tripId: 's1' }),
      leg('2026-05-04', 'KLAX', 'KSEA', '08:00', '10:45', { tripId: 's1' }),
      leg('2026-05-07', 'KSEA', 'KSAN', '08:00', '10:45', { tripId: 's1' }),
    ];
    const t = detectTrips([...region, ...nyc, ...saved]).find((x) => x.id === 's1')!;
    expect(t.stops.map((s) => [s.airport, s.home ?? false])).toEqual([['KLAX', true], ['KSEA', false]]);
    expect(tripTitle(t)).toBe('Week in Seattle');
  });

  it('names upcoming trips the same way, including the holidays', () => {
    // Nothing about a trip being in the future changes its name.
    expect(title([leg('2027-01-15', 'KSAN', 'KORD', '08:00', '14:00'), leg('2027-01-17', 'KORD', 'KSAN', '17:00', '19:30')])).toBe('Weekend in Chicago');
    const nyc = (out: string, back: string) => [leg(out, 'KSAN', 'KJFK', '07:00', '15:30'), leg(back, 'KJFK', 'KSAN', '18:00', '21:30')];
    expect(title(nyc('2026-12-22', '2026-12-27'))).toBe('Christmas in New York');
    expect(title(nyc('2026-12-29', '2027-01-02'))).toBe('New Year in New York');
    expect(title(nyc('2026-12-20', '2027-01-03'))).toBe('Holidays in New York');
    // A season abroad over Christmas isn't a Christmas trip.
    expect(title(nyc('2026-11-01', '2027-01-20'))).toBe('New York');
  });

  it('prefers a saved name, and falls back to the automatic one when it is blank', () => {
    const legs = [leg('2026-04-10', 'KSAN', 'KORD', '08:00', '14:00', { tripId: 't9', tripName: 'Cubs game' }), leg('2026-04-12', 'KORD', 'KSAN', '17:00', '19:30', { tripId: 't9' })];
    expect(title(legs)).toBe('Cubs game');
    const blank = detectTrips(legs.map((f) => ({ ...f, tripName: ' ' })))[0];
    expect(tripTitle(blank)).toBe('Weekend in Chicago');
    expect(suggestTripName(blank)).toBe('Weekend in Chicago');
  });

  it('degrades gracefully without reference data', () => {
    // Airports the dataset doesn't know: their codes stand in.
    expect(title([leg('2026-04-10', 'KSAN', 'XQQQ', '08:00', '14:00'), leg('2026-04-12', 'XQQQ', 'KSAN', '17:00', '19:30')])).toBe('Weekend in XQQQ');
    const unknown = away('2026-06-01', [['', 'XQQA'], ['2026-06-03', 'XQQB'], ['2026-06-05', 'XQQC'], ['2026-06-07', 'XQQD'], ['2026-06-09', 'XQQE']], '2026-06-12');
    expect(title(unknown)).toBe('XQQA, XQQB, XQQC & 2 more');
    // Reference data not loaded yet (the log can render before it arrives).
    const japan = [
      leg('2026-10-01', 'KSAN', 'RJAA'), leg('2026-10-05', 'RJTT', 'RJCC'), leg('2026-10-08', 'RJCC', 'RJBB'), leg('2026-10-11', 'RJBB', 'KSAN'),
    ];
    setReference(null as never);
    try {
      expect(title(japan)).toBe('RJAA, RJCC & RJBB');
      expect(title([leg('2026-04-10', 'KSAN', 'KORD'), leg('2026-04-12', 'KORD', 'KSAN')])).toBe('Weekend in KORD');
    } finally {
      installReference();
    }
  });
});

describe('tripFromLegs', () => {
  it('names a single one-way leg', () => {
    const f = leg('2026-11-20', 'KMCO', 'KSFO', '08:00', '11:15');
    const t = tripFromLegs([f]);
    expect(t).toMatchObject({ id: `auto-${f.id}`, saved: false, origin: 'KMCO', finish: 'KSFO', stops: [], roundTrip: false, startLogged: true, returnLogged: false, nights: 0 });
    expect(tripTitle(t)).toBe('To San Francisco');
  });

  it('orders the legs, needs no times, and names an out-and-back', () => {
    const untimed = (date: string, from: string, to: string) => {
      const f = leg(date, from, to);
      delete f.depTime;
      return f;
    };
    const out = untimed('2026-04-10', 'KORD', 'KSFO');
    const back = untimed('2026-04-12', 'KSFO', 'KORD');
    const t = tripFromLegs([back, out]);
    expect(t.id).toBe(`auto-${out.id}`);
    expect(t.flights.map((f) => f.id)).toEqual([out.id, back.id]);
    expect(t).toMatchObject({ origin: 'KORD', roundTrip: true, nights: 2, main: 'KSFO' });
    expect(tripTitle(t)).toBe('Weekend in San Francisco');
    // Same day, no times: still a day trip, in the order given.
    expect(tripTitle(tripFromLegs([untimed('2026-04-15', 'KORD', 'KMSP'), untimed('2026-04-15', 'KMSP', 'KORD')]))).toBe('Day trip to Minneapolis');
  });

  it('refuses an empty list', () => {
    expect(() => tripFromLegs([])).toThrow(RangeError);
  });
});

describe('display cities', () => {
  it('uses the city travellers mean, not the airport suburb', () => {
    expect(cityName('RJAA')).toBe('Tokyo');
    expect(cityName('KIAD')).toBe('Washington');
    expect(cityName('EBBR')).toBe('Brussels');
    expect(cityName('LFBO')).toBe('Toulouse'); // "Toulouse/Blagnac"
    expect(cityName('KJFK')).toBe('New York');
  });
});
