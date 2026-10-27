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
