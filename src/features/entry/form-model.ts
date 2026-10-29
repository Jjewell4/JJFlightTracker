/** Pure form logic for the flight entry screen (no React) — unit tested. */
import { getAircraftType, getAirport } from '@/data/reference';
import { normalizeFlightNumber, parseFlightNumber } from '@/lib/flight-utils';
import { computeDuration, isValidTime, todayLocal } from '@/lib/time';
import type { CabinClass, DatePrecision, Flight, FlightInput, FlightOccasion, FlightReason, SeatType } from '@/lib/types';
import type { AirlineInfo, FlightLookupResult } from '@/services/lookup';

/** Longest note kept (keeps every flight record small enough to sync). */
export const NOTE_MAX = 2000;

export interface FormValues {
  date: string;
  datePrecision: DatePrecision;
  flightNumber: string;
  airline?: AirlineInfo;
  from: string;
  to: string;
  depTime: string;
  arrTime: string;
  /** undefined = infer automatically from times + time zones. */
  arrDayOffset?: number;
  aircraftType: string;
  aircraftName: string;
  registration: string;
  seatNumber: string;
  seatType?: SeatType;
  cabinClass?: CabinClass;
  reason?: FlightReason;
  occasion?: FlightOccasion;
  note: string;
}

/** Field groups a lookup can fill. */
export type FillKey = 'airline' | 'from' | 'to' | 'times' | 'aircraft' | 'registration';
export const FILL_KEYS: FillKey[] = ['airline', 'from', 'to', 'times', 'aircraft', 'registration'];

export function emptyValues(defaults: Partial<FormValues> = {}): FormValues {
  return {
    date: todayLocal(),
    datePrecision: 'day',
    flightNumber: '',
    from: '',
    to: '',
    depTime: '',
    arrTime: '',
    aircraftType: '',
    aircraftName: '',
    registration: '',
    seatNumber: '',
    note: '',
    ...defaults,
  };
}

/** "UA123" → "UA 123" for display. */
export function prettyFlightNumber(raw: string | undefined): string {
  if (!raw) return '';
  const p = parseFlightNumber(raw);
  return p ? `${p.prefix} ${p.number}` : raw.toUpperCase();
}

/**
 * The stored day offset is loaded as "auto" whenever inference reproduces it, so editing the
 * times re-infers it instead of carrying a stale offset. Only offsets inference can't produce
 * (e.g. flights over 24h) stay explicit.
 */
function loadedDayOffset(f: Flight): number | undefined {
  if (f.arrDayOffset === undefined || !f.depTime || !f.arrTime) return undefined;
  const inferred = timing({ date: f.date, depTime: f.depTime, arrTime: f.arrTime, from: f.from, to: f.to });
  return inferred?.arrDayOffset === f.arrDayOffset ? undefined : f.arrDayOffset;
}

export function flightToValues(f: Flight): FormValues {
  const hasAirline = f.airlineIcao || f.airlineIata || f.airlineName;
  return {
    date: f.date,
    datePrecision: f.datePrecision ?? 'day',
    flightNumber: prettyFlightNumber(f.flightNumber),
    airline: hasAirline ? { icao: f.airlineIcao, iata: f.airlineIata, name: f.airlineName } : undefined,
    from: f.from ?? '',
    to: f.to ?? '',
    depTime: f.depTime ?? '',
    arrTime: f.arrTime ?? '',
    arrDayOffset: loadedDayOffset(f),
    aircraftType: f.aircraftType ?? '',
    aircraftName: f.aircraftName ?? getAircraftType(f.aircraftType)?.name ?? '',
    registration: f.registration ?? '',
    seatNumber: f.seatNumber ?? '',
    seatType: f.seatType,
    cabinClass: f.cabinClass,
    reason: f.reason,
    occasion: f.occasion,
    note: f.note ?? '',
  };
}

/** Prefill for "log the return flight": reversed route, same airline, fresh date/time. */
export function returnValues(f: Flight): FormValues {
  const v = flightToValues(f);
  return {
    ...emptyValues(),
    date: '',
    airline: v.airline,
    from: f.to,
    to: f.from,
    cabinClass: f.cabinClass,
    reason: f.reason,
    occasion: f.occasion,
  };
}

/** Prefill for "duplicate": same flight on another day (today), minus per-trip details. */
export function duplicateValues(f: Flight): FormValues {
  return { ...flightToValues(f), date: todayLocal(), datePrecision: 'day', registration: '', seatNumber: '', note: '', occasion: undefined };
}

const WIDEBODY = /^(A30|A31[0]|A33|A34|A35|A38|B74|B76|B77|B78|MD11|DC10|L101|IL96|IL86)/;

export function isWidebody(aircraftType: string | undefined): boolean {
  return !!aircraftType && WIDEBODY.test(aircraftType.toUpperCase());
}

/**
 * Seat position from a seat number like "12A". Narrowbodies: A/F window, B/E middle, C/D aisle.
 * Widebodies (2-4-2 / 3-3-3 / 3-4-3): A/K window, C/D/G/H aisle, others middle.
 */
