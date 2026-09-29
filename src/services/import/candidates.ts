/**
 * Builds import candidates (validated, enriched flights + warnings) from sheet rows,
 * and re-validates a candidate after an inline fix.
 */
import { getAirport, normalize, searchAircraftTypes } from '@/data/reference';
import { enrichFlight, normalizeFlightNumber } from '@/lib/flight-utils';
import { computeDuration, tzOffsetMinutes, zonedToUtc } from '@/lib/time';
import type { Flight, FlightInput, FlightSource } from '@/lib/types';
import {
  cellText,
  isBlank,
  minutesToHHmm,
  parseCabinClass,
  parseDateValue,
  parseDurationMinutes,
  parseFlightReason,
  parseSeatType,
  parseTimeOfDay,
  type Cell,
  type DateOrder,
} from './cells';
import type { ColumnMapping, MappingField } from './mapping';
import { parseAircraftRef, parseAirlineRef, parseAirportRef, resolveAirline, resolveAirport } from './refs';
import type { Sheet } from './sheet';

export type IssueField = 'date' | 'from' | 'to' | 'depTime' | 'arrTime' | 'duration' | 'flight';
export type IssueLevel = 'error' | 'warn' | 'info';

export interface ImportIssue {
  level: IssueLevel;
  field: IssueField;
  message: string;
}

/** A flight as read from a file; may carry id/createdAt when restoring a backup. */
export type ImportFlight = FlightInput & Partial<Pick<Flight, 'createdAt' | 'updatedAt'>>;

export interface ImportCandidate {
  /** Unique within one import batch. */
  key: string;
  /** 1-based row number in the source data (excluding the header). */
  rowNumber: number;
  flight: ImportFlight;
  issues: ImportIssue[];
  /** Original airport text, shown when the code could not be resolved. */
  fromRaw?: string;
  toRaw?: string;
}

export type CandidateStatus = 'ok' | 'warning' | 'error';

export function candidateStatus(c: ImportCandidate): CandidateStatus {
  if (c.issues.some((i) => i.level === 'error')) return 'error';
  if (c.issues.some((i) => i.level === 'warn')) return 'warning';
  return 'ok';
}

export interface BuildOptions {
  source: FlightSource;
  dateOrder?: DateOrder;
}

type RawFields = Partial<Record<MappingField, Cell>>;

/** Extracts the mapped cells of one row. */
export function rawFieldsFromRow(row: Cell[], mapping: ColumnMapping): RawFields {
  const out: RawFields = {};
  for (const [field, idx] of Object.entries(mapping) as [MappingField, number | undefined][]) {
    if (idx !== undefined && idx >= 0) out[field] = row[idx];
  }
  return out;
}

const SEP_ROUTE = /\s*(?:->|→|➔|>|–|—|-|\bto\b|\/)\s*/i;

function splitRoute(v: Cell): [string, string] | undefined {
  const s = cellText(v);
  if (!s) return undefined;
  const parts = s.split(SEP_ROUTE).filter(Boolean);
  return parts.length >= 2 ? [parts[0], parts[parts.length - 1]] : undefined;
}

