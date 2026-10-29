/**
 * Duplicate detection for the flight form (pure, unit tested).
 *
 * A flight being logged is a likely **duplicate** of one already in the log when it is on the
 * same day and either flies the same route or has the same flight number (UA123 ≡ UAL123).
 * It is merely **similar** (a softer hint) when the same route or flight number sits one day
 * either side — the usual time-zone date slip or a red-eye logged on its arrival day.
 *
 * Legitimate repeats are left alone: a same-day round trip is two different routes, the same
 * route twice in one day with departures more than two hours apart is two flights, and one
 * flight number on chained legs (SAN→PHX, PHX→DEN as WN 123) is a through flight.
 */
import { getAirport } from '@/data/reference';
import { formatFlightDate } from '@/lib/time';
import { flightNumberKey } from '@/services/lookup/flight-number';
import type { DatePrecision, Flight } from '@/lib/types';

export interface DuplicateQuery {
  date: string;
  datePrecision: DatePrecision;
  from?: string;
  to?: string;
  flightNumber?: string;
  depTime?: string;
}

export type DuplicateKind = 'duplicate' | 'similar';

export interface DuplicateMatch {
  flight: Flight;
  kind: DuplicateKind;
  /** What lines up: the route (from → to) or the flight number. */
  by: 'route' | 'flightNumber';
  /** Existing flight's date minus the query's, in days (0 = same day). */
  dayOffset: number;
}

/** Departures further apart than this on the same day are different flights. */
const SAME_FLIGHT_MAX_MIN = 120;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const airportKey = (ident: string | undefined) => (ident ? (getAirport(ident)?.ident ?? ident.trim().toUpperCase()) : '');

function minutes(t: string | undefined): number | undefined {
  const m = TIME_RE.exec(t ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Existing flights that the values in the form may duplicate, most certain first
 * (duplicates before similar flights, then same day before ±1 day).
 */
export function findDuplicates(q: DuplicateQuery, flights: readonly Flight[] | undefined, opts: { excludeId?: string } = {}): DuplicateMatch[] {
  if (!flights?.length || !DATE_RE.test(q.date)) return [];
  const from = airportKey(q.from);
  const to = airportKey(q.to);
  const fn = flightNumberKey(q.flightNumber);
  if (!fn && !(from && to)) return [];
  const qDay = q.datePrecision === 'day';
  const qDayNum = qDay ? dayNumber(q.date) : 0;
  const qMin = minutes(q.depTime);

  const out: DuplicateMatch[] = [];
  for (const f of flights) {
    if (f.id === opts.excludeId || !DATE_RE.test(f.date)) continue;
    const fDay = (f.datePrecision ?? 'day') === 'day';
    let dayOffset: number;
    if (qDay && fDay) {
      dayOffset = dayNumber(f.date) - qDayNum;
      if (Math.abs(dayOffset) > 1) continue;
    } else {
      // Month/year precision: only the same month (or year) at the same precision compares.
      if (q.datePrecision !== (f.datePrecision ?? 'day') || q.date !== f.date) continue;
      dayOffset = 0;
    }

    const fFrom = airportKey(f.from);
    const fTo = airportKey(f.to);
    const sameRoute = !!from && !!to && from === fFrom && to === fTo;
    const fFn = flightNumberKey(f.flightNumber);
    const sameFn = !!fn && fn === fFn;
    const differentFn = !!fn && !!fFn && fn !== fFn;
    if (!sameRoute && !sameFn) continue;
    // Every airport the form has so far agrees with the existing flight.
    const routeAgrees = (!from || from === fFrom) && (!to || to === fTo);
    // The same number on consecutive legs (A→B, B→C) is a through flight, not a repeat.
    const chained = !!from && !!to && !sameRoute && (fTo === from || fFrom === to);

    let kind: DuplicateKind | undefined;
    if (qDay && fDay && dayOffset === 0) {
      const fMin = minutes(f.depTime);
      if (qMin !== undefined && fMin !== undefined && Math.abs(qMin - fMin) > SAME_FLIGHT_MAX_MIN) continue;
      if (sameFn) kind = routeAgrees ? 'duplicate' : chained ? undefined : 'similar';
      // Same route under two different numbers: a codeshare, or two flights close together.
      else kind = differentFn ? 'similar' : 'duplicate';
    } else if (dayOffset !== 0) {
      if (sameRoute ? !differentFn : sameFn && routeAgrees) kind = 'similar';
    } else {
      // Same month or year: only the full match (route and number) is a likely duplicate.
      kind = sameRoute && sameFn ? 'duplicate' : (sameRoute && !differentFn) || (sameFn && routeAgrees) ? 'similar' : undefined;
    }
    if (kind) out.push({ flight: f, kind, by: sameRoute ? 'route' : 'flightNumber', dayOffset });
  }
  const rank = (m: DuplicateMatch) => (m.kind === 'duplicate' ? 0 : 2) + (m.dayOffset === 0 ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.by === 'route' ? 0 : 1) - (b.by === 'route' ? 0 : 1) || a.dayOffset - b.dayOffset || b.flight.updatedAt - a.flight.updatedAt);
}

/** "Oct 29" this year, "Oct 29, 2019" otherwise; "Oct 2019" / "2019" for coarser dates. */
export function duplicateDate(f: Pick<Flight, 'date' | 'datePrecision'>, currentYear = new Date().getFullYear()): string {
  const precision = f.datePrecision ?? 'day';
  if (precision !== 'day') return formatFlightDate(f.date, precision);
  const [y, m, d] = f.date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: y === currentYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}
