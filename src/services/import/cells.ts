/**
 * Cell-level parsing shared by every importer: dates, clock times, durations and the
 * small code/word vocabularies (seat type, cabin class, reason). Pure functions only.
 *
 * Everything here is deliberately forgiving because the same values arrive as clean
 * strings (CSV from Flightradar24), as Excel-mangled strings ("3/14/2019", "7:35"),
 * or as real Excel values (serial numbers, fractions of a day, JS Dates).
 */
import type { CabinClass, DatePrecision, FlightReason, SeatType } from '@/lib/types';

/** A raw spreadsheet/CSV cell. */
export type Cell = string | number | boolean | Date | null | undefined;

export type DateOrder = 'mdy' | 'dmy';

export interface ParsedDate {
  /** YYYY-MM-DD (unknown parts are 01). */
  date: string;
  precision: DatePrecision;
  /** Minutes after midnight when the cell also carried a time (e.g. "2019-03-14 07:35"). */
  minutes?: number;
  /** Human note when we had to guess (2-digit year, "Mar-19" style month, ...). */
  note?: string;
}

const MS_PER_DAY = 86_400_000;
/** Excel's day 0 (1899-12-30) as a JS UTC timestamp. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

const pad2 = (n: number) => String(n).padStart(2, '0');

export function isBlank(v: Cell): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v));
}

/** Trimmed text of a cell ('' when blank). Dates become YYYY-MM-DD. */
export function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isNaN(v) ? '' : String(v);
  return String(v).replace(/^\uFEFF/, '').trim();
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validYmd(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function fullYear(y: number): { year: number; guessed: boolean } {
  if (y >= 100) return { year: y, guessed: false };
  // 2-digit years: 00–69 → 2000s, 70–99 → 1900s.
  return { year: y >= 70 ? 1900 + y : 2000 + y, guessed: true };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Converts an Excel serial (days since 1899-12-30, fractional part = time). */
export function excelSerialToParts(serial: number): { date: string; minutes: number } | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return undefined;
  const ms = EXCEL_EPOCH + Math.round(serial * MS_PER_DAY);
  const dt = new Date(ms);
  const minutes = dt.getUTCHours() * 60 + dt.getUTCMinutes() + (dt.getUTCSeconds() >= 30 ? 1 : 0);
  const y = dt.getUTCFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return { date: ymd(y, dt.getUTCMonth() + 1, dt.getUTCDate()), minutes: minutes % 1440 };
}

function parseTimeSuffix(h: string | undefined, mi: string | undefined, ap: string | undefined): number | undefined {
  if (h === undefined || mi === undefined) return undefined;
  let hh = Number(h);
  const mm = Number(mi);
  if (ap) {
    const pm = /p/i.test(ap);
    if (hh < 1 || hh > 12) return undefined;
    hh = (hh % 12) + (pm ? 12 : 0);
  }
  if (hh > 23 || mm > 59) return undefined;
  return hh * 60 + mm;
}

const TIME_TAIL = String.raw`(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp][Mm])?\s*(?:Z|[+-]\d{2}:?\d{2})?)?`;
const RE_ISO_DAY = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME_TAIL}$`);
const RE_NUM_DAY = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})${TIME_TAIL}$`);
const RE_D_MON_Y = /^(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/;
const RE_MON_D_Y = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/;
const RE_MON_Y = /^([A-Za-z]{3,9})\.?[\s,/-]+(\d{2}|\d{4})$/;
const RE_Y_MON = /^(\d{4})[\s,/-]+([A-Za-z]{3,9})\.?$/;

/**
 * Parses a date cell. Returns undefined when it is not a recognizable date.
 * `order` resolves ambiguous "3/4/2019" values (default month-first like Excel/US).
 */
export function parseDateValue(v: Cell, order: DateOrder = 'mdy'): ParsedDate | undefined {
  if (isBlank(v)) return undefined;

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    // read-excel-file yields UTC dates; treat components as the calendar date.
    const y = v.getUTCFullYear();
    if (!validYmd(y, v.getUTCMonth() + 1, v.getUTCDate())) return undefined;
    const minutes = v.getUTCHours() * 60 + v.getUTCMinutes();
    return { date: ymd(y, v.getUTCMonth() + 1, v.getUTCDate()), precision: 'day', minutes: minutes || undefined };
  }

  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 1900 && v <= 2100) return { date: `${v}-01-01`, precision: 'year' };
    const s = excelSerialToParts(v);
    return s ? { date: s.date, precision: 'day', minutes: Number.isInteger(v) ? undefined : s.minutes || undefined } : undefined;
  }

  if (typeof v !== 'string') return undefined;
  const s = cellText(v).replace(/\s+/g, ' ');

  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})$/.exec(s))) {
    const y = Number(m[1]);
    return y >= 1900 && y <= 2100 ? { date: `${y}-01-01`, precision: 'year' } : undefined;
  }
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return validYmd(y, mo, 1) ? { date: ymd(y, mo, 1), precision: 'month' } : undefined;
  }
  if ((m = RE_ISO_DAY.exec(s))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validYmd(y, mo, d)) return undefined;
    return { date: ymd(y, mo, d), precision: 'day', minutes: parseTimeSuffix(m[4], m[5], m[6]) };
  }
  if ((m = RE_NUM_DAY.exec(s))) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const dotted = s.includes('.') && !s.includes('/');
    // "14.03.2019" is European by convention; otherwise honor the requested order, but
    // a value >12 in either position settles it.
    let dayFirst = dotted || order === 'dmy';
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    if (!dayFirst) [a, b] = [b, a]; // a = day, b = month
    const { year, guessed } = fullYear(Number(m[3]));
    if (!validYmd(year, b, a)) return undefined;
    return {
      date: ymd(year, b, a),
      precision: 'day',
      minutes: parseTimeSuffix(m[4], m[5], m[6]),
      note: guessed ? `Read two-digit year as ${year}` : undefined,
    };
  }
  if ((m = RE_D_MON_Y.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()];
    const { year } = fullYear(Number(m[3]));
    const d = Number(m[1]);
    return mo && validYmd(year, mo, d) ? { date: ymd(year, mo, d), precision: 'day' } : undefined;
  }
  if ((m = RE_MON_D_Y.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    return mo && validYmd(y, mo, d) ? { date: ymd(y, mo, d), precision: 'day' } : undefined;
  }
  if ((m = RE_MON_Y.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const { year, guessed } = fullYear(Number(m[2]));
    if (!mo || !validYmd(year, mo, 1)) return undefined;
    return {
      date: ymd(year, mo, 1),
      precision: 'month',
      note: guessed ? `Read "${s}" as ${m[1]} ${year} (month only)` : undefined,
    };
  }
  if ((m = RE_Y_MON.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()];
    const y = Number(m[1]);
    return mo && validYmd(y, mo, 1) ? { date: ymd(y, mo, 1), precision: 'month' } : undefined;
  }
  if ((m = /^(\d{1,2})\/(\d{4})$/.exec(s))) {
    const mo = Number(m[1]);
    const y = Number(m[2]);
    return validYmd(y, mo, 1) ? { date: ymd(y, mo, 1), precision: 'month' } : undefined;
  }
  if (/^\d{5,6}(\.\d+)?$/.test(s)) {
    const p = excelSerialToParts(Number(s));
    return p ? { date: p.date, precision: 'day', note: 'Read as an Excel date number' } : undefined;
  }
  return undefined;
}

/** Looks at slash/dash separated day-first vs month-first evidence across many cells. */
export function detectDateOrder(values: Cell[]): DateOrder {
  let mdy = 0;
  let dmy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(v);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else if (v.includes('.') && !v.includes('/')) dmy++;
  }
  return dmy > mdy ? 'dmy' : 'mdy';
}