function addMinutes(date: string, dep: number, add: number, fromTz?: string, toTz?: string) {
  const depUtc = zonedToUtc(date, minutesToHHmm(dep), fromTz);
  const arrUtc = depUtc + add * 60000;
  const off = toTz ? tzOffsetMinutes(toTz, new Date(arrUtc)) : fromTz ? tzOffsetMinutes(fromTz, new Date(depUtc)) : 0;
  const local = new Date(arrUtc + off * 60000);
  const arrDate = local.toISOString().slice(0, 10);
  const days = Math.round((Date.parse(`${arrDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return { arrTime: minutesToHHmm(local.getUTCHours() * 60 + local.getUTCMinutes()), arrDayOffset: days };
}

/** Builds a candidate from raw field cells. */
export function candidateFromFields(raw: RawFields, rowNumber: number, opts: BuildOptions): ImportCandidate {
  const issues: ImportIssue[] = [];
  const dateOrder = opts.dateOrder ?? 'mdy';

  // ---- date
  const pd = parseDateValue(raw.date, dateOrder);
  if (!pd) {
    issues.push({
      level: 'error',
      field: 'date',
      message: isBlank(raw.date) ? 'Missing date' : `Can't read the date “${cellText(raw.date)}”`,
    });
  } else if (pd.note) {
    issues.push({ level: 'info', field: 'date', message: pd.note });
  }
  const date = pd?.date ?? '';
  const precision = pd?.precision ?? 'day';

  // ---- airports
  let fromCell = raw.from;
  let toCell = raw.to;
  if (isBlank(fromCell) && isBlank(toCell) && raw.route !== undefined) {
    const r = splitRoute(raw.route);
    if (r) [fromCell, toCell] = r;
  }
  const fromRef = parseAirportRef(fromCell);
  const toRef = parseAirportRef(toCell);
  const from = resolveAirport(fromRef);
  const to = resolveAirport(toRef);
  const airportIssue = (which: 'from' | 'to', r: ReturnType<typeof resolveAirport>, ref: ReturnType<typeof parseAirportRef>) => {
    const label = which === 'from' ? 'origin' : 'destination';
    if (!ref || !r) issues.push({ level: 'error', field: which, message: `Missing ${label} airport` });
    else if (!r.airport) issues.push({ level: 'warn', field: which, message: `Unknown ${label} airport “${ref.icao ?? ref.iata ?? ref.raw}”` });
    else if (r.guessed) issues.push({ level: 'warn', field: which, message: `Guessed ${label} from “${ref.raw}” — check it` });
  };
  airportIssue('from', from, fromRef);
  airportIssue('to', to, toRef);

  // ---- times
  let dep = parseTimeOfDay(raw.depTime);
  let arr = parseTimeOfDay(raw.arrTime);
  let dur = parseDurationMinutes(raw.duration);
  if (pd?.minutes !== undefined && dep === undefined) dep = pd.minutes;
  if (dep === null) {
    issues.push({ level: 'warn', field: 'depTime', message: `Can't read departure time “${cellText(raw.depTime)}”` });
    dep = undefined;
  }
  if (arr === null) {
    issues.push({ level: 'warn', field: 'arrTime', message: `Can't read arrival time “${cellText(raw.arrTime)}”` });
    arr = undefined;
  }
  if (dur === null) {
    issues.push({ level: 'warn', field: 'duration', message: `Can't read duration “${cellText(raw.duration)}”` });
    dur = undefined;
  }
  if (dur !== undefined && dur <= 0) dur = undefined;

  // Flightradar24 writes 00:00:00 for "unknown" (both times, and often just the arrival).
  if (dep === 0 && arr === 0) {
    dep = undefined;
    arr = undefined;
  }
  const fromAirport = from?.airport ?? getAirport(from?.ident);
  const toAirport = to?.airport ?? getAirport(to?.ident);
  let arrDayOffset: number | undefined;
  let derivedArrival = false;
  if (arr === 0 && dep !== undefined && dep !== 0) {
    arr = undefined;
    if (dur !== undefined && pd && precision === 'day') {
      const d = addMinutes(date, dep, dur, fromAirport?.tz, toAirport?.tz);
      arr = Number(d.arrTime.slice(0, 2)) * 60 + Number(d.arrTime.slice(3));
      arrDayOffset = d.arrDayOffset;
      derivedArrival = true;
    }
  }
  // Overnight: choose the day offset whose computed duration best matches the stated one.
  if (arrDayOffset === undefined && dep !== undefined && arr !== undefined && dur !== undefined && pd && precision === 'day') {
    let best: { off: number; diff: number } | undefined;
    for (const off of [0, 1, -1, 2]) {
      const c = computeDuration({
        date,
        depTime: minutesToHHmm(dep),
        arrTime: minutesToHHmm(arr),
        arrDayOffset: off,
        fromTz: fromAirport?.tz,
        toTz: toAirport?.tz,
      });
      if (c && (!best || Math.abs(c.durationMin - dur) < best.diff)) best = { off, diff: Math.abs(c.durationMin - dur) };
    }
    if (best) arrDayOffset = best.off;
  }

  // ---- flight number, airline, aircraft
  const flightNumber = normalizeFlightNumber(cellText(raw.flightNumber) || undefined);
  const airlineRef = parseAirlineRef(raw.airline);
  const airline = resolveAirline(airlineRef);
  const aircraftRef = parseAircraftRef(raw.aircraft);
  let aircraftType = aircraftRef?.icao;
  const aircraftName = aircraftRef?.name;
  if (!aircraftType && aircraftName) {
    const hit = searchAircraftTypes(aircraftName, 1)[0];
    if (hit && normalize(hit.name) === normalize(aircraftName)) aircraftType = hit.icao;
  }
  const registration = cellText(raw.registration).toUpperCase().replace(/\s+/g, '') || undefined;

  const flight: ImportFlight = {
    date,
    datePrecision: precision,
    flightNumber,
    airlineIcao: airlineRef?.icao ?? airline?.icao,
    airlineIata: airlineRef?.iata ?? (airline?.iata || undefined),
    airlineName: airlineRef?.name ?? airline?.name,
    from: from?.ident ?? '',
    to: to?.ident ?? '',
    depTime: dep !== undefined ? minutesToHHmm(dep) : undefined,
    arrTime: arr !== undefined ? minutesToHHmm(arr) : undefined,
    arrDayOffset,
    durationMin: dur,
    aircraftType,
    aircraftName,
    registration,
    seatNumber: cellText(raw.seatNumber).toUpperCase() || undefined,
    seatType: parseSeatType(raw.seatType),
    cabinClass: parseCabinClass(raw.cabinClass),
    reason: parseFlightReason(raw.reason),
    note: cellText(raw.note) || undefined,
    source: opts.source,
  };

  let enriched = enrichFlight(flight) as ImportFlight;
  // The file's own duration is the source of truth when present.
  if (dur !== undefined) enriched = { ...enriched, durationMin: dur };
  if (derivedArrival) issues.push({ level: 'info', field: 'arrTime', message: 'Arrival time worked out from the duration' });

  return {
    key: `row-${rowNumber}`,
    rowNumber,
    flight: stripUndefined(enriched),
    issues,
    fromRaw: fromRef?.raw,
    toRaw: toRef?.raw,
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** Builds candidates for every non-empty row of a sheet. */
export function candidatesFromSheet(sheet: Sheet, mapping: ColumnMapping, opts: BuildOptions): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  sheet.rows.forEach((row, i) => {
    if (row.every((c) => isBlank(c))) return;
    out.push(candidateFromFields(rawFieldsFromRow(row, mapping), i + 1, opts));
  });
  return out;
}

export interface CandidateFix {
  /** Any of: a date text (YYYY-MM-DD, YYYY-MM, YYYY, …), airport codes/names. */
  date?: string;
  from?: string;
  to?: string;
}

/** Applies an inline fix (date and/or airports) and re-validates just those fields. */
export function fixCandidate(c: ImportCandidate, fix: CandidateFix, dateOrder: DateOrder = 'mdy'): ImportCandidate {
  let flight: ImportFlight = { ...c.flight };
  let issues = [...c.issues];
  const drop = (f: IssueField) => (issues = issues.filter((i) => i.field !== f));
  let fromRaw = c.fromRaw;
  let toRaw = c.toRaw;

  if (fix.date !== undefined) {
    drop('date');
    const pd = parseDateValue(fix.date, dateOrder);
    if (pd) {
      flight = { ...flight, date: pd.date, datePrecision: pd.precision };
    } else {
      issues.push({ level: 'error', field: 'date', message: fix.date.trim() ? `Can't read the date “${fix.date}”` : 'Missing date' });
      flight = { ...flight, date: '' };
    }
  }
  for (const which of ['from', 'to'] as const) {
    const text = fix[which];
    if (text === undefined) continue;
    drop(which);
    const ref = parseAirportRef(text);
    const r = resolveAirport(ref);
    const label = which === 'from' ? 'origin' : 'destination';
    if (!ref || !r) {
      issues.push({ level: 'error', field: which, message: `Missing ${label} airport` });
      flight = { ...flight, [which]: '' };
    } else {
      flight = { ...flight, [which]: r.ident };
      if (!r.airport) issues.push({ level: 'warn', field: which, message: `Unknown ${label} airport “${ref.icao ?? ref.iata ?? ref.raw}”` });
      else if (r.guessed) issues.push({ level: 'warn', field: which, message: `Guessed ${label} from “${ref.raw}” — check it` });
    }
    if (which === 'from') fromRaw = text;
    else toRaw = text;
  }
  // Re-derive distance/duration with the new airports/date.
  const { distanceKm: _old, ...rest } = flight;
  void _old;
  flight = stripUndefined(enrichFlight(rest as ImportFlight)) as ImportFlight;
  return { ...c, flight, issues, fromRaw, toRaw };
}
