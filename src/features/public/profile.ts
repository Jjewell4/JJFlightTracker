import type { Flight } from '@/lib/types';
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
>;
export interface PublicProfile {
  slug: string;
  display_name: string;
  flights: PublicFlight[];
  published_at: string;
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
