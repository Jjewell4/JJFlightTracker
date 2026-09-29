import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { candidateStatus, fixCandidate } from './candidates';
import { detectFormat, detectMapping, mappingIsComplete } from './mapping';
import { analyzeSheet, parseSheet } from './parse';
import { parseDateValue } from './cells';
import { parseCsvText, sheetFromRows } from './sheet';

beforeAll(() => installReference());

const detect = (csv: string) => {
  const sheet = parseCsvText(csv);
  return { sheet, mapping: detectMapping(sheet, (c) => parseDateValue(c)) };
};

describe('detectMapping', () => {
  it('maps common header names', () => {
    const { mapping } = detect('Date,Origin,Destination,Airline,Flight,Aircraft,Tail,Seat,Class,Notes\n2021-05-01,SAN,LAX,UA,UA1,B738,N1,12A,Economy,hi');
    expect(mapping).toEqual({ date: 0, from: 1, to: 2, airline: 3, flightNumber: 4, aircraft: 5, registration: 6, seatNumber: 7, cabinClass: 8, note: 9 });
  });

  it('maps alternative header spellings', () => {
    const { mapping } = detect('Flight Date,Departure Airport,Arrival Airport,Carrier,Flight No.,Aircraft Type,Tail Number,Cabin,Comments,Departure Time,Arrival Time,Flight Time\n');
    expect(mapping).toMatchObject({ date: 0, from: 1, to: 2, airline: 3, flightNumber: 4, aircraft: 5, registration: 6, cabinClass: 7, note: 8, depTime: 9, arrTime: 10, duration: 11 });
  });

  it('recognises the FR24 headers as a generic mapping too', () => {
    const { sheet, mapping } = detect('Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id\n');
    expect(detectFormat(sheet.headers)).toBe('fr24');
    expect(mapping).toMatchObject({ date: 0, flightNumber: 1, from: 2, to: 3, depTime: 4, arrTime: 5, duration: 6, airline: 7, aircraft: 8, registration: 9, seatNumber: 10, seatType: 11, cabinClass: 12, reason: 13, note: 14 });
    expect(mapping).not.toHaveProperty('route');
  });

  it('is not fooled by a generic sheet', () => {
    expect(detectFormat(['Date', 'From', 'To', 'Airline'])).toBe('generic');
  });

  it('detects airports and dates from values when headers are unhelpful', () => {
    const { mapping } = detect('Travel day,Leg A,Leg B,Misc\n2021-05-01,SAN,LAX,x\n2021-06-01,KSFO,KJFK,y');
    expect(mapping).toMatchObject({ date: 0, from: 1, to: 2 });
    expect(mappingIsComplete(mapping)).toBe(true);
  });

  it('reports an incomplete mapping', () => {
    expect(mappingIsComplete({ date: 0, from: 1 })).toBe(false);
    expect(mappingIsComplete({ date: 0, route: 1 })).toBe(true);
    expect(mappingIsComplete({ from: 1, to: 2 })).toBe(false);
  });

  it('skips title rows above the header', () => {
    const sheet = parseCsvText('My flights,,\n\nDate,From,To\n2021-05-01,SAN,LAX\n');
    expect(sheet.headers).toEqual(['Date', 'From', 'To']);
    expect(sheet.rows).toHaveLength(1);
  });
});

