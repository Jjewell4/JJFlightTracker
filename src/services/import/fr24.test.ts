import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { candidateStatus, type ImportCandidate } from './candidates';
import { detectFormat } from './mapping';
import { parseFr24Csv } from './parse';
import { parseAircraftRef, parseAirlineRef, parseAirportRef } from './refs';
import { parseCsvText } from './sheet';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

beforeAll(() => installReference());

describe('FR24 reference cell parsing', () => {
  it('extracts IATA and ICAO from the trailing parentheses', () => {
    expect(parseAirportRef('San Diego / San Diego International (SAN/KSAN)')).toMatchObject({ iata: 'SAN', icao: 'KSAN', name: 'San Diego / San Diego International' });
    expect(parseAirportRef('X (SAN/)')).toMatchObject({ iata: 'SAN', icao: undefined });
    expect(parseAirportRef('X (/KSAN)')).toMatchObject({ iata: undefined, icao: 'KSAN' });
    expect(parseAirportRef('Somewhere (KSAN/SAN)')).toMatchObject({ iata: 'SAN', icao: 'KSAN' }); // swapped
    expect(parseAirportRef('SAN')).toMatchObject({ iata: 'SAN' });
    expect(parseAirportRef('ksan')).toMatchObject({ icao: 'KSAN' });
    expect(parseAirportRef('SAN - San Diego')).toMatchObject({ iata: 'SAN' });
    expect(parseAirportRef('San Diego (SAN)')).toMatchObject({ iata: 'SAN', name: 'San Diego' });
    expect(parseAirportRef('  ')).toBeUndefined();
  });
  it('parses airlines and aircraft, treating empty parentheses as blank', () => {
    expect(parseAirlineRef('United Airlines (UA/UAL)')).toEqual({ name: 'United Airlines', iata: 'UA', icao: 'UAL' });
    expect(parseAirlineRef(' (/)')).toBeUndefined();
    expect(parseAirlineRef('Foo Air (/FOO)')).toEqual({ name: 'Foo Air', iata: undefined, icao: 'FOO' });
    expect(parseAirlineRef('UA')).toEqual({ iata: 'UA' });
    expect(parseAirlineRef('Delta')).toEqual({ name: 'Delta' });
    expect(parseAircraftRef('Boeing 737-900 (B739)')).toEqual({ name: 'Boeing 737-900', icao: 'B739' });
    expect(parseAircraftRef(' ()')).toBeUndefined();
    expect(parseAircraftRef('B739')).toMatchObject({ icao: 'B739' });
    expect(parseAircraftRef('Cessna 172')).toEqual({ name: 'Cessna 172' });
  });
});

