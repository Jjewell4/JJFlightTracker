/**
 * Travel calendar model: one strip per year, with time away from home (trips) as spans and
 * the days you flew as ticks. Pure and unit tested; rendered by TravelCalendar.tsx.
 *
 * Flights are sparse — a few dozen days a year — so the calendar is built around trips
 * (from detectTrips / awaySpans) rather than a daily grid. Only day-precision flights count.
 */
import { awaySpans, detectTrips, type Trip } from '@/lib/trips';
import type { YearScope } from '@/lib/stats';
import type { Flight } from '@/lib/types';
import { plural } from './format';

export interface CalendarSpan {
  /** Unique within the year. */
  key: string;
  trip: Trip;
  /** Day-of-year indices (0 = Jan 1), inclusive, clipped to the year. */
  start: number;
  end: number;
  /** The trip began the year before / continues into the next year. */
  fromPrev: boolean;
  intoNext: boolean;
}

export interface CalendarDay {
  /** Day-of-year index. */
  day: number;
  date: string;
  flights: Flight[];
  /** Inside a trip span (the span is what you tap). */
  inTrip: boolean;
}

/** Something you can tap or focus on a strip, chronological. */
export type CalendarItem = { kind: 'trip'; start: number; end: number; span: CalendarSpan } | { kind: 'day'; start: number; end: number; day: CalendarDay };

export interface CalendarYear {
  year: number;
  /** 365 or 366. */
  days: number;
  spans: CalendarSpan[];
  flightDays: CalendarDay[];
  items: CalendarItem[];
  flights: number;
  /** Calendar days covered by trips (overlaps counted once). */
  daysAway: number;
  /** Trips overlapping this year. */
  trips: number;
  /** Day index of today when this is the current year. */
  today?: number;
}

export interface TravelCalendarModel {
  /** Newest first. */
  years: CalendarYear[];
  daysAway: number;
  trips: number;
  longest?: { trip: Trip; days: number };
  /** Flights in scope without an exact date (not on the calendar). */
  undated: number;
  firstYear?: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const utcDay = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};
export const daysInYear = (year: number) => (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365);
/** 0-based day of the year. */
export const dayOfYear = (date: string) => utcDay(date) - Date.UTC(Number(date.slice(0, 4)), 0, 1) / DAY_MS;
/** Inclusive length of a trip in calendar days (a day trip is 1). */
export const tripDays = (t: Pick<Trip, 'start' | 'end'>) => Math.max(1, utcDay(t.end) - utcDay(t.start) + 1);
/** Date of a day index, YYYY-MM-DD. */
export const dateOfDay = (year: number, day: number) => new Date(Date.UTC(year, 0, 1 + day)).toISOString().slice(0, 10);

