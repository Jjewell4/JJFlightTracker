import { db } from '@/lib/db';
import { commitImport, planImport } from './commit';
import { findDuplicates } from './duplicates';
import { installReference } from '@/test/reference-fixture';
import { parseSheet } from './parse';
import { parseCsvText } from './sheet';
beforeAll(installReference);
import { beforeAll, describe, it, expect } from "vitest";
import Papa from "papaparse";
import { exportFr24Csv, exportSpreadsheetCsv } from "./export-csv";
import type { Flight } from "@/lib/types";
const flight = {
  id: "a",
  date: "2026-04-01",
  datePrecision: "day",
  from: "KSAN",
  to: "KLAX",
  createdAt: 1,
  updatedAt: 1,
  source: "manual",
} as Flight;
describe("spreadsheet exports", () => {
  it('reimports a portable export through automatic column mapping', () => {
    const csv = exportSpreadsheetCsv([{ ...flight, cabinClass: 'business', seatType: 'window', durationMin: 90, note: 'A, B' }]);
    const parsed = parseSheet(parseCsvText(csv));
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].flight).toMatchObject({ from: 'KSAN', to: 'KLAX', date: '2026-04-01', cabinClass: 'business', seatType: 'window', durationMin: 90, note: 'A, B' });
  });
  it("protects free text against spreadsheet formula execution in both formats", () => {
    for (const exportCsv of [exportFr24Csv, exportSpreadsheetCsv]) {
      const csv = exportCsv([
        { ...flight, note: '=HYPERLINK("https://example.com")' },
      ]);
      const result = Papa.parse<Record<string, string>>(csv, { header: true });
      expect(result.data[0].Notes ?? result.data[0].Note).toMatch(/^'=/);
    }
  });
  it("keeps readable values, precision, commas and newlines", () => {
    const csv = exportSpreadsheetCsv([
      {
        ...flight,
        datePrecision: "month",
        cabinClass: "business",
        note: "A, B\nC",
      },
    ]);
    expect(Papa.parse(csv, { header: true }).data[0]).toMatchObject({
      Date: "2026-04",
      From: "KSAN",
      To: "KLAX",
      "Cabin class": "business",
      Notes: "A, B\nC",
    });
  });
  it("exports headers for an empty log", () => {
    expect(exportSpreadsheetCsv([])).toContain("Date,From,To");
  });
});

// Every saved field is populated: a new Flight property must be included here and in the export schema.
const complete = {
  id: 'full-flight', date: '2026-04-01', datePrecision: 'day', flightNumber: 'UA123',
  airlineIcao: 'UAL', airlineIata: 'UA', airlineName: 'United, custom name',
  from: 'KSAN', to: 'KLAX', depTime: '00:00', arrTime: '00:00', arrDayOffset: 1,
  durationMin: 1440, distanceKm: 177.25, aircraftType: 'B738', aircraftName: 'My aircraft label',
  registration: 'N123AB', seatNumber: '12A', seatType: 'window', cabinClass: 'business', reason: 'leisure',
  occasion: 'wedding', occasion2: 'vacation', note: '=literal formula-like text, with a comma\nand a newline',
  tripId: 'trip-1', tripName: "'Wedding, weekend", source: 'screenshot', createdAt: 1234567890123, updatedAt: 1234567890999,
} satisfies Required<Flight>;