describe('generic parsing', () => {
  it('imports IATA and ICAO codes, words for class/seat/reason', () => {
    const p = parseSheet(
      parseCsvText(
        [
          'Date,From,To,Airline,Flight,Aircraft,Tail,Seat,Seat type,Class,Reason,Notes,Departure Time,Duration',
          '2021-05-01,SAN,LAX,UA,UA1234,Boeing 737-900,n123ua,12A,Window,Premium Economy,Business,"Nice, smooth",8:15 AM,1h 5m',
          '2021-06-02,KSFO,KJFK,Delta Air Lines,DL 400,A321,,,Aisle,First,Leisure,,,',
        ].join('\n'),
      ),
    );
    expect(p.format).toBe('generic');
    expect(p.candidates).toHaveLength(2);
    const [a, b] = p.candidates;
    expect(a.flight).toMatchObject({
      source: 'csv',
      date: '2021-05-01',
      from: 'KSAN',
      to: 'KLAX',
      flightNumber: 'UA1234',
      airlineIcao: 'UAL',
      aircraftName: 'Boeing 737-900',
      aircraftType: 'B739', // resolved from the name
      registration: 'N123UA',
      seatNumber: '12A',
      seatType: 'window',
      cabinClass: 'premium',
      reason: 'business',
      note: 'Nice, smooth',
      depTime: '08:15',
      durationMin: 65,
    });
    expect(b.flight).toMatchObject({ from: 'KSFO', to: 'KJFK', airlineIcao: 'DAL', flightNumber: 'DL400', cabinClass: 'first', reason: 'leisure', seatType: 'aisle', aircraftType: 'A321' });
    expect(candidateStatus(a)).toBe('ok');
  });

  it('honours an explicit mapping over auto-detection', () => {
    const sheet = parseCsvText('A,B,C\n2021-05-01,SAN,LAX');
    const p = parseSheet(sheet, { mapping: { date: 0, from: 2, to: 1 } });
    expect(p.candidates[0].flight).toMatchObject({ from: 'KLAX', to: 'KSAN' });
  });

  it('splits a single route column', () => {
    const sheet = parseCsvText('Date,Route\n2021-05-01,SAN-LAX\n2021-05-02,SFO → JFK\n2021-05-03,LAX to SEA\n2021-05-04,KSAN/KDEN');
    const a = analyzeSheet(sheet);
    expect(a.mapping).toEqual({ date: 0, route: 1 });
    const p = parseSheet(sheet);
    expect(p.candidates.map((c) => [c.flight.from, c.flight.to])).toEqual([
      ['KSAN', 'KLAX'],
      ['KSFO', 'KJFK'],
      ['KLAX', 'KSEA'],
      ['KSAN', 'KDEN'],
    ]);
  });

  it('detects day-first dates from the data', () => {
    const sheet = parseCsvText('Date,From,To\n14/03/2019,SAN,LAX\n05/06/2019,SAN,LAX');
    const p = parseSheet(sheet);
    expect(p.dateOrder).toBe('dmy');
    expect(p.candidates.map((c) => c.flight.date)).toEqual(['2019-03-14', '2019-06-05']);
    // an explicit override wins
    expect(parseSheet(sheet, { dateOrder: 'mdy' }).candidates[1].flight.date).toBe('2019-05-06');
  });

  it('picks the time out of a combined datetime column', () => {
    const p = parseSheet(parseCsvText('Date,From,To\n2019-03-14 07:35,SAN,SFO'));
    expect(p.candidates[0].flight).toMatchObject({ date: '2019-03-14', depTime: '07:35' });
  });

  it('guesses airports from city names only when unambiguous', () => {
    const p = parseSheet(parseCsvText('Date,From,To\n2019-03-14,San Diego,Atlantis'), { mapping: { date: 0, from: 1, to: 2 } });
    const c = p.candidates[0];
    expect(c.flight.from).toBe('KSAN');
    expect(c.issues.find((i) => i.field === 'from')?.level).toBe('warn'); // asks the user to check the guess
    expect(c.issues.find((i) => i.field === 'to')?.message).toContain('Unknown');
  });

  it('reads real Excel cell values (Dates, serials, fractions)', () => {
    const sheet = sheetFromRows([
      ['Date', 'From', 'To', 'Dep time', 'Arr time', 'Duration'],
      [new Date(Date.UTC(2019, 2, 14)), 'SAN', 'SFO', 0.31597222, 0.37847222, 0.0625],
      [43600, 'SFO', 'LAX', new Date(Date.UTC(1899, 11, 30, 18, 0)), new Date(Date.UTC(1899, 11, 30, 19, 20)), null],
      [2018, 'SAN', 'LAX', null, null, null],
    ]);
    const p = parseSheet(sheet);
    expect(p.candidates[0].flight).toMatchObject({ date: '2019-03-14', depTime: '07:35', arrTime: '09:05', durationMin: 90 });
    expect(p.candidates[1].flight).toMatchObject({ date: '2019-05-15', depTime: '18:00', arrTime: '19:20', durationMin: 80 });
    expect(p.candidates[2].flight).toMatchObject({ date: '2018-01-01', datePrecision: 'year' });
  });

  it('reads HHMM numbers, decimal-hour durations and flags durations over 24h', () => {
    const sheet = sheetFromRows([
      ['Date', 'From', 'To', 'Dep time', 'Arr time', 'Duration'],
      ['2019-03-14', 'SAN', 'SFO', 735, 905, 1.5],
      ['2019-03-15', 'SAN', 'SFO', null, null, '26:10'],
    ]);
    const [a, b] = parseSheet(sheet).candidates;
    expect(a.flight).toMatchObject({ depTime: '07:35', arrTime: '09:05', durationMin: 90 });
    expect(candidateStatus(a)).toBe('ok');
    expect(b.flight.durationMin).toBeUndefined();
    expect(b.issues).toContainEqual(expect.objectContaining({ level: 'warn', field: 'duration', message: expect.stringContaining('longer than 24 hours') }));
  });

  it('warns when origin and destination are the same airport', () => {
    const p = parseSheet(parseCsvText('Date,From,To\n2019-03-14,LAX,KLAX\n2019-03-14,SAN,LAX'));
    expect(p.candidates[0].issues).toContainEqual(expect.objectContaining({ level: 'warn', message: expect.stringContaining('same airport') }));
    expect(candidateStatus(p.candidates[1])).toBe('ok');
  });

  it('keeps a genuine midnight arrival when there is no duration', () => {
    const p = parseSheet(parseCsvText('Date,From,To,Dep time,Arr time\n2019-03-14,LAX,SFO,22:40,00:00'));
    expect(p.candidates[0].flight).toMatchObject({ depTime: '22:40', arrTime: '00:00', arrDayOffset: 1, durationMin: 80 });
    // With a duration column, 00:00 is Flightradar24's "unknown" and the arrival comes from the duration.
    const q = parseSheet(parseCsvText('Date,From,To,Dep time,Arr time,Duration\n2019-03-14,LAX,SFO,10:00,00:00,01:20'));
    expect(q.candidates[0].flight).toMatchObject({ depTime: '10:00', arrTime: '11:20', durationMin: 80 });
  });

  it('reports rows with missing dates or airports', () => {
    const p = parseSheet(parseCsvText('Date,From,To\n,SAN,LAX\n2021-01-01,,LAX\nlater,SAN,LAX'));
    expect(p.candidates.map(candidateStatus)).toEqual(['error', 'error', 'error']);
    expect(p.candidates[0].issues[0].message).toBe('Missing date');
    expect(p.candidates[1].issues[0].message).toBe('Missing origin airport');
    expect(p.candidates[2].issues[0].message).toContain('later');
  });
});

