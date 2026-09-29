import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, getAllFlights, getSettings, saveSettings } from '@/lib/db';
import { DEFAULT_SETTINGS, type Flight } from '@/lib/types';
import { installReference } from '@/test/reference-fixture';
import { backupFileName, backupToJson, buildBackup, parseBackup } from './backup';
import { candidateStatus, type ImportCandidate } from './candidates';
import { commitImport, planImport } from './commit';
import { findDuplicates } from './duplicates';
import { exportFr24Csv, csvFileName, flightToFr24Row, FR24_HEADERS } from './export-csv';
import { parseFr24Csv } from './parse';

beforeAll(() => installReference());

const mk = (over: Partial<Flight> & { id: string }): Flight => ({
  date: '2021-05-01',
  datePrecision: 'day',
  from: 'KSAN',
  to: 'KLAX',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const cand = (key: string, flight: Partial<Flight>): ImportCandidate => ({
  key,
  rowNumber: 1,
  issues: [],
  flight: { date: '2021-05-01', datePrecision: 'day', from: 'KSAN', to: 'KLAX', source: 'fr24', ...flight },
});

describe('backup format', () => {
  const flights = [
    mk({ id: 'a', flightNumber: 'UA1', airlineIcao: 'UAL', depTime: '08:00', arrTime: '09:00', durationMin: 60, note: 'x', cabinClass: 'first', seatType: 'aisle', reason: 'crew' }),
    mk({ id: 'b', date: '2019-03-01', datePrecision: 'month', from: 'KSFO', to: 'EGLL', source: 'fr24' }),
  ];
  const settings = { ...DEFAULT_SETTINGS, homeCountry: 'GB', distanceUnit: 'km' as const, aeroDataBoxKey: 'secret' };

  it('is versioned and round-trips flights and settings exactly', () => {
    const now = new Date('2026-01-02T03:04:05Z');
    const backup = buildBackup(flights, settings, now);
    expect(backup).toMatchObject({ app: 'flight-log', version: 1, exportedAt: '2026-01-02T03:04:05.000Z' });
    expect(backupFileName(now)).toBe('flight-log-backup-2026-01-02.json');
    const parsed = parseBackup(backupToJson(backup));
    expect(parsed.version).toBe(1);
    expect(parsed.rejected).toBe(0);
    expect(parsed.candidates.map((c) => c.flight)).toEqual(flights);
    const { aeroDataBoxKey: _key, ...withoutKey } = settings;
    expect(parsed.settings).toEqual(withoutKey);
    expect(parsed.candidates.every((c) => candidateStatus(c) === 'ok')).toBe(true);
  });

  it('never writes the AeroDataBox key into a backup, and restoring keeps the current key', async () => {
    await db.flights.clear();
    const json = backupToJson(buildBackup(flights, settings));
    expect(json).not.toContain('secret');
    expect(json).not.toContain('aeroDataBoxKey');
    await saveSettings({ aeroDataBoxKey: 'mine' });
    const parsed = parseBackup(json);
    await commitImport(planImport({ candidates: parsed.candidates, duplicates: new Map(), skipped: new Set(), policy: 'skip' }), { settings: parsed.settings });
    expect((await getSettings()).aeroDataBoxKey).toBe('mine');
    await db.flights.clear();
    await db.kv.clear();
    // An older backup with an empty key doesn't clear it either.
    expect(parseBackup(JSON.stringify({ flights: [], settings: { aeroDataBoxKey: '', clock: '24h' } })).settings).toEqual({ clock: '24h' });
  });

  it('rejects things that are not backups with friendly errors', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/Flight Log backup/);
    expect(() => parseBackup('{"app":"other","flights":[]}')).toThrow(/different app/);
    expect(() => parseBackup('{"app":"flight-log","version":99,"flights":[]}')).toThrow(/newer version/);
  });

  it('accepts a bare array, a BOM, and drops invalid flights', () => {
    const text = '﻿' + JSON.stringify([flights[0], { from: 'KSAN' }, 'nope', { date: '2020-1-1', from: 'A', to: 'B' }, null]);
    const p = parseBackup(text);
    expect(p.candidates).toHaveLength(1);
    expect(p.rejected).toBe(4);
  });

  it('validates field types but preserves unknown fields (forward compatibility)', () => {
    const p = parseBackup(JSON.stringify({ flights: [{ ...flights[0], durationMin: 'lots', cabinClass: 'hyper', futureField: { a: 1 }, seatNumber: 12 }], settings: { theme: 'neon', clock: '24h', bogus: 1 } }));
    const f = p.candidates[0].flight as Record<string, unknown>;
    expect(f.durationMin).toBeUndefined();
    expect(f.cabinClass).toBeUndefined();
    expect(f.seatNumber).toBeUndefined();
    expect(f.futureField).toEqual({ a: 1 });
    expect(p.settings).toEqual({ clock: '24h' });
  });

  it('rejects impossible dates and cleans times/day offsets that could crash the app', () => {
    const p = parseBackup(
      JSON.stringify({
        flights: [
          { ...flights[0], date: '2024-13-45' },
          { ...flights[0], date: '2023-02-29' },
          { ...flights[0], id: 'ok', depTime: '25:99', arrTime: 'soon', arrDayOffset: 1e9 },
          { ...flights[0], id: 'neg', arrDayOffset: -40 },
        ],
      }),
    );
    expect(p.rejected).toBe(2);
    const [ok, neg] = p.candidates.map((c) => c.flight);
    expect(ok.depTime).toBeUndefined();
    expect(ok.arrTime).toBeUndefined();
    expect(ok.arrDayOffset).toBe(3);
    expect(neg.arrDayOffset).toBe(-2);
  });

  it('warns about same-airport flights', () => {
    const p = parseBackup(JSON.stringify({ flights: [{ ...flights[0], to: flights[0].from }] }));
    expect(p.candidates[0].issues).toContainEqual(expect.objectContaining({ level: 'warn', message: expect.stringContaining('same airport') }));
  });

  it('warns about unknown airports without rejecting the flight', () => {
    const p = parseBackup(JSON.stringify({ flights: [{ ...flights[0], to: 'ZZZZ' }] }));
    expect(candidateStatus(p.candidates[0])).toBe('warning');
  });
});