describe('complete spreadsheet round trips', () => {
  it('preserves every field, including midnight, day offset, both occasions and trip membership', () => {
    const parsed = parseSheet(parseCsvText(exportSpreadsheetCsv([complete])));
    expect(parsed.format).toBe('window-seat');
    expect(parsed.candidates[0].issues.filter(i => i.level !== 'info')).toEqual([]);
    expect(parsed.candidates[0].flight).toEqual(complete);
  });
  it('distinguishes same-named trips and keeps unknown dates and times unknown', () => {
    const input: Flight[] = [
      { ...flight, id: 'one', tripId: 'one', tripName: 'Vacation', date: '2026-01-01', datePrecision: 'year' },
      { ...flight, id: 'two', tripId: 'two', tripName: 'Vacation', date: '2026-04-01', datePrecision: 'month' },
    ];
    const parsed = parseSheet(parseCsvText(exportSpreadsheetCsv(input)));
    parsed.candidates.forEach((c, i) => {
      expect(c.flight).toMatchObject(input[i]);
      expect(c.flight.depTime).toBeUndefined(); expect(c.flight.arrTime).toBeUndefined();
    });
  });
  it('preserves previous-day arrival and durations longer than 24 hours', () => {
    const input = { ...complete, arrDayOffset: -1, durationMin: 1500.5 };
    expect(parseSheet(parseCsvText(exportSpreadsheetCsv([input]))).candidates[0].flight).toEqual(input);
  });
  it.each(['=SUM(1,2)', '+test', '-test', '@test', '\ttext', '\rtext', '\ntext', "'=literal", "'quote", "''two quotes", '  spaced  '])('reversibly escapes %j', note => {
    let restored: Flight = { ...complete, note, tripName: note };
    for (let i=0;i<2;i++) {
      restored = parseSheet(parseCsvText(exportSpreadsheetCsv([restored]))).candidates[0].flight as Flight;
      expect(restored.note).toBe(note); expect(restored.tripName).toBe(note);
    }
  });
  it('uses identical complete headers for empty and populated exports', () => {
    expect(parseCsvText(exportSpreadsheetCsv([])).headers).toEqual(parseCsvText(exportSpreadsheetCsv([complete])).headers);
  });
  it('rejects repeated IDs in one file instead of silently overwriting a flight', () => {
    const parsed = parseSheet(parseCsvText(exportSpreadsheetCsv([complete, { ...complete, to: 'KSFO' }])));
    expect(parsed.candidates[1].issues).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('Repeated Flight ID') }));
  });
  it('does not reinterpret an unsupported export version', () => {
    const sheet = parseCsvText(exportSpreadsheetCsv([complete]));
    sheet.rows[0][sheet.headers.indexOf('Window Seat export')] = '2';
    expect(parseSheet(sheet).candidates[0].issues).toContainEqual(expect.objectContaining({ level: 'error', message: expect.stringContaining('Unsupported spreadsheet version') }));
  });
});


it('restores trip legs to the database and re-imports without duplicating them', async () => {
  await db.flights.clear();
  try {
    const legs: Flight[] = [complete, { ...complete, id: 'return-leg', from: 'KLAX', to: 'KSAN', date: '2026-04-03' }];
    const candidates = parseSheet(parseCsvText(exportSpreadsheetCsv(legs))).candidates;
    const plan = (existing: Flight[], policy: 'skip' | 'update') => planImport({ candidates, duplicates: findDuplicates(candidates, existing), skipped: new Set(), policy });
    expect((await commitImport(plan([], 'skip'))).added).toBe(2);
    const saved = await db.flights.toArray();
    for (const f of saved) {
      expect(f).toMatchObject({ tripId: complete.tripId, tripName: complete.tripName, occasion: 'wedding', occasion2: 'vacation', source: 'screenshot', createdAt: complete.createdAt });
      expect(f.updatedAt).toBeGreaterThan(complete.updatedAt);
    }
    expect(plan(saved, 'skip').skippedDuplicates).toBe(2);
    await commitImport(plan(saved, 'skip'));
    expect(await db.flights.count()).toBe(2);
    candidates.forEach(c => { c.flight.tripName = 'Renamed trip'; });
    expect((await commitImport(plan(saved, 'update'))).updated).toBe(2);
    expect((await db.flights.toArray()).every(f => f.tripName === 'Renamed trip' && f.tripId === complete.tripId)).toBe(true);
  } finally { await db.flights.clear(); }
});


it('accepts rows added to an empty export template without internal metadata', () => {
  const sheet = parseCsvText(exportSpreadsheetCsv([]));
  const row = sheet.headers.map(h => ({ Date: '2026-01-02', From: 'SAN', To: 'LAX', 'Trip name': 'New trip', 'Duration minutes': '0' } as Record<string, string>)[h] ?? '');
  sheet.rows = [row];
  const candidate = parseSheet(sheet).candidates[0];
  expect(candidate.issues.filter(i => i.level === 'error')).toEqual([]);
  expect(candidate.flight).toMatchObject({ tripName: 'New trip', source: 'csv', durationMin: 0 });
  expect(candidate.flight.id).toBeUndefined();
});