describe('fixCandidate', () => {
  it('fixes an unparseable date and an unknown airport', () => {
    const p = parseSheet(parseCsvText('Date,From,To\nsometime,SAN,ZZZQ'));
    const c = p.candidates[0];
    expect(candidateStatus(c)).toBe('error');
    const fixed = fixCandidate(c, { date: '2020-08', to: 'LAX' });
    expect(fixed.flight).toMatchObject({ date: '2020-08-01', datePrecision: 'month', to: 'KLAX', from: 'KSAN' });
    expect(fixed.flight.distanceKm).toBeGreaterThan(100);
    expect(candidateStatus(fixed)).toBe('ok');
  });

  it('drops clock times (and the duration worked out from them) when the date becomes month/year only', () => {
    const p = parseSheet(parseCsvText('Date,From,To,Dep time,Arr time\nsometime,SAN,SFO,07:35,09:05'));
    expect(p.candidates[0].flight).toMatchObject({ depTime: '07:35', arrTime: '09:05' });
    const fixed = fixCandidate(p.candidates[0], { date: '2019-03' });
    expect(fixed.flight).toMatchObject({ date: '2019-03-01', datePrecision: 'month' });
    expect(fixed.flight.depTime).toBeUndefined();
    expect(fixed.flight.arrTime).toBeUndefined();
    expect(fixed.flight.arrDayOffset).toBeUndefined();
    expect(fixed.flight.durationMin).toBeUndefined();
    // A duration from the file's own column is kept.
    const withDur = parseSheet(parseCsvText('Date,From,To,Dep time,Arr time,Duration\nsometime,SAN,SFO,07:35,09:05,1:30'));
    expect(fixCandidate(withDur.candidates[0], { date: '2019' }).flight).toMatchObject({ datePrecision: 'year', durationMin: 90 });
  });

  it('re-checks for same-airport flights after a fix', () => {
    const p = parseSheet(parseCsvText('Date,From,To\n2019-03-14,SAN,LAX'));
    const same = fixCandidate(p.candidates[0], { to: 'SAN' });
    expect(candidateStatus(same)).toBe('warning');
    expect(candidateStatus(fixCandidate(same, { from: 'SFO' }))).toBe('ok');
  });

  it('keeps other issues and reports new ones', () => {
    const p = parseSheet(parseCsvText('Date,From,To\nsometime,SAN,ZZZQ'));
    const still = fixCandidate(p.candidates[0], { date: 'nope' });
    expect(still.issues.filter((i) => i.field === 'date')).toHaveLength(1);
    expect(still.issues.some((i) => i.field === 'to')).toBe(true);
    const cleared = fixCandidate(p.candidates[0], { from: '' });
    expect(cleared.issues.find((i) => i.field === 'from')?.level).toBe('error');
  });
});
