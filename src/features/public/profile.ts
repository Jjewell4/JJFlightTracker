import type { Flight, Settings } from '@/lib/types';
import type { FlightFields } from '@/lib/flight-source';
import { todayLocal } from '@/lib/time';
export const RESERVED_HANDLES = new Set([
  'account',
  'settings',
  'flights',
  'stats',
  'map',
  'import',
  'welcome',
  'password',
  'assets',
  'data',
  'icons',
  'api',
  'admin',
  'public',
  'www',
]);
export function normalizeHandle(value: string) {
  return value.trim().toLowerCase();
}
export function validHandle(value: string) {
  return (
    /^[a-z][a-z0-9-]{2,29}$/.test(value) &&
    !value.endsWith('-') &&
    !RESERVED_HANDLES.has(value)
  );
}
export function publicHandleFromPath(path: string): string | null {
  const match = /^\/([a-z][a-z0-9-]{2,29})\/?$/.exec(path);
  return match && validHandle(match[1]) ? match[1] : null;
}
export type PublicFlight = Pick<
  Flight,
  | 'date'
  | 'datePrecision'
  | 'from'
  | 'to'
  | 'airlineIcao'
  | 'airlineIata'
  | 'aircraftType'
  | 'tripId'
  | 'tripName'
  // Optional categories, only when the owner shares them (see PublicShare).
  | 'depTime'
  | 'arrTime'
  | 'arrDayOffset'
  | 'durationMin'
  | 'cabinClass'
  | 'seatNumber'
  | 'seatType'
  | 'reason'
  | 'flightNumber'
  | 'registration'
>;

/**
 * Optional categories an owner can add to their public journal (public_profiles.share).
 * Everything is private unless switched on. Notes, airline/aircraft free-text names,
 * ids and anything not listed here are never shared.
 */
export const SHARE_KEYS = ['times', 'cabin', 'seat', 'reason', 'flightNumber', 'registration'] as const;
export type ShareKey = (typeof SHARE_KEYS)[number];
export type PublicShare = Partial<Record<ShareKey, boolean>>;

/** Keeps only known keys set to true (the shape the database accepts). */
export function normalizeShare(share: unknown): PublicShare {
  const out: PublicShare = {};
  if (share && typeof share === 'object')
    for (const k of SHARE_KEYS) if ((share as Record<string, unknown>)[k] === true) out[k] = true;
  return out;
}

export interface PublicProfile {
  slug: string;
  display_name: string;
  flights: PublicFlight[];
  published_at: string;
  exact_dates?: boolean;
  /** Owner's settings only; visitors infer what's shared from the flights themselves. */
  share?: PublicShare | null;
}

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CABINS = ['economy', 'premium', 'business', 'first', 'private'];
const SEAT_TYPES = ['window', 'middle', 'aisle'];
const REASONS = ['leisure', 'business', 'crew', 'other'];
const str = (v: unknown): v is string => typeof v === 'string';
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * What a visitor receives for one flight. Mirrors `project_public_flight` in
 * supabase/public-profiles.sql exactly, so the owner's preview shows the real journal.
 */