// ---------------------------------------------------------------- times

export function minutesToHHmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Parses a clock time to minutes after midnight.
 * Returns undefined for blank cells and null when the cell is present but unreadable.
 * Accepts "07:35:00", "7:35", "7:35 PM", "0735", Excel fractions (0.3159) and Dates.
 */
export function parseTimeOfDay(v: Cell): number | null | undefined {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const total = Math.round((v.getTime() - EXCEL_EPOCH) / 60000);
    return ((total % 1440) + 1440) % 1440;
  }
  if (typeof v === 'number') {
    if (v < 0) return null;
    const frac = v - Math.floor(v);
    if (v >= 1 && frac === 0) return null;
    return Math.round(frac * 1440) % 1440;
  }
  if (typeof v !== 'string') return null;
  const s = cellText(v);
  let m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?$/.exec(s);
  if (m) {
    const r = parseTimeSuffix(m[1], m[2], m[4]?.replace(/\./g, ''));
    return r === undefined ? null : r;
  }
  if ((m = /^(\d{1,2})\s*([AaPp]\.?[Mm]\.?)$/.exec(s))) {
    const r = parseTimeSuffix(m[1], '0', m[2].replace(/\./g, ''));
    return r === undefined ? null : r;
  }
  if ((m = /^(\d{2})(\d{2})$/.exec(s))) {
    const r = parseTimeSuffix(m[1], m[2], undefined);
    return r === undefined ? null : r;
  }
  if (/^0?\.\d+$|^0\.\d+$/.test(s)) return Math.round(Number(s) * 1440) % 1440;
  // ISO-ish datetimes: pull the time part.
  if ((m = /^\d{4}-\d{2}-\d{2}[T\s](\d{1,2}):(\d{2})/.exec(s))) {
    const r = parseTimeSuffix(m[1], m[2], undefined);
    return r === undefined ? null : r;
  }
  return null;
}