describe('findDuplicates', () => {
  const existing = [mk({ id: 'e1', flightNumber: 'UA1' }), mk({ id: 'e2', date: '2021-05-02' }), mk({ id: 'e3', date: '2021-05-03', flightNumber: 'UA9' })];

  it('pairs rows without flight numbers by departure time (same-day shuttles)', () => {
    const saved = [mk({ id: 'evening', from: 'KLAX', to: 'KSFO', depTime: '19:00', arrTime: '20:20' })];
    const d = findDuplicates(
      [cand('morning', { from: 'KLAX', to: 'KSFO', depTime: '07:00' }), cand('evening', { from: 'KLAX', to: 'KSFO', depTime: '19:00' })],
      saved,
    );
    expect([...d]).toEqual([['evening', 'evening']]);
    // Only the morning row: times too far apart to be the same flight.
    expect(findDuplicates([cand('morning', { from: 'KLAX', to: 'KSFO', depTime: '07:00' })], saved).size).toBe(0);
    // Within an hour (scheduled vs actual) still counts.
    expect(findDuplicates([cand('late', { from: 'KLAX', to: 'KSFO', depTime: '19:45' })], saved).get('late')).toBe('evening');
  });

  it('matches on date + route + flight number, or date + route when a number is missing', () => {
    const d = findDuplicates(
      [
        cand('same', { flightNumber: 'UA1' }),
        cand('otherNumber', { flightNumber: 'UA2', date: '2021-05-03', from: 'KSAN', to: 'KLAX' }),
        cand('noNumberBoth', { date: '2021-05-02' }),
        cand('noNumberIncoming', { date: '2021-05-03' }),
        cand('otherRoute', { to: 'KSFO' }),
        cand('otherDate', { date: '2021-06-01' }),
      ],
      existing,
    );
    expect([...d.entries()].sort()).toEqual([
      ['noNumberBoth', 'e2'],
      ['noNumberIncoming', 'e3'],
      ['same', 'e1'],
    ]);
  });

  it('lets each saved flight be claimed once (repeat trips are not collapsed)', () => {
    const d = findDuplicates([cand('one', {}), cand('two', {})], [mk({ id: 'only' })]);
    expect(d.size).toBe(1);
  });

  it('prefers the exact flight-number match over a loose one', () => {
    const d = findDuplicates([cand('loose', {}), cand('exact', { flightNumber: 'UA1' })], [mk({ id: 'x', flightNumber: 'UA1' })]);
    expect(d.get('exact')).toBe('x');
    expect(d.has('loose')).toBe(false);
  });

  it('matches backup flights by id first', () => {
    const d = findDuplicates([cand('r', { id: 'e2', date: '2000-01-01' })], existing);
    expect(d.get('r')).toBe('e2');
  });

  it('ignores candidates without a valid date', () => {
    expect(findDuplicates([cand('bad', { date: '' })], existing).size).toBe(0);
  });
});