describe('FR24 CSV fixture', () => {
  const text = fixture('fr24-sample.csv');
  let parsed: ReturnType<typeof parseFr24Csv>;
  beforeAll(() => {
    parsed = parseFr24Csv(text);
  });
  const byNote = (needle: string): ImportCandidate => {
    const c = parsed.candidates.find((x) => x.flight.note?.includes(needle));
    if (!c) throw new Error(`no row with note ${needle}`);
    return c;
  };

  it('has a BOM and CRLF (edge cases are really present)', () => {
    expect(fixture('fr24-sample.csv').charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('\r\n');
  });

  it('is detected as a Flightradar24 export and parses every row', () => {
    const sheet = parseCsvText(text);
    expect(sheet.headers[0]).toBe('Date'); // BOM stripped
    expect(detectFormat(sheet.headers)).toBe('fr24');
    expect(parsed.format).toBe('fr24');
    expect(parsed.candidates).toHaveLength(19);
    expect(parsed.candidates.every((c) => c.flight.source === 'fr24')).toBe(true);
  });

  it('maps a fully populated row', () => {
    const f = parsed.candidates[0].flight;
    expect(f).toMatchObject({
      date: '2019-03-14',
      datePrecision: 'day',
      flightNumber: 'UA1234',
      from: 'KSAN',
      to: 'KSFO',
      depTime: '07:35',
      arrTime: '09:05',
      durationMin: 90,
      airlineIcao: 'UAL',
      airlineIata: 'UA',
      airlineName: 'United Airlines',
      aircraftType: 'B739',
      aircraftName: 'Boeing 737-900',
      registration: 'N12345',
      seatNumber: '12A',
      seatType: 'window',
      cabinClass: 'economy',
      reason: 'business',
      note: 'Client meeting, then dinner',
    });
    expect(f.distanceKm).toBeGreaterThan(700);
    expect(f.arrDayOffset).toBe(0);
    expect(candidateStatus(parsed.candidates[0])).toBe('ok');
  });

  it('handles overnight flights across time zones', () => {
    const f = byNote('Overnight to London').flight;
    expect(f).toMatchObject({ from: 'KSFO', to: 'EGLL', depTime: '17:25', arrTime: '11:30', arrDayOffset: 1, durationMin: 605, seatType: 'aisle', cabinClass: 'premium', reason: 'leisure' });
    const jfk = byNote('Christmas Eve').flight;
    expect(jfk).toMatchObject({ arrDayOffset: 1, durationMin: 415, cabinClass: 'first' });
  });

  it('handles flights crossing midnight in one time zone', () => {
    expect(byNote('Crosses midnight').flight).toMatchObject({ depTime: '23:10', arrTime: '00:40', arrDayOffset: 1, durationMin: 90 });
  });

  it('parses partial dates with precision and ignores 00:00:00 times', () => {
    const month = byNote('Month only').flight;
    expect(month).toMatchObject({ date: '2019-03-01', datePrecision: 'month' });
    expect(month.depTime).toBeUndefined();
    expect(month.arrTime).toBeUndefined();
    expect(month.durationMin).toBeUndefined();
    const year = byNote('Year only').flight;
    expect(year).toMatchObject({ date: '2017-01-01', datePrecision: 'year', from: 'KSAN', to: 'KSFO' });
    expect(year.depTime).toBeUndefined();
    expect(year.airlineIcao).toBe('UAL');
  });

  it('derives an unknown (00:00:00) arrival from the duration, in local time', () => {
    const c = byNote('Arrival 00:00:00 means unknown');
    expect(c.flight).toMatchObject({ depTime: '08:10', arrTime: '16:20', arrDayOffset: 0, durationMin: 310, seatType: 'middle', cabinClass: 'business' });
    expect(c.issues.some((i) => i.level === 'info' && i.field === 'arrTime')).toBe(true);
    expect(candidateStatus(c)).toBe('ok');
  });

  it('keeps a duration-only row', () => {
    const f = byNote('Duration only').flight;
    expect(f).toMatchObject({ date: '2026-03-03', durationMin: 95, seatType: 'aisle' });
    expect(f.depTime).toBeUndefined();
  });

  it('treats empty airline ` (/)` and empty aircraft ` ()` as blank', () => {
    const c = parsed.candidates.find((x) => x.flight.date === '2022-01-20' && x.flight.seatType === 'middle')!;
    expect(c.flight.airlineIcao).toBeUndefined();
    expect(c.flight.airlineIata).toBeUndefined();
    expect(c.flight.airlineName).toBeUndefined();
    expect(c.flight.aircraftType).toBeUndefined();
    expect(c.flight.aircraftName).toBeUndefined();
    expect(c.flight.flightNumber).toBeUndefined();
    expect(c.flight).toMatchObject({ cabinClass: 'first', reason: 'crew' });
  });

  it('maps every seat / class / reason code', () => {
    const seen = {
      seat: new Set(parsed.candidates.map((c) => c.flight.seatType)),
      cls: new Set(parsed.candidates.map((c) => c.flight.cabinClass)),
      reason: new Set(parsed.candidates.map((c) => c.flight.reason)),
    };
    const defined = (set: Set<string | undefined>) => [...set].filter(Boolean).sort();
    expect(defined(seen.seat)).toEqual(['aisle', 'middle', 'window']);
    expect(defined(seen.cls)).toEqual(['business', 'economy', 'first', 'premium', 'private']);
    expect(defined(seen.reason)).toEqual(['business', 'crew', 'leisure', 'other']);
    expect(seen.seat.has(undefined) && seen.cls.has(undefined) && seen.reason.has(undefined)).toBe(true);
    // code 0 → unknown
    expect(byNote('Year only').flight.seatType).toBeUndefined();
    expect(byNote('Month only').flight.cabinClass).toBeUndefined();
  });

  it('keeps quotes, commas and newlines inside notes intact', () => {
    expect(byNote('hello').flight.note).toBe('Said "hello", left "ok"');
    expect(byNote('Line one').flight.note).toBe('Line one\nLine two of the note');
    expect(byNote('Client').flight.note).toBe('Client meeting, then dinner');
  });

  it('flags unknown airports as warnings but keeps the code', () => {
    const c = byNote('Unknown airport and airline');
    expect(candidateStatus(c)).toBe('warning');
    expect(c.flight.to).toBe('ZZQQ');
    expect(c.toRaw).toContain('Fake Field');
    expect(c.issues).toEqual([expect.objectContaining({ level: 'warn', field: 'to', message: expect.stringContaining('ZZQQ') })]);
    // unknown airline keeps the codes/name from the file
    expect(c.flight).toMatchObject({ airlineName: 'Zed Air', airlineIata: 'ZZ', airlineIcao: 'ZZA' });
    expect(c.flight.distanceKm).toBeUndefined();
  });

  it('flags impossible dates as errors', () => {
    const c = byNote('Impossible date');
    expect(candidateStatus(c)).toBe('error');
    expect(c.issues[0]).toMatchObject({ level: 'error', field: 'date' });
    expect(c.issues[0].message).toContain('2018-02-30');
  });

  it('resolves airports given by IATA-only or ICAO-only', () => {
    const f = byNote('IATA-only and ICAO-only').flight;
    expect(f).toMatchObject({ from: 'KSAN', to: 'KLAX', depTime: '07:35', arrTime: '08:30', durationMin: 55 });
  });

  it('keeps repeated same-route partial-date rows as separate flights', () => {
    const rows = parsed.candidates.filter((c) => c.flight.date === '2019-01-01' && c.flight.datePrecision === 'year');
    expect(rows).toHaveLength(2);
    expect(rows[0].key).not.toBe(rows[1].key);
  });

  it('has exactly one error and one warning in the fixture', () => {
    const statuses = parsed.candidates.map(candidateStatus);
    expect(statuses.filter((s) => s === 'error')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'warning')).toHaveLength(1);
  });

  it('numbers rows from 1', () => {
    expect(parsed.candidates[0].rowNumber).toBe(1);
    expect(parsed.candidates.at(-1)!.rowNumber).toBe(19);
  });
});

