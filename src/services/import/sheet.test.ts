import { zipSync, strToU8 } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import { candidateStatus } from './candidates';
import { parseSheet } from './parse';
import { loadImportFile, loadImportText } from './read';
import { decodeBytes, findHeaderRow, parseCsvText, readXlsx } from './sheet';

beforeAll(() => installReference());

describe('parseCsvText', () => {
  it('strips a BOM and handles CRLF and quoted fields with commas, quotes and newlines', () => {
    const s = parseCsvText('﻿Date,Note\r\n2019-01-01,"a, ""b""\r\nc"\r\n2019-01-02,plain\r\n');
    expect(s.headers).toEqual(['Date', 'Note']);
    expect(s.rows).toEqual([
      ['2019-01-01', 'a, "b"\r\nc'],
      ['2019-01-02', 'plain'],
    ]);
  });
  it('guesses ; and tab delimiters', () => {
    expect(parseCsvText('a;b;c\n1;2;3').headers).toEqual(['a', 'b', 'c']);
    expect(parseCsvText('a\tb\tc\n1\t2\t3').rows).toEqual([['1', '2', '3']]);
  });
  it('honours Excel "sep=" lines', () => {
    const s = parseCsvText('sep=;\nDate;From\n2019-01-01;SAN');
    expect(s.headers).toEqual(['Date', 'From']);
  });
  it('pads short rows, names blank headers and de-duplicates repeated ones', () => {
    const s = parseCsvText('Date,,Date\n1\n');
    expect(s.headers).toEqual(['Date', 'Column 2', 'Date (2)']);
    expect(s.rows).toEqual([['1', null, null]]);
  });
  it('returns an empty sheet for empty input', () => {
    expect(parseCsvText('')).toEqual({ headers: [], rows: [] });
    expect(parseCsvText('\n\n ,,\n')).toEqual({ headers: [], rows: [] });
  });
  it('finds a header row below title rows', () => {
    expect(findHeaderRow([['Flights 2019', ''], ['', ''], ['Date', 'From', 'To'], ['x', 'y', 'z']])).toBe(2);
    expect(findHeaderRow([['Date', 'From', 'To'], ['x', 'y', 'z']])).toBe(0);
  });
});

describe('decodeBytes', () => {
  it('decodes UTF-8 with and without BOM', () => {
    expect(decodeBytes(new TextEncoder().encode('Zürich').buffer as ArrayBuffer)).toBe('Zürich');
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]).buffer)).toBe('A');
  });
  it('falls back to Windows-1252 for legacy Excel CSVs', () => {
    expect(decodeBytes(new Uint8Array([0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68]).buffer)).toBe('Zürich');
  });
  it('decodes UTF-16 with a BOM (Excel "Unicode text")', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x44, 0x00, 0x61, 0x00]);
    expect(decodeBytes(bytes.buffer)).toBe('Da');
  });
});

describe('loadImportText', () => {
  it('routes JSON to the backup parser and CSV to a table', () => {
    expect(loadImportText('{"flights":[]}').kind).toBe('backup');
    const t = loadImportText('Date,From,To\n2019-01-01,SAN,LAX');
    expect(t.kind).toBe('table');
  });
  it('gives friendly errors', () => {
    expect(() => loadImportText('   ')).toThrow(/empty/);
    expect(() => loadImportText('Date,From,To')).toThrow(/No rows/);
    expect(() => loadImportText('{"nope":1}')).toThrow(/backup/);
  });
});

