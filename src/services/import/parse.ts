/** High-level entry points: analyze a sheet, then turn it into import candidates. */
import { parseDateValue, type DateOrder } from './cells';
import { candidatesFromSheet, type ImportCandidate } from './candidates';
import { detectFormat, detectMapping, guessDateOrder, type ColumnMapping, type SheetFormat } from './mapping';
import { parseCsvText, type Sheet } from './sheet';

export interface SheetAnalysis {
  format: SheetFormat;
  mapping: ColumnMapping;
  dateOrder: DateOrder;
}

/** Detects the export format, column mapping and date order for a sheet. */
export function analyzeSheet(sheet: Sheet): SheetAnalysis {
  const format = detectFormat(sheet.headers);
  const mapping = detectMapping(sheet, (c) => parseDateValue(c));
  return { format, mapping, dateOrder: guessDateOrder(sheet, mapping.date) };
}

export interface ParsedSheet extends SheetAnalysis {
  candidates: ImportCandidate[];
}

/** Parses a sheet with an explicit (or auto-detected) mapping. */
export function parseSheet(
  sheet: Sheet,
  opts: { mapping?: ColumnMapping; dateOrder?: DateOrder; source?: 'fr24' | 'csv' } = {},
): ParsedSheet {
  const auto = analyzeSheet(sheet);
  const mapping = opts.mapping ?? auto.mapping;
  const dateOrder = opts.dateOrder ?? auto.dateOrder;
  const source = opts.source ?? (auto.format === 'fr24' ? 'fr24' : 'csv');
  return { format: auto.format, mapping, dateOrder, candidates: candidatesFromSheet(sheet, mapping, { source, dateOrder }) };
}

/** Parses Flightradar24 CSV text end to end. */
export function parseFr24Csv(text: string): ParsedSheet {
  return parseSheet(parseCsvText(text), { source: 'fr24' });
}
