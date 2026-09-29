/**
 * Turning files/text into a plain table ("sheet"): CSV text (BOM, ';' or tab delimiters,
 * quoted fields, CRLF) and .xlsx workbooks. Parsing is pure; only `readXlsx` touches a library
 * (lazy-loaded so it never costs anything until an Excel file is imported).
 */
import Papa from 'papaparse';
import type { Cell } from './cells';
import { cellText } from './cells';

export interface Sheet {
  headers: string[];
  rows: Cell[][];
  /** Worksheet name for xlsx sources. */
  sheetName?: string;
}

/** Decodes bytes as UTF-8 (BOM aware), falling back to UTF-16 (BOM) then Windows-1252. */
export function decodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Headers that identify which row is the header row (used to skip title rows). */
const HEADER_HINT = /^(date|flight|from|to|origin|destination|dep|arr|departure|arrival|airline|aircraft|carrier|registration|reg|tail|seat|class|cabin|note|notes|duration|number|airport|route|reason)/i;

function headerScore(row: Cell[]): number {
  return row.reduce<number>((n, c) => n + (HEADER_HINT.test(cellText(c)) ? 1 : 0), 0);
}

/** Finds the header row among the first rows (spreadsheets often start with a title). */
export function findHeaderRow(rows: Cell[][]): number {
  let best = 0;
  let bestScore = headerScore(rows[0] ?? []);
  for (let i = 1; i < Math.min(rows.length, 10); i++) {
    const s = headerScore(rows[i]);
    if (s > bestScore + 1 || (bestScore === 0 && s > 0)) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

function rowsToSheet(all: Cell[][]): Sheet {
  const nonEmpty = all.filter((r) => r.some((c) => cellText(c) !== ''));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const h = findHeaderRow(nonEmpty);
  const width = Math.max(...nonEmpty.slice(h).map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    let name = cellText(nonEmpty[h][i]) || `Column ${i + 1}`;
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n) name = `${name} (${n + 1})`;
    return name;
  });
  const rows = nonEmpty.slice(h + 1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null));
  return { headers, rows };
}

/** Parses CSV text into a sheet. Never throws; returns an empty sheet for empty input. */
export function parseCsvText(text: string): Sheet {
  let src = text.replace(/^\uFEFF/, '');
  let delimiter: string | undefined;
  // Excel sometimes writes a "sep=;" hint line first.
  const sep = /^sep=(.)\r?\n/i.exec(src);
  if (sep) {
    delimiter = sep[1];
    src = src.slice(sep[0].length);
  }
  const res = Papa.parse<string[]>(src, {
    delimiter,
    delimitersToGuess: [',', ';', '\t', '|'],
    skipEmptyLines: 'greedy',
    header: false,
  });
  return rowsToSheet(res.data as Cell[][]);
}

/** Reads the first worksheet that has data from an .xlsx file. Lazy-loads read-excel-file. */
export async function readXlsx(input: Blob | ArrayBuffer): Promise<Sheet> {
  const mod = await import('read-excel-file');
  const readXlsxFile = mod.default as unknown as (i: Blob | ArrayBuffer, o?: { sheet?: number | string }) => Promise<Cell[][]>;
  const readSheetNames = mod.readSheetNames as unknown as (i: Blob | ArrayBuffer) => Promise<string[]>;
  let names: string[] = [];
  try {
    names = await readSheetNames(input);
  } catch {
    /* fall through to first sheet */
  }
  const candidates = names.length ? names : [undefined];
  let best: Sheet = { headers: [], rows: [] };
  for (let i = 0; i < candidates.length; i++) {
    const rows = await readXlsxFile(input, { sheet: i + 1 });
    const sheet = rowsToSheet(rows);
    if (sheet.rows.length > best.rows.length) best = { ...sheet, sheetName: candidates[i] };
    if (best.rows.length && i === 0) break; // first sheet with data wins
  }
  return best;
}

/** Converts a table of cells (already in memory) to a sheet — handy for tests and paste. */
export function sheetFromRows(rows: Cell[][]): Sheet {
  return rowsToSheet(rows);
}