/** Day index where each month starts (12 entries). */
export function monthStarts(year: number): number[] {
  return Array.from({ length: 12 }, (_, m) => (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / DAY_MS);
}

export function buildTravelCalendar(flights: Flight[], scope: YearScope, opts: { today?: string; trips?: Trip[] } = {}): TravelCalendarModel {
  const dated = flights.filter((f) => (f.datePrecision ?? 'day') === 'day' && DATE_RE.test(f.date));
  const trips = opts.trips ?? detectTrips(dated);
  const byId = new Map(trips.map((t) => [t.id, t]));
  const spans = awaySpans(trips).filter((s) => byId.has(s.tripId) && s.end >= s.start);
  const inScope = (y: number) => scope === 'all' || y === scope;

  const flightsByYear = new Map<number, Flight[]>();
  for (const f of dated) {
    const y = Number(f.date.slice(0, 4));
    if (!inScope(y)) continue;
    const list = flightsByYear.get(y);
    if (list) list.push(f);
    else flightsByYear.set(y, [f]);
  }
  const undated = flights.filter((f) => (f.datePrecision ?? 'day') !== 'day' && inScope(Number(f.date.slice(0, 4)))).length;
  const today = opts.today && DATE_RE.test(opts.today) ? opts.today : undefined;

  const years: CalendarYear[] = [...flightsByYear.keys()]
    .sort((a, b) => b - a)
    .map((year) => {
      const days = daysInYear(year);
      const first = `${year}-01-01`;
      const last = `${year}-12-31`;
      const ySpans: CalendarSpan[] = [];
      const away = new Uint8Array(days);
      for (const s of spans) {
        if (s.end < first || s.start > last) continue;
        const start = s.start < first ? 0 : dayOfYear(s.start);
        const end = s.end > last ? days - 1 : dayOfYear(s.end);
        away.fill(1, start, end + 1);
        ySpans.push({ key: `${s.tripId}:${year}`, trip: byId.get(s.tripId)!, start, end, fromPrev: s.start < first, intoNext: s.end > last });
      }
      const byDay = new Map<number, Flight[]>();
      for (const f of flightsByYear.get(year) ?? []) {
        const d = dayOfYear(f.date);
        const list = byDay.get(d);
        if (list) list.push(f);
        else byDay.set(d, [f]);
      }
      const flightDays: CalendarDay[] = [...byDay.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([day, fs]) => ({
          day,
          date: dateOfDay(year, day),
          flights: fs.sort((a, b) => (a.depTime ?? '').localeCompare(b.depTime ?? '') || a.createdAt - b.createdAt),
          inTrip: away[day] === 1,
        }));
      const items: CalendarItem[] = [
        ...ySpans.map((span) => ({ kind: 'trip' as const, start: span.start, end: span.end, span })),
        ...flightDays.filter((d) => !d.inTrip).map((day) => ({ kind: 'day' as const, start: day.day, end: day.day, day })),
      ].sort((a, b) => a.start - b.start || a.end - b.end);
      return {
        year,
        days,
        spans: ySpans,
        flightDays,
        items,
        flights: flightsByYear.get(year)?.length ?? 0,
        daysAway: away.reduce((n, v) => n + v, 0),
        trips: ySpans.length,
        today: today && Number(today.slice(0, 4)) === year ? dayOfYear(today) : undefined,
      };
    });

  // Trips touching the scope (a New Year trip counts once).
  const scoped = new Map<string, Trip>();
  for (const y of years) for (const s of y.spans) scoped.set(s.trip.id, s.trip);
  let longest: TravelCalendarModel['longest'];
  for (const trip of scoped.values()) {
    const days = tripDays(trip);
    if (!longest || days > longest.days || (days === longest.days && trip.start > longest.trip.start)) longest = { trip, days };
  }
  return {
    years,
    daysAway: years.reduce((n, y) => n + y.daysAway, 0),
    trips: scoped.size,
    longest,
    undated,
    firstYear: years.length ? years[years.length - 1].year : undefined,
  };
}

/**
 * The item under a pointer at fractional day position `pos` (0 … days): the closest item
 * within `tol` days, preferring the shortest one that contains the position. -1 when none.
 */
export function pickItem(items: CalendarItem[], pos: number, tol: number): number {
  let best = -1;
  let bestDist = Infinity;
  let bestLen = Infinity;
  items.forEach((it, i) => {
    const lo = it.start;
    const hi = it.end + 1;
    const dist = pos < lo ? lo - pos : pos > hi ? pos - hi : 0;
    const len = hi - lo;
    if (dist > tol) return;
    if (dist < bestDist || (dist === bestDist && len < bestLen)) {
      best = i;
      bestDist = dist;
      bestLen = len;
    }
  });
  return best;
}

/** "31 days away · 18 flights" (or just the flights when there were no trips). */
export function yearSummary(y: Pick<CalendarYear, 'daysAway' | 'flights'>): string {
  const flights = `${y.flights} ${plural(y.flights, 'flight')}`;
  return y.daysAway ? `${y.daysAway} ${plural(y.daysAway, 'day')} away · ${flights}` : flights;
}

/** Accessible name of a year strip. */
export function yearLabel(y: CalendarYear): string {
  const trips = y.trips ? `${y.daysAway} ${plural(y.daysAway, 'day')} away on ${y.trips} ${plural(y.trips, 'trip')}` : 'No trips';
  return `${y.year}${y.today !== undefined ? ' so far' : ''}: ${trips}, ${y.flights} ${plural(y.flights, 'flight')}`;
}
