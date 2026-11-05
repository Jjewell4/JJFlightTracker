import type { Flight } from '@/lib/types';
import { flightDistanceKm } from '@/lib/flight-utils';
export function compareYears(flights: Flight[], year: number, today: string) {
  const partial = year === Number(today.slice(0, 4));
  const cutoff = today.slice(5);
  const select = (y: number) =>
    flights.filter((f) => f.date.startsWith(`${y}-`) && (!partial || (f.datePrecision === 'day' && f.date.slice(5) <= cutoff)));
  const total = (list: Flight[]) => ({ count: list.length, distanceKm: list.reduce((n, f) => n + (flightDistanceKm(f) ?? 0), 0) });
  return { current: total(select(year)), previous: total(select(year - 1)), partial };
}