function projectFlight(f: Flight, exactDates: boolean, share: PublicShare): PublicFlight {
  const out: PublicFlight = {
    date:
      f.datePrecision === 'year'
        ? `${f.date.slice(0, 4)}-01-01`
        : exactDates
          ? f.date
          : `${f.date.slice(0, 7)}-01`,
    datePrecision:
      f.datePrecision === 'year'
        ? 'year'
        : exactDates
          ? f.datePrecision
          : 'month',
    from: f.from,
    to: f.to,
    ...(f.airlineIcao ? { airlineIcao: f.airlineIcao } : {}),
    ...(f.airlineIata ? { airlineIata: f.airlineIata } : {}),
    ...(f.aircraftType ? { aircraftType: f.aircraftType } : {}),
    ...(f.tripId ? { tripId: f.tripId } : {}),
    ...(f.tripId && f.tripName?.trim() ? { tripName: f.tripName.trim().slice(0, 80) } : {}),
  };
  if (share.times) {
    if (str(f.depTime) && HHMM.test(f.depTime)) out.depTime = f.depTime;
    if (str(f.arrTime) && HHMM.test(f.arrTime)) out.arrTime = f.arrTime;
    if (num(f.arrDayOffset) && [-1, 0, 1, 2].includes(f.arrDayOffset)) out.arrDayOffset = f.arrDayOffset;
    if (num(f.durationMin) && f.durationMin >= 1 && f.durationMin <= 1500) out.durationMin = Math.round(f.durationMin);
  }
  if (share.cabin && str(f.cabinClass) && CABINS.includes(f.cabinClass)) out.cabinClass = f.cabinClass;
  if (share.seat) {
    if (str(f.seatType) && SEAT_TYPES.includes(f.seatType)) out.seatType = f.seatType;
    if (str(f.seatNumber) && /^[0-9]{1,3}[A-Z]$/.test(f.seatNumber.toUpperCase())) out.seatNumber = f.seatNumber.toUpperCase();
  }
  if (share.reason && str(f.reason) && REASONS.includes(f.reason)) out.reason = f.reason;
  if (share.flightNumber && str(f.flightNumber) && /^[A-Z0-9]{2,10}$/.test(f.flightNumber.toUpperCase()))
    out.flightNumber = f.flightNumber.toUpperCase();
  if (share.registration && str(f.registration) && /^[A-Z0-9-]{2,10}$/.test(f.registration.toUpperCase()))
    out.registration = f.registration.toUpperCase();
  return out;
}

export function publicFlights(
  flights: Flight[],
  exactDates: boolean,
  today = todayLocal(),
  share: PublicShare = {},
): PublicFlight[] {
  return flights
    .filter((f) => {
      if (f.datePrecision === 'year')
        return f.date.slice(0, 4) < today.slice(0, 4);
      if (f.datePrecision === 'month')
        return f.date.slice(0, 7) < today.slice(0, 7);
      return f.date < today;
    })
    .map((f) => projectFlight(f, exactDates, share));
}
/**
 * Public flights arrive newest first in the owner's real order (the server sorts by date and the
 * private times). Keeping that order in createdAt keeps same-day/-month legs in sequence.
 */
export function asFlights(flights: PublicFlight[]): Flight[] {
  return flights.map((f, i) => ({
    ...f,
    id: `public-${i}`,
    source: 'manual',
    createdAt: flights.length - i,
    updatedAt: 0,
  }));
}
export function profileUrl(slug: string) {
  return `${window.location.origin}/${slug}`;
}

/**
 * Fields a public journal contains. The projection (here and in
 * supabase/public-profiles.sql) only includes optional categories the owner switched on,
 * so a field counts as shared when any flight carries it. Sections without data stay
 * hidden for visitors instead of showing empty charts.
 */
export function publicFields(flights: Partial<PublicFlight>[]): FlightFields {
  const any = (pick: (f: Partial<PublicFlight>) => unknown) => flights.some((f) => pick(f) != null);
  return {
    times: any((f) => f.depTime ?? f.durationMin),
    cabin: any((f) => f.cabinClass),
    seat: any((f) => f.seatType ?? f.seatNumber),
    reason: any((f) => f.reason),
    registration: any((f) => f.registration),
    flightNumber: any((f) => f.flightNumber),
    exactDates: flights.some((f) => f.datePrecision === 'day'),
  };
}

/** Plain-language list of what a journal shares, e.g. for the public footer. */
export function sharedSummary(fields: FlightFields): string {
  const parts = ['routes', fields.exactDates ? 'dates' : 'months', 'airlines', 'aircraft types'];
  if (fields.times) parts.push('flight times');
  if (fields.cabin) parts.push('cabin classes');
  if (fields.seat) parts.push('seats');
  if (fields.reason) parts.push('trip purposes');
  if (fields.flightNumber) parts.push('flight numbers');
  if (fields.registration) parts.push('aircraft registrations');
  parts.push('saved trips');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Visitors see miles where miles are customary, kilometres elsewhere. */
export function defaultDistanceUnit(
  locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US',
): Settings['distanceUnit'] {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region && ['US', 'GB', 'LR', 'MM'].includes(region) ? 'mi' : 'km';
  } catch {
    return 'km';
  }
}
