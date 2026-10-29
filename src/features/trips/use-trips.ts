import { useMemo } from 'react';
import { isReferenceLoaded } from '@/data/reference';
import { detectTrips, type Trip } from '@/lib/trips';
import type { Flight } from '@/lib/types';

/**
 * Cheap fingerprint of a flight list (ids + updatedAt, in order). Every live query hands back a
 * fresh array, so this — not identity — decides whether trips need detecting again.
 */
export function flightsSignature(flights: readonly Flight[]): string {
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  };
  for (const f of flights) {
    mix(f.id);
    mix(String(f.updatedAt));
  }
  return `${flights.length}:${(h >>> 0).toString(36)}`;
}

// One shared result: the log, a trip page and a flight's trip chip all ask for the same list.
let cache: { sig: string; trips: Trip[] } | null = null;

/** Saved + suggested trips for a flight list, recomputed only when the flights change. */
export function tripsFor(flights: readonly Flight[]): Trip[] {
  // Detection needs airports (time zones, cities): never cache a result computed without them.
  const sig = `${isReferenceLoaded() ? 'r' : 'x'}:${flightsSignature(flights)}`;
  if (cache?.sig === sig) return cache.trips;
  const trips = detectTrips(flights as Flight[]);
  cache = { sig, trips };
  return trips;
}

/** Trips once flights and reference data (time zones, cities) are loaded; undefined before. */
export function useTrips(flights: readonly Flight[] | undefined, ready: boolean): Trip[] | undefined {
  return useMemo(() => (flights && ready ? tripsFor(flights) : undefined), [flights, ready]);
}
