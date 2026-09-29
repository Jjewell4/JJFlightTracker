/** JSON backup: versioned export of all flights + settings, and a validating parser. */
import { getAirport } from '@/data/reference';
import { isValidTime } from '@/lib/time';
import type { Flight, Settings } from '@/lib/types';
import { daysInMonth } from './cells';
import { sameAirportIssue, type ImportCandidate, type ImportFlight, type ImportIssue } from './candidates';

export const BACKUP_APP = 'flight-log';
export const BACKUP_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  flights: Flight[];
  /** Settings minus secrets (the AeroDataBox API key never leaves the device). */
  settings: Omit<Settings, 'aeroDataBoxKey'>;
}

export function buildBackup(flights: Flight[], settings: Settings, now: Date = new Date()): Backup {
  const { aeroDataBoxKey: _secret, ...safeSettings } = settings;
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), flights, settings: safeSettings };
}

export function backupToJson(backup: Backup): string {
  return JSON.stringify(backup, null, 2);
}

export function backupFileName(now: Date = new Date()): string {
  return `flight-log-backup-${now.toISOString().slice(0, 10)}.json`;
}

export interface ParsedBackup {
  version: number;
  exportedAt?: string;
  candidates: ImportCandidate[];
  settings?: Partial<Settings>;
  /** Flights that could not be read at all (invalid/missing required fields). */
  rejected: number;
}

const SETTING_TYPES: { [K in keyof Settings]-?: (v: unknown) => boolean } = {
  homeCountry: (v) => typeof v === 'string' && /^[A-Za-z]{2}$/.test(v),
  distanceUnit: (v) => v === 'mi' || v === 'km',
  clock: (v) => v === '12h' || v === '24h',
  theme: (v) => v === 'system' || v === 'dark' || v === 'light',
  // Only in backups made by older versions. Never restore an empty key over the current one.
  aeroDataBoxKey: (v) => typeof v === 'string' && v.trim() !== '',
  enableAdsbdb: (v) => typeof v === 'boolean',
  showAirlineLogos: (v) => typeof v === 'boolean',
};

function sanitizeSettings(raw: unknown): Partial<Settings> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Partial<Settings> = {};
  for (const key of Object.keys(SETTING_TYPES) as (keyof Settings)[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (v !== undefined && SETTING_TYPES[key](v)) (out as Record<string, unknown>)[key] = key === 'homeCountry' ? String(v).toUpperCase() : v;
  }
  return Object.keys(out).length ? out : undefined;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A real calendar date in YYYY-MM-DD form (rejects 2024-13-45 and 2023-02-29). */
function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Validates one flight object. Known fields are type-checked; unknown extras are kept. */
export function sanitizeFlight(raw: unknown): ImportFlight | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.from) || !isStr(r.to) || !isStr(r.date) || !isCalendarDate(r.date)) return undefined;
  const f: Record<string, unknown> = { ...r };
  const strings = ['flightNumber', 'airlineIcao', 'airlineIata', 'airlineName', 'depTime', 'arrTime', 'aircraftType', 'aircraftName', 'registration', 'seatNumber', 'note'];
  for (const k of strings) if (f[k] !== undefined && typeof f[k] !== 'string') delete f[k];
  const numbers = ['arrDayOffset', 'durationMin', 'distanceKm', 'createdAt', 'updatedAt'];
  for (const k of numbers) if (f[k] !== undefined && (typeof f[k] !== 'number' || !Number.isFinite(f[k]))) delete f[k];
  for (const k of ['depTime', 'arrTime']) if (f[k] !== undefined && !isValidTime(f[k] as string)) delete f[k];
  if (typeof f.arrDayOffset === 'number') f.arrDayOffset = Math.max(-2, Math.min(3, Math.round(f.arrDayOffset)));
  const enums: [string, string[]][] = [
    ['datePrecision', ['day', 'month', 'year']],
    ['seatType', ['window', 'middle', 'aisle']],
    ['cabinClass', ['economy', 'premium', 'business', 'first', 'private']],
    ['reason', ['leisure', 'business', 'crew', 'other']],
    ['source', ['manual', 'lookup', 'fr24', 'csv', 'backup']],
  ];
  for (const [k, allowed] of enums) if (f[k] !== undefined && !allowed.includes(f[k] as string)) delete f[k];
  if (typeof f.id !== 'string' || !f.id) delete f.id;
  f.from = r.from.trim();
  f.to = r.to.trim();
  f.datePrecision ??= 'day';
  f.source ??= 'backup';
  return f as unknown as ImportFlight;
}

/** Parses backup JSON text. Throws Error with a friendly message when it isn't a Flight Log backup. */
export function parseBackup(text: string): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  const obj = Array.isArray(data) ? { flights: data } : (data as Record<string, unknown> | null);
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.flights)) {
    throw new Error('This doesn’t look like a Flight Log backup (no flights found).');
  }
  if (obj.app !== undefined && obj.app !== BACKUP_APP) throw new Error('This backup was made by a different app.');
  const version = typeof obj.version === 'number' ? obj.version : 1;
  if (version > BACKUP_VERSION) throw new Error(`This backup is from a newer version of Flight Log (v${version}). Update the app and try again.`);

  let rejected = 0;
  const candidates: ImportCandidate[] = [];
  (obj.flights as unknown[]).forEach((raw, i) => {
    const flight = sanitizeFlight(raw);
    if (!flight) {
      rejected++;
      return;
    }
    const issues: ImportIssue[] = [];
    for (const which of ['from', 'to'] as const) {
      if (!getAirport(flight[which])) issues.push({ level: 'warn', field: which, message: `Unknown ${which === 'from' ? 'origin' : 'destination'} airport “${flight[which]}”` });
    }
    const same = sameAirportIssue(flight);
    if (same) issues.push(same);
    candidates.push({ key: `row-${i + 1}`, rowNumber: i + 1, flight, issues, fromRaw: flight.from, toRaw: flight.to });
  });
  return {
    version,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : undefined,
    candidates,
    settings: sanitizeSettings(obj.settings),
    rejected,
  };
}

/** True if the text looks like JSON (used to route pasted/dropped content). */
export function looksLikeJson(text: string): boolean {
  return /^\s*[{[]/.test(text.replace(/^\uFEFF/, ''));
}