/**
 * Parses a duration to minutes. Accepts "02:25:00", "2:25", "2h 25m", "145" (minutes),
 * "2.5h", Excel fractions of a day and Dates. undefined = blank, null = unreadable.
 */
export function parseDurationMinutes(v: Cell): number | null | undefined {
  if (isBlank(v)) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return Math.max(0, Math.round((v.getTime() - EXCEL_EPOCH) / 60000));
  }
  if (typeof v === 'number') {
    if (v < 0) return null;
    // Excel stores durations as fractions of a day; bare bigger numbers are minutes.
    return v < 10 && !Number.isInteger(v) ? Math.round(v * 1440) : Math.round(v);
  }
  if (typeof v !== 'string') return null;
  const s = cellText(v).toLowerCase();
  let m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]) + (Number(m[3] ?? 0) >= 30 ? 1 : 0);
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(s))) {
    return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
  }
  if ((m = /^(\d+)\s*(?:m|min|mins|minute|minutes)$/.exec(s))) return Number(m[1]);
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d*\.\d+$/.test(s)) {
    const n = Number(s);
    return n < 10 ? Math.round(n * 1440) : Math.round(n);
  }
  return null;
}

// ---------------------------------------------------------------- vocabularies

/** Integer code from "1", 1 or "1.0" (Excel loves adding ".0"); NaN otherwise. */
function codeNum(v: Cell): number {
  const s = cellText(v);
  return /^\d+(\.0+)?$/.test(s) ? Number(s) : NaN;
}

function token(v: Cell): string {
  return cellText(v).toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
}

/** Flightradar24 codes: 1 window, 2 middle, 3 aisle (0/blank unknown). Also accepts words. */
export function parseSeatType(v: Cell): SeatType | undefined {
  const t = token(v);
  if (!t) return undefined;
  const n = codeNum(v);
  if (n === 1) return 'window';
  if (n === 2) return 'middle';
  if (n === 3) return 'aisle';
  if (/^(w|window)$/.test(t)) return 'window';
  if (/^(m|middle|center|centre)$/.test(t)) return 'middle';
  if (/^(a|aisle)$/.test(t)) return 'aisle';
  return undefined;
}

/** FR24: 1 economy, 2 business, 3 first, 4 economy+ (premium), 5 private. Also accepts words. */
export function parseCabinClass(v: Cell): CabinClass | undefined {
  const t = token(v);
  if (!t) return undefined;
  const n = codeNum(v);
  if (n === 1) return 'economy';
  if (n === 2) return 'business';
  if (n === 3) return 'first';
  if (n === 4) return 'premium';
  if (n === 5) return 'private';
  if (/premium|economy plus|economy\+|comfort|^w$|^plus$/.test(t)) return 'premium';
  if (/^(y|economy|eco|coach|main cabin|basic economy|standard)$/.test(t)) return 'economy';
  if (/^(business|c|j|biz|club)\b/.test(t)) return 'business';
  if (/^(first|f)\b/.test(t)) return 'first';
  if (/^(private|charter|p)$/.test(t)) return 'private';
  return undefined;
}

/** FR24: 1 leisure, 2 business, 3 crew, 4 other. Also accepts words. */
export function parseFlightReason(v: Cell): FlightReason | undefined {
  const t = token(v);
  if (!t) return undefined;
  const n = codeNum(v);
  if (n === 1) return 'leisure';
  if (n === 2) return 'business';
  if (n === 3) return 'crew';
  if (n === 4) return 'other';
  if (/business|work|job|conference/.test(t)) return 'business';
  if (/leisure|personal|vacation|holiday|pleasure|tourism|fun/.test(t)) return 'leisure';
  if (/crew|staff|employee/.test(t)) return 'crew';
  if (/other|misc|none/.test(t)) return 'other';
  return undefined;
}

export const SEAT_TYPE_CODE: Record<SeatType, number> = { window: 1, middle: 2, aisle: 3 };
export const CABIN_CLASS_CODE: Record<CabinClass, number> = { economy: 1, business: 2, first: 3, premium: 4, private: 5 };
export const REASON_CODE: Record<FlightReason, number> = { leisure: 1, business: 2, crew: 3, other: 4 };