describe('planImport + commitImport', () => {
  beforeEach(async () => {
    await db.flights.clear();
    await db.kv.clear();
  });

  it('skips duplicates, skipped rows and rows with errors', () => {
    const bad: ImportCandidate = { ...cand('bad', {}), issues: [{ level: 'error', field: 'date', message: 'x' }] };
    const plan = planImport({
      candidates: [cand('a', {}), cand('b', {}), cand('c', {}), bad],
      duplicates: new Map([['b', 'ex']]),
      skipped: new Set(['c']),
      policy: 'skip',
    });
    expect(plan.add).toHaveLength(1);
    expect(plan).toMatchObject({ skippedDuplicates: 1, skippedRows: 2, update: [] });
  });

  it('adds new flights in chunks with progress', async () => {
    const candidates = Array.from({ length: 95 }, (_, i) => cand(`k${i}`, { note: `n${i}` }));
    const plan = planImport({ candidates, duplicates: new Map(), skipped: new Set(), policy: 'skip' });
    const progress: number[] = [];
    const res = await commitImport(plan, { onProgress: (done) => progress.push(done), chunkSize: 40 });
    expect(res).toMatchObject({ added: 95, updated: 0, removed: 0 });
    expect(progress).toEqual([0, 40, 80, 95]);
    const all = await getAllFlights();
    expect(all).toHaveLength(95);
    expect(new Set(all.map((f) => f.id)).size).toBe(95);
    expect(all[0].createdAt).toBeGreaterThan(0);
  });

  it('updates duplicates in place, merging fields and keeping id/createdAt/source/seat', async () => {
    await db.flights.put(mk({ id: 'keep', flightNumber: 'UA1', seatNumber: '3A', createdAt: 5, source: 'manual' }));
    const c = cand('n', { flightNumber: 'UA1', aircraftType: 'B739', note: 'from file' });
    const dups = findDuplicates([c], await getAllFlights());
    const plan = planImport({ candidates: [c], duplicates: dups, skipped: new Set(), policy: 'update' });
    const res = await commitImport(plan);
    expect(res).toMatchObject({ added: 0, updated: 1 });
    const f = (await getAllFlights())[0];
    expect(f).toMatchObject({ id: 'keep', createdAt: 5, source: 'manual', seatNumber: '3A', aircraftType: 'B739', note: 'from file' });
    expect(await db.flights.count()).toBe(1);
  });

  it('replace mode swaps the whole log in one go and restores ids, timestamps and settings', async () => {
    await db.flights.bulkPut([mk({ id: 'old1' }), mk({ id: 'old2' })]);
    const backup = parseBackup(backupToJson(buildBackup([mk({ id: 'new1', createdAt: 42, updatedAt: 43 })], { ...DEFAULT_SETTINGS, theme: 'light' })));
    const plan = planImport({ candidates: backup.candidates, duplicates: new Map(), skipped: new Set(), policy: 'skip' });
    const res = await commitImport(plan, { replace: true, settings: backup.settings });
    expect(res).toMatchObject({ added: 1, removed: 2, settingsRestored: true });
    const all = await db.flights.toArray();
    expect(all).toEqual([expect.objectContaining({ id: 'new1', createdAt: 42, updatedAt: 43 })]);
    expect((await getSettings()).theme).toBe('light');
  });

  it('replace mode refuses an empty backup and leaves the log alone', async () => {
    await db.flights.bulkPut([mk({ id: 'old1' }), mk({ id: 'old2' })]);
    const empty = parseBackup(JSON.stringify({ app: 'flight-log', version: 1, flights: [], settings: {} }));
    const plan = planImport({ candidates: empty.candidates, duplicates: new Map(), skipped: new Set(), policy: 'skip' });
    await expect(commitImport(plan, { replace: true })).rejects.toThrow(/Nothing to restore/);
    expect(await db.flights.count()).toBe(2);
  });

  it('full backup export → wipe → import → identical flights (merge into empty log)', async () => {
    const original = [mk({ id: 'a', flightNumber: 'UA1' }), mk({ id: 'b', date: '2020-01-01', from: 'KSFO', to: 'KJFK', durationMin: 300 })];
    await db.flights.bulkPut(original);
    await saveSettings({ homeCountry: 'CA' });
    const json = backupToJson(buildBackup(await db.flights.toArray(), await getSettings()));
    await db.flights.clear();
    const parsed = parseBackup(json);
    const dups = findDuplicates(parsed.candidates, []);
    const res = await commitImport(planImport({ candidates: parsed.candidates, duplicates: dups, skipped: new Set(), policy: 'skip' }));
    expect(res.added).toBe(2);
    expect((await db.flights.toArray()).sort((x, y) => x.id.localeCompare(y.id))).toEqual(original);
  });

  it('importing the same backup twice skips everything (merge)', async () => {
    await db.flights.put(mk({ id: 'a' }));
    const parsed = parseBackup(backupToJson(buildBackup(await db.flights.toArray(), DEFAULT_SETTINGS)));
    const dups = findDuplicates(parsed.candidates, await db.flights.toArray());
    const plan = planImport({ candidates: parsed.candidates, duplicates: dups, skipped: new Set(), policy: 'skip' });
    expect(plan).toMatchObject({ add: [], skippedDuplicates: 1 });
  });

  it('importing the same FR24 file twice flags every row as a duplicate', async () => {
    const text = readFileSync(join(__dirname, '__fixtures__', 'fr24-sample.csv'), 'utf8');
    const first = parseFr24Csv(text).candidates.filter((c) => candidateStatus(c) !== 'error');
    await commitImport(planImport({ candidates: first, duplicates: new Map(), skipped: new Set(), policy: 'skip' }));
    expect(await db.flights.count()).toBe(first.length);
    const second = parseFr24Csv(text).candidates.filter((c) => candidateStatus(c) !== 'error');
    const dups = findDuplicates(second, await getAllFlights());
    expect(dups.size).toBe(second.length);
  });
});

