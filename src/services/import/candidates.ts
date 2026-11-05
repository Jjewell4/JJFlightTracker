/**
 * Builds import candidates (validated, enriched flights + warnings) from sheet rows,
 * and re-validates a candidate after an inline fix.
 */
import { occasionFields, parseOccasions } from '@/lib/occasions';
import { getAirport, normalize, searchAircraftTypes } from '@/data/reference';
import { enrichFlight, normalizeFlightNumber } from '@/lib/flight-utils';
import { computeDuration, tzOffsetMinutes, zonedToUtc } from '@/lib/time';
import type { Flight, FlightInput, FlightSource } from '@/lib/types';
import {
  cellText,
  isBlank,
  MAX_IMPORT_DURATION_MIN,
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
import { headerKey, type ColumnMapping, type MappingField } from './mapping';
import { SPREADSHEET_VERSION_HEADER, SPREADSHEET_VERSION, unescapeSpreadsheetText } from './spreadsheet-columns';
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
  /** The duration came from the file's own duration column (not worked out from the times). */
  durationFromFile?: boolean;
}

const SAME_AIRPORT = 'Origin and destination are the same airport';

/** Warns about a flight that starts and ends at the same airport (usually a typo). */
export function sameAirportIssue(f: Pick<Flight, 'from' | 'to'>): ImportIssue | undefined {
  return f.from && f.from === f.to ? { level: 'warn', field: 'to', message: SAME_AIRPORT } : undefined;
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
  native?: boolean;
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
  if (opts.native) raw = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? unescapeSpreadsheetText(v) : v]));
  const issues: ImportIssue[] = [];
  const text = (field: MappingField) => opts.native && typeof raw[field] === 'string' ? raw[field] as string : cellText(raw[field]);
  const number = (field: MappingField, min = 0, max = Number.MAX_VALUE, integer = false) => {
    if (isBlank(raw[field])) return undefined;
    const value = typeof raw[field] === 'number' ? raw[field] : Number(cellText(raw[field]));
    if (Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) return value;
    issues.push({ level: 'warn', field: 'flight', message: `Ignored invalid ${field}: “${cellText(raw[field])}”` });
    return undefined;
  };
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
  let date = pd?.date ?? '';
  const precisionCell = cellText(raw.datePrecision);
  const precision = precisionCell === 'day' || precisionCell === 'month' || precisionCell === 'year' ? precisionCell : pd?.precision ?? 'day';
  if (precision === 'year' && date) date = `${date.slice(0, 4)}-01-01`;
  if (precision === 'month' && date) date = `${date.slice(0, 7)}-01`;
  if (precisionCell && !['day', 'month', 'year'].includes(precisionCell)) issues.push({ level: 'warn', field: 'date', message: `Unknown date precision “${precisionCell}” — inferred from date` });

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
  const same = from?.airport && to?.airport ? sameAirportIssue({ from: from.ident, to: to.ident }) : undefined;
  if (same) issues.push(same);

  // ---- times
  let dep = parseTimeOfDay(raw.depTime);
  let arr = parseTimeOfDay(raw.arrTime);
  let dur = !isBlank(raw.durationMin) ? number('durationMin') : parseDurationMinutes(raw.duration);
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
  if (dur !== undefined && dur <= 0 && isBlank(raw.durationMin)) dur = undefined;
  if (dur !== undefined && dur > MAX_IMPORT_DURATION_MIN && isBlank(raw.durationMin)) {
    issues.push({ level: 'warn', field: 'duration', message: `Ignored duration “${cellText(raw.duration)}” — longer than 24 hours` });
    dur = undefined;
  }

  // Flightradar24 writes 00:00:00 for "unknown" (both times, and often just the arrival).
  if (opts.source === 'fr24' && dep === 0 && arr === 0) {
    dep = undefined;
    arr = undefined;
  }
  const fromAirport = from?.airport ?? getAirport(from?.ident);
  const toAirport = to?.airport ?? getAirport(to?.ident);
  let arrDayOffset = number('arrDayOffset', -2, 3, true);
  let derivedArrival = false;
  // A lone 00:00 arrival is FR24's "unknown" when the row also has a duration (work the arrival
  // out from that instead); with no duration value at all it's a genuine midnight arrival.
  if (opts.source === 'fr24' && arr === 0 && dep !== undefined && dep !== 0 && !isBlank(raw.duration)) {
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
  const airlineRef = parseAirlineRef(raw.airline ?? raw.airlineName ?? raw.airlineIcao ?? raw.airlineIata);
  const airline = resolveAirline(airlineRef);
  const aircraftRef = parseAircraftRef(raw.aircraft ?? raw.aircraftType ?? raw.aircraftName);
  let aircraftType = text('aircraftType') || aircraftRef?.icao;
  const aircraftName = text('aircraftName') || aircraftRef?.name;
  if (!aircraftType && aircraftName) {
    const hit = searchAircraftTypes(aircraftName, 1)[0];
    if (hit && normalize(hit.name) === normalize(aircraftName)) aircraftType = hit.icao;
  }
  const registration = cellText(raw.registration).toUpperCase().replace(/\s+/g, '') || undefined;

  const flight: ImportFlight = {
    id: text('id') || undefined,
    date,
    datePrecision: precision,
    flightNumber,
    airlineIcao: text('airlineIcao') || airlineRef?.icao || airline?.icao,
    airlineIata: text('airlineIata') || airlineRef?.iata || airline?.iata || undefined,
    airlineName: text('airlineName') || airlineRef?.name || airline?.name,
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
    ...occasionFields(parseOccasions([cellText(raw.occasion), cellText(raw.occasion2)].filter(Boolean).join(', '))),
    note: text('note') || undefined,
    tripId: text('tripId') || undefined, tripName: text('tripName') || undefined,
    source: ['manual', 'lookup', 'screenshot', 'fr24', 'csv', 'backup'].includes(cellText(raw.source)) ? cellText(raw.source) as FlightSource : opts.source,
    createdAt: number('createdAt'), updatedAt: number('updatedAt'),
    distanceKm: number('distanceKm'),
  };

  let enriched = enrichFlight(flight) as ImportFlight;
  // The file's own duration is the source of truth when present.
  if (dur !== undefined) enriched = { ...enriched, durationMin: dur };
  if (flight.distanceKm !== undefined) enriched.distanceKm = flight.distanceKm;
  if (arrDayOffset !== undefined) enriched.arrDayOffset = arrDayOffset;
  if (derivedArrival) issues.push({ level: 'info', field: 'arrTime', message: 'Arrival time worked out from the duration' });

  return {
    key: `row-${rowNumber}`,
    rowNumber,
    flight: stripUndefined(enriched),
    issues,
    fromRaw: fromRef?.raw,
    toRaw: toRef?.raw,
    durationFromFile: dur !== undefined || undefined,
  };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** Builds candidates for every non-empty row of a sheet. */
export function candidatesFromSheet(sheet: Sheet, mapping: ColumnMapping, opts: BuildOptions): ImportCandidate[] {
  const out: ImportCandidate[] = [];
  const versionCol = sheet.headers.findIndex(h => headerKey(h) === headerKey(SPREADSHEET_VERSION_HEADER));
  const namedTrips = new Map<string, string>();
  const seenIds = new Set<string>();
  sheet.rows.forEach((row, i) => {
    if (row.every((c) => isBlank(c))) return;
    const native = versionCol >= 0 && (isBlank(row[versionCol]) || cellText(row[versionCol]) === SPREADSHEET_VERSION);
    const candidate = candidateFromFields(rawFieldsFromRow(row, mapping), i + 1, { ...opts, native });
    if (versionCol >= 0 && !native) candidate.issues.push({ level: 'error', field: 'flight', message: 'Unsupported spreadsheet version. Update the app or check the export version column.' });
    const f = candidate.flight;
    if (f.id && seenIds.has(f.id)) candidate.issues.push({ level: 'error', field: 'flight', message: 'Repeated Flight ID in this file. Remove the duplicate row or give the new flight a different ID.' });
    if (f.id) seenIds.add(f.id);
    // User-authored spreadsheets may name trips without supplying internal IDs.
    // Explicit IDs always win, keeping separate trips with the same title separate.
    if (!f.tripId && f.tripName) {
      let id = namedTrips.get(f.tripName);
      if (!id) { id = crypto.randomUUID(); namedTrips.set(f.tripName, id); }
      f.tripId = id;
    }
    out.push(candidate);
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
      // Month/year-only flights have no clock times, so nothing derived from them either.
      if (pd.precision !== 'day') {
        const hadTimes = !!(flight.depTime && flight.arrTime);
        flight = { ...flight, depTime: undefined, arrTime: undefined, arrDayOffset: undefined };
        if (hadTimes && !c.durationFromFile) flight.durationMin = undefined;
        issues = issues.filter((i) => i.field !== 'depTime' && i.field !== 'arrTime');
      }
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
  issues = issues.filter((i) => i.message !== SAME_AIRPORT);
  const same = getAirport(flight.from) && getAirport(flight.to) ? sameAirportIssue(flight) : undefined;
  if (same) issues.push(same);
  return { ...c, flight, issues, fromRaw, toRaw };
}