export function inferSeatType(seat: string | undefined, aircraftType?: string): SeatType | undefined {
  const m = /^\s*\d{1,3}\s*([A-Za-z])\s*$/.exec(seat ?? '');
  if (!m) return undefined;
  const letter = m[1].toUpperCase();
  if (isWidebody(aircraftType)) {
    if (letter === 'A' || letter === 'K' || letter === 'L') return 'window';
    if ('CDGH'.includes(letter)) return 'aisle';
    return 'middle';
  }
  if (letter === 'A' || letter === 'F' || letter === 'K' || letter === 'L') return 'window';
  if ('CDGH'.includes(letter)) return 'aisle';
  return 'middle';
}

/** Current value for a fill group is empty. */
export function isEmptyField(v: FormValues, key: FillKey): boolean {
  switch (key) {
    case 'airline':
      return !v.airline?.icao && !v.airline?.iata && !v.airline?.name;
    case 'from':
      return !v.from;
    case 'to':
      return !v.to;
    case 'times':
      return !v.depTime && !v.arrTime;
    case 'aircraft':
      return !v.aircraftType && !v.aircraftName;
    case 'registration':
      return !v.registration;
  }
}

function resultHas(r: FlightLookupResult, key: FillKey): boolean {
  switch (key) {
    case 'airline':
      return !!(r.airline?.icao || r.airline?.iata || r.airline?.name);
    case 'from':
      return !!r.from;
    case 'to':
      return !!r.to;
    case 'times':
      return !!(r.depTime && r.arrTime);
    case 'aircraft':
      return !!(r.aircraftType || r.aircraftName);
    case 'registration':
      return !!r.registration;
  }
}

function sameValue(v: FormValues, r: FlightLookupResult, key: FillKey): boolean {
  switch (key) {
    case 'airline':
      return !!v.airline && (v.airline.icao ? v.airline.icao === r.airline?.icao : v.airline.name === r.airline?.name);
    case 'from':
      return getAirport(v.from)?.ident === getAirport(r.from)?.ident && !!v.from;
    case 'to':
      return getAirport(v.to)?.ident === getAirport(r.to)?.ident && !!v.to;
    case 'times':
      return v.depTime === r.depTime && v.arrTime === r.arrTime;
    case 'aircraft':
      return r.aircraftType ? v.aircraftType === r.aircraftType : v.aircraftName === r.aircraftName;
    case 'registration':
      return v.registration.toUpperCase() === r.registration?.toUpperCase();
  }
}

/**
 * Fills the form from a lookup result. A field group is written only when the result has a
 * value, the user has not edited that field, and it is empty or was itself filled by a lookup
 * (`replaceable`). Returns the groups that changed.
 */
export function applyLookup(
  v: FormValues,
  r: FlightLookupResult,
  opts: { edited: ReadonlySet<string>; replaceable?: ReadonlySet<FillKey> },
): { values: FormValues; filled: FillKey[] } {
  const out: FormValues = { ...v };
  const filled: FillKey[] = [];
  for (const key of FILL_KEYS) {
    if (!resultHas(r, key) || opts.edited.has(key)) continue;
    if (!isEmptyField(v, key) && !opts.replaceable?.has(key)) continue;
    if (sameValue(v, r, key)) continue;
    switch (key) {
      case 'airline':
        out.airline = { ...r.airline };
        break;
      case 'from':
        out.from = r.from!;
        break;
      case 'to':
        out.to = r.to!;
        break;
      case 'times':
        out.depTime = r.depTime!;
        out.arrTime = r.arrTime!;
        out.arrDayOffset = r.arrDayOffset;
        break;
      case 'aircraft':
        out.aircraftType = r.aircraftType ?? '';
        out.aircraftName = r.aircraftName ?? getAircraftType(r.aircraftType)?.name ?? '';
        break;
      case 'registration':
        out.registration = r.registration!;
        break;
    }
    filled.push(key);
  }
  if (out.from && out.from === out.to) return { values: v, filled: [] };
  return { values: out, filled };
}

/** Which groups a result would change (ignoring user-edited ones) — used to show "Apply". */
export function lookupDiff(v: FormValues, r: FlightLookupResult, edited: ReadonlySet<string>): FillKey[] {
  return FILL_KEYS.filter((k) => resultHas(r, k) && !edited.has(k) && !sameValue(v, r, k));
}

/** Clears the given groups (undo of an auto-fill). */
export function clearFields(v: FormValues, keys: Iterable<FillKey>): FormValues {
  const out = { ...v };
  for (const k of keys) {
    if (k === 'airline') out.airline = undefined;
    if (k === 'from') out.from = '';
    if (k === 'to') out.to = '';
    if (k === 'times') {
      out.depTime = '';
      out.arrTime = '';
      out.arrDayOffset = undefined;
    }
    if (k === 'aircraft') {
      out.aircraftType = '';
      out.aircraftName = '';
    }
    if (k === 'registration') out.registration = '';
  }
  return out;
}

export type FormErrors = Partial<Record<'date' | 'from' | 'to' | 'flightNumber' | 'times', string>>;