// ---- a tiny .xlsx writer so the real read-excel-file code path is exercised ----
type XCell = { v: string | number; style?: 'date' | 'time' | 'dur' };
function buildXlsx(rows: (XCell | null)[][], sheetNames = ['Flights']): Uint8Array {
  const strings: string[] = [];
  const sst = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) i = strings.push(s) - 1;
    return i;
  };
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheetXml = (data: (XCell | null)[][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">${r
            .map((c, ci) => {
              if (!c) return '';
              const ref = `${col(ci)}${ri + 1}`;
              if (typeof c.v === 'string') return `<c r="${ref}" t="s"><v>${sst(c.v)}</v></c>`;
              const s = c.style === 'date' ? 1 : c.style === 'time' ? 2 : c.style === 'dur' ? 3 : 0;
              return `<c r="${ref}" s="${s}"><v>${c.v}</v></c>`;
            })
            .join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const sheets = sheetNames.map((_, i) => (i === 0 ? sheetXml(rows) : sheetXml([[{ v: 'x' }]])));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetNames.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="21" applyNumberFormat="1"/><xf numFmtId="46" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  files['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`).join('')}</sst>`,
  );
  return zipSync(files);
}

describe('xlsx import (real read-excel-file)', () => {
  const s = (v: string): XCell => ({ v });
  const rows: (XCell | null)[][] = [
    ['Date', 'Flight number', 'From', 'To', 'Dep time', 'Arr time', 'Duration', 'Seat type', 'Flight class'].map(s),
    [{ v: 43538, style: 'date' }, s('UA1234'), s('San Diego / San Diego International (SAN/KSAN)'), s('San Francisco / San Francisco International (SFO/KSFO)'), { v: 0.315972222, style: 'time' }, { v: 0.378472222, style: 'time' }, { v: 0.0625, style: 'dur' }, { v: 1 }, { v: 1 }],
    [{ v: 43600, style: 'date' }, s('BA286'), s('SFO'), s('EGLL'), { v: 0.72569444, style: 'time' }, { v: 0.47916667, style: 'time' }, { v: 0.4201389, style: 'dur' }, { v: 3 }, { v: 4 }],
    [s('2019'), null, s('SAN'), s('LAX'), { v: 0, style: 'time' }, { v: 0, style: 'time' }, null, { v: 0 }, { v: 0 }],
  ];

  it('reads dates, times and durations stored as real Excel values', async () => {
    const bytes = buildXlsx(rows);
    const sheet = await readXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(sheet.headers[0]).toBe('Date');
    expect(sheet.rows).toHaveLength(3);
    const p = parseSheet(sheet);
    expect(p.format).toBe('fr24');
    const [a, b, c] = p.candidates;
    expect(a.flight).toMatchObject({ date: '2019-03-14', from: 'KSAN', to: 'KSFO', depTime: '07:35', arrTime: '09:05', durationMin: 90, seatType: 'window', cabinClass: 'economy', source: 'fr24' });
    expect(b.flight).toMatchObject({ date: '2019-05-15', from: 'KSFO', to: 'EGLL', depTime: '17:25', arrTime: '11:30', arrDayOffset: 1, durationMin: 605, seatType: 'aisle', cabinClass: 'premium' });
    expect(c.flight).toMatchObject({ date: '2019-01-01', datePrecision: 'year' });
    expect(c.flight.depTime).toBeUndefined();
    expect(p.candidates.map(candidateStatus)).toEqual(['ok', 'ok', 'ok']);
  });

  it('loadImportFile detects xlsx by content and reads the first sheet with data', async () => {
    const bytes = buildXlsx(rows, ['Flights', 'Other']);
    const file = new File([bytes as BlobPart], 'my-flights.xlsx');
    const loaded = await loadImportFile(file);
    expect(loaded).toMatchObject({ kind: 'table', xlsx: true, fileName: 'my-flights.xlsx' });
  });

  it('loadImportFile reads CSV files and rejects legacy .xls with a helpful message', async () => {
    const csv = new File(['Date,From,To\n2019-01-01,SAN,LAX'], 'x.csv');
    expect((await loadImportFile(csv)).kind).toBe('table');
    const xls = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]) as BlobPart], 'old.xls');
    await expect(loadImportFile(xls)).rejects.toThrow(/\.xls/);
  });
});
