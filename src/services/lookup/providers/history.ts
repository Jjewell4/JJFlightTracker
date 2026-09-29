/**
 * "History" provider (offline): if the user already logged this flight number, suggest the
 * route they usually flew on it, plus the most recent aircraft and schedule on that route.
 */
import { getAircraftType } from '@/data/reference';
import { normalizeFlightNumber } from '@/lib/flight-utils';
import type { Flight } from '@/lib/types';
import { flightNumberKey } from '../flight-number';
import type { FlightLookupResult } from '../types';

type HistoryFlight = Pick<
  Flight,
  'id' | 'date' | 'flightNumber' | 'from' | 'to' | 'depTime' | 'arrTime' | 'arrDayOffset' | 'aircraftType' | 'aircraftName' | 'airlineIcao' | 'airlineIata' | 'airlineName'
> &
  Partial<Pick<Flight, 'createdAt'>>;

/** One result per distinct route flown under this flight number, most-flown first. */
export function historyLookup(
  flightNumber: string,
  flights: readonly HistoryFlight[] | undefined,
  opts: { excludeId?: string } = {},
): FlightLookupResult[] {
  const key = flightNumberKey(flightNumber);
  if (!key || !flights?.length) return [];
  const normalized = normalizeFlightNumber(flightNumber) ?? flightNumber;

  const matches = flights.filter((f) => f.id !== opts.excludeId && f.flightNumber && f.from && f.to && flightNumberKey(f.flightNumber) === key);
  if (!matches.length) return [];

  // Group by route, newest first inside each group.
  const byRoute = new Map<string, HistoryFlight[]>();
  const newest = (a: HistoryFlight, b: HistoryFlight) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0);
  for (const f of [...matches].sort(newest)) {
    const k = `${f.from}>${f.to}`;
    const list = byRoute.get(k);
    if (list) list.push(f);
    else byRoute.set(k, [f]);
  }

  const groups = [...byRoute.values()].sort((a, b) => b.length - a.length || newest(a[0], b[0]));
  const total = matches.length;

  return groups.map((group, i) => {
    const latest = group[0];
    const withAircraft = group.find((f) => f.aircraftType || f.aircraftName);
    const withTimes = group.find((f) => f.depTime && f.arrTime);
    const withAirline = group.find((f) => f.airlineIcao || f.airlineIata || f.airlineName);
    const n = group.length;
    // Dominant, repeated routes are trustworthy; a lone old flight less so.
    const share = n / total;
    const confidence = Math.min(0.9, 0.55 + Math.min(n, 4) * 0.06 + share * 0.1) - i * 0.1;
    return {
      key: `history:${latest.from}>${latest.to}`,
      flightNumber: normalized,
      airline: withAirline
        ? { icao: withAirline.airlineIcao, iata: withAirline.airlineIata, name: withAirline.airlineName }
        : undefined,
      from: latest.from,
      to: latest.to,
      depTime: withTimes?.depTime,
      arrTime: withTimes?.arrTime,
      arrDayOffset: withTimes ? withTimes.arrDayOffset : undefined,
      aircraftType: withAircraft?.aircraftType,
      aircraftName: withAircraft?.aircraftName ?? getAircraftType(withAircraft?.aircraftType)?.name,
      source: 'history' as const,
      sourceLabel: n === 1 ? 'You flew this before' : `You've flown this ${n}×`,
      confidence: Math.round(confidence * 100) / 100,
      dateSpecific: false,
    };
  });
}