export function validate(v: FormValues): FormErrors {
  const e: FormErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) e.date = 'Pick the date you flew';
  else if (v.datePrecision === 'day' && v.date > addYearsToToday(1)) e.date = 'That date is more than a year away';
  if (!v.from) e.from = 'Where did you depart from?';
  if (!v.to) e.to = 'Where did you land?';
  if (v.from && v.to && (getAirport(v.from)?.ident ?? v.from) === (getAirport(v.to)?.ident ?? v.to)) e.to = 'Arrival must differ from departure';
  if (v.flightNumber.trim() && !parseFlightNumber(v.flightNumber) && !/^[A-Z0-9]{2,8}$/i.test(v.flightNumber.replace(/\s+/g, '')))
    e.flightNumber = 'Use a format like UA 123';
  if ((v.depTime && !isValidTime(v.depTime)) || (v.arrTime && !isValidTime(v.arrTime))) e.times = 'Use a valid time';
  else if (v.datePrecision === 'day' && v.depTime && v.arrTime && v.arrDayOffset !== undefined) {
    const d = timing(v);
    if (!d)
      e.times = timing({ ...v, arrDayOffset: v.arrDayOffset - 1 })
        ? 'That makes the flight too long — adjust the day'
        : 'Arrival is before departure — adjust the day';
  }
  return e;
}

function addYearsToToday(n: number): string {
  const t = todayLocal();
  return `${Number(t.slice(0, 4)) + n}${t.slice(4)}`;
}

/** Duration + effective day offset for the entered times. */
export function timing(v: Pick<FormValues, 'date' | 'depTime' | 'arrTime' | 'arrDayOffset' | 'from' | 'to'>) {
  return computeDuration({
    date: /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : todayLocal(),
    depTime: v.depTime,
    arrTime: v.arrTime,
    arrDayOffset: v.arrDayOffset,
    fromTz: getAirport(v.from)?.tz || undefined,
    toTz: getAirport(v.to)?.tz || undefined,
  });
}

/** Builds the repository input. `base` is the flight being edited (keeps fields the form doesn't show). */
export function valuesToInput(v: FormValues, opts: { source: FlightInput['source']; base?: Flight }): FlightInput {
  const { base } = opts;
  const routeUnchanged = base && base.from === v.from && base.to === v.to;
  const hasTimes = v.datePrecision === 'day' && isValidTime(v.depTime) && isValidTime(v.arrTime);
  const seat = v.seatNumber.trim().toUpperCase();
  const input: FlightInput = {
    date: v.date,
    datePrecision: v.datePrecision,
    flightNumber: normalizeFlightNumber(v.flightNumber),
    airlineIcao: v.airline?.icao || undefined,
    airlineIata: v.airline?.iata || undefined,
    airlineName: v.airline?.name || undefined,
    from: v.from,
    to: v.to,
    depTime: v.datePrecision === 'day' && isValidTime(v.depTime) ? v.depTime : undefined,
    arrTime: v.datePrecision === 'day' && isValidTime(v.arrTime) ? v.arrTime : undefined,
    arrDayOffset: hasTimes ? v.arrDayOffset : undefined,
    // Recomputed by enrichFlight from times; keep an imported duration only when nothing changed.
    durationMin: hasTimes ? undefined : base && routeUnchanged && !base.depTime ? base.durationMin : undefined,
    distanceKm: routeUnchanged ? base?.distanceKm : undefined,
    aircraftType: v.aircraftType || undefined,
    aircraftName: v.aircraftName.trim() || undefined,
    registration: v.registration.trim().toUpperCase() || undefined,
    seatNumber: seat || undefined,
    seatType: v.seatType,
    cabinClass: v.cabinClass,
    reason: v.reason,
    occasion: v.occasion,
    note: v.note.trim().slice(0, NOTE_MAX) || undefined,
    source: opts.source,
  };
  return input;
}

/** Group values equal between two form states (used to decide what visibly changed). */
export function groupEquals(a: FormValues, b: FormValues, key: FillKey): boolean {
  switch (key) {
    case 'airline':
      return (a.airline?.icao ?? '') === (b.airline?.icao ?? '') && (a.airline?.name ?? '') === (b.airline?.name ?? '');
    case 'from':
      return a.from === b.from;
    case 'to':
      return a.to === b.to;
    case 'times':
      return a.depTime === b.depTime && a.arrTime === b.arrTime && a.arrDayOffset === b.arrDayOffset;
    case 'aircraft':
      return a.aircraftType === b.aircraftType && a.aircraftName === b.aircraftName;
    case 'registration':
      return a.registration === b.registration;
  }
}

/** Same form contents (key order and explicit-undefined keys don't matter). Drives the unsaved-changes guard. */
export function formEquals(a: FormValues, b: FormValues): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof FormValues)[]);
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}

/** Groups with a user-supplied value (used to protect prefilled/edited flights from lookups). */
export function nonEmptyGroups(v: FormValues): FillKey[] {
  return FILL_KEYS.filter((k) => !isEmptyField(v, k));
}