describe('Excel-mangled FR24 CSV', () => {
  let parsed: ReturnType<typeof parseFr24Csv>;
  let clean: ReturnType<typeof parseFr24Csv>;
  beforeAll(() => {
    parsed = parseFr24Csv(fixture('fr24-excel-mangled.csv'));
    clean = parseFr24Csv(fixture('fr24-sample.csv'));
  });

  it('reads M/D/YYYY dates and H:MM times', () => {
    const [a, b] = parsed.candidates;
    expect(a.flight).toMatchObject({ date: '2019-03-14', depTime: '07:35', arrTime: '09:05', durationMin: 90, from: 'KSAN', to: 'KSFO' });
    expect(b.flight).toMatchObject({ date: '2018-07-02', arrDayOffset: 1, durationMin: 605 });
    expect(parsed.dateOrder).toBe('mdy');
  });

  it('reads Mar-19 as month precision and bare years', () => {
    const month = parsed.candidates[2];
    expect(month.flight).toMatchObject({ date: '2019-03-01', datePrecision: 'month' });
    expect(month.flight.depTime).toBeUndefined(); // 0:00 / 0:00 = unknown
    expect(month.issues.some((i) => i.field === 'date' && i.level === 'info')).toBe(true);
    expect(parsed.candidates[3].flight).toMatchObject({ date: '2017-01-01', datePrecision: 'year' });
  });

  it('derives the unknown arrival from 0:00', () => {
    expect(parsed.candidates[4].flight).toMatchObject({ depTime: '08:10', arrTime: '16:20', durationMin: 310 });
  });

  it('produces the same flights as the clean export for the shared rows', () => {
    const strip = (c: ImportCandidate) => {
      const { note, ...rest } = c.flight;
      void note;
      return rest;
    };
    const match = (date: string, from: string, to: string, dep?: string) =>
      clean.candidates.find((c) => c.flight.date === date && c.flight.from === from && c.flight.to === to && c.flight.depTime === dep);
    for (const [i, key] of [[0, ['2019-03-14', 'KSAN', 'KSFO', '07:35']], [1, ['2018-07-02', 'KSFO', 'EGLL', '17:25']], [5, ['2016-12-24', 'KJFK', 'EGLL', '22:30']]] as const) {
      const m = match(...(key as [string, string, string, string]))!;
      expect(strip(parsed.candidates[i])).toEqual(strip(m));
    }
  });
});

describe('other delimiters and quirks', () => {
  const header = 'Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id';
  const row = '2019-03-14,UA1,San Diego / San Diego International (SAN/KSAN),Los Angeles / Los Angeles International (LAX/KLAX),07:35:00,08:30:00,00:55:00,United Airlines (UA/UAL),Boeing 737-900 (B739),,,1,1,1,,,,,';

  it('handles semicolon-delimited files', () => {
    const text = [header, row].map((l) => l.replace(/,(?![^(]*\))/g, ';')).join('\n');
    const p = parseFr24Csv(text);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0].flight).toMatchObject({ from: 'KSAN', to: 'KLAX', airlineIcao: 'UAL' });
  });

  it('handles a "sep=" hint line, LF endings and a trailing blank line', () => {
    const p = parseFr24Csv(`sep=,\n${header}\n${row}\n\n`);
    expect(p.candidates).toHaveLength(1);
  });

  it('skips blank rows', () => {
    const p = parseFr24Csv(`${header}\r\n,,,,,,,,,,,,,,,,,,\r\n${row}\r\n`);
    expect(p.candidates).toHaveLength(1);
  });

  it('flags unreadable times without dropping the row', () => {
    const p = parseFr24Csv(`${header}\n${row.replace('07:35:00', 'soon')}`);
    const c = p.candidates[0];
    expect(c.flight.depTime).toBeUndefined();
    expect(c.issues).toEqual([expect.objectContaining({ level: 'warn', field: 'depTime' })]);
    expect(c.flight.durationMin).toBe(55);
  });

  it('reports a missing airport as an error', () => {
    const p = parseFr24Csv(`${header}\n${row.replace('Los Angeles / Los Angeles International (LAX/KLAX)', '')}`);
    expect(candidateStatus(p.candidates[0])).toBe('error');
  });
});
