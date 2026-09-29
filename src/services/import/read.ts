/** Reads a user-provided file or pasted text into either a table or a parsed backup. */
import { looksLikeJson, parseBackup, type ParsedBackup } from './backup';
import { decodeBytes, parseCsvText, readXlsx, type Sheet } from './sheet';

export type LoadedSource =
  | { kind: 'table'; sheet: Sheet; fileName?: string; xlsx: boolean }
  | { kind: 'backup'; backup: ParsedBackup; fileName?: string };

export class ImportReadError extends Error {}

/** Loads pasted or already-decoded text (CSV/TSV or backup JSON). */
export function loadImportText(text: string, fileName?: string): LoadedSource {
  if (!text.trim()) throw new ImportReadError('That file is empty.');
  if (looksLikeJson(text)) {
    try {
      return { kind: 'backup', backup: parseBackup(text), fileName };
    } catch (e) {
      throw new ImportReadError((e as Error).message);
    }
  }
  const sheet = parseCsvText(text);
  if (!sheet.headers.length || !sheet.rows.length) throw new ImportReadError('No rows found. Is the first line a header row?');
  return { kind: 'table', sheet, fileName, xlsx: false };
}

/** Loads a .csv / .tsv / .txt / .json / .xlsx file. */
export async function loadImportFile(file: File): Promise<LoadedSource> {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf.slice(0, 4));
  const isZip = b[0] === 0x50 && b[1] === 0x4b; // "PK" – xlsx is a zip
  const isOldXls = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  if (isOldXls) throw new ImportReadError('That’s an old Excel (.xls) file. Open it and save as .xlsx or CSV, then try again.');
  if (isZip) {
    let sheet: Sheet;
    try {
      sheet = await readXlsx(buf);
    } catch {
      throw new ImportReadError('Couldn’t read that spreadsheet. Try saving it as .xlsx or CSV.');
    }
    if (!sheet.headers.length || !sheet.rows.length) throw new ImportReadError('No rows found in the first worksheet.');
    return { kind: 'table', sheet, fileName: file.name, xlsx: true };
  }
  return loadImportText(decodeBytes(buf), file.name);
}