describe('FR24-compatible CSV export', () => {
  const text = readFileSync(join(__dirname, '__fixtures__', 'fr24-sample.csv'), 'utf8');
  let flights: Flight[] = [];
  beforeAll(() => {
    const good = parseFr24Csv(text).candidates.filter((c) => candidateStatus(c) !== 'error');
    flights = good.map((c, i) => ({ ...(c.flight as Flight), id: `f${i}`, createdAt: i, updatedAt: i }));
  });

  it('writes the exact FR24 header and one row per flight', () => {
    const csv = exportFr24Csv(flights);
    expect(csv.split('\r\n')[0]).toBe(FR24_HEADERS.join(','));
    expect(csv.split('\r\n')[0]).toBe('Date,Flight number,From,To,Dep time,Arr time,Duration,Airline,Aircraft,Registration,Seat number,Seat type,Flight class,Flight reason,Note,Dep_id,Arr_id,Airline_id,Aircraft_id');
    expect(parseFr24Csv(csv).candidates).toHaveLength(flights.length);
    expect(csvFileName(new Date('2026-02-03T00:00:00Z'))).toBe('flight-log-2026-02-03.csv');
  });

  it('formats a row the way FR24 does', () => {
    const row = flightToFr24Row(flights[0]);
    expect(row.slice(0, 15)).toEqual([
      '2019-03-14',
      'UA1234',
      'San Diego / San Diego International (SAN/KSAN)',
      'San Francisco / San Francisco International (SFO/KSFO)',
      '07:35:00',
      '09:05:00',
      '01:30:00',
      'United Airlines (UA/UAL)',
      'Boeing 737-900 (B739)',
      'N12345',
      '12A',
      '1',
      '1',
      '2',
      'Client meeting, then dinner',
    ]);
  });

  it('writes partial dates, blank airline/aircraft and unknown times like FR24', () => {
    const month = flights.find((f) => f.note === 'Month only')!;
    expect(flightToFr24Row(month)).toEqual(expect.arrayContaining(['2019-03', '00:00:00', ' (/)', ' ()']));
    expect(flightToFr24Row(flights.find((f) => f.note === 'Year only')!)[0]).toBe('2017');
  });

  it('round-trips through our own importer without losing anything', () => {
    const again = parseFr24Csv(exportFr24Csv(flights)).candidates.map((c) => c.flight);
    const pick = (f: Partial<Flight>) => ({
      date: f.date,
      datePrecision: f.datePrecision,
      from: f.from,
      to: f.to,
      flightNumber: f.flightNumber,
      depTime: f.depTime,
      arrTime: f.arrTime,
      arrDayOffset: f.arrDayOffset,
      durationMin: f.durationMin,
      airlineIcao: f.airlineIcao,
      aircraftType: f.aircraftType,
      registration: f.registration,
      seatNumber: f.seatNumber,
      seatType: f.seatType,
      cabinClass: f.cabinClass,
      reason: f.reason,
      note: f.note,
    });
    const sortKey = (f: Partial<Flight>) => `${f.date}|${f.from}|${f.to}|${f.note ?? ''}`;
    const a = flights.map(pick).sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    const b = again.map((f) => pick(f as Flight)).sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    expect(b).toEqual(a);
  });
});
