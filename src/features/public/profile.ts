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
>;
export interface PublicProfile {
  slug: string;
  display_name: string;
  flights: PublicFlight[];
  published_at: string;
  exact_dates?: boolean;
}
export function publicFlights(
  flights: Flight[],
  exactDates: boolean,
  today = todayLocal(),
): PublicFlight[] {
  return flights
    .filter((f) => {
      if (f.datePrecision === 'year')
        return f.date.slice(0, 4) < today.slice(0, 4);
      if (f.datePrecision === 'month')
        return f.date.slice(0, 7) < today.slice(0, 7);
      return f.date < today;
    })
    .map((f) => ({
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
    }));
}
export function asFlights(flights: PublicFlight[]): Flight[] {
  return flights.map((f, i) => ({
    ...f,
    id: `public-${i}`,
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
  }));
}
export function profileUrl(slug: string) {
  return `${window.location.origin}/${slug}`;
}

/**
 * Fields a public journal can contain. The projection (here and in
 * supabase/public-profiles.sql) only ever shares dates, airports, airlines and aircraft
 * types, so everything else is unavailable; exact dates only when the owner opted in.
 */
export function publicFields(flights: Pick<PublicFlight, 'datePrecision'>[]): FlightFields {
  return {
    times: false,
    cabin: false,
    seat: false,
    reason: false,
    registration: false,
    flightNumber: false,
    exactDates: flights.some((f) => f.datePrecision === 'day'),
  };
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
