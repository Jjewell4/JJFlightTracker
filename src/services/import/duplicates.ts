/** Detects candidates that already exist in the log. */
import type { Flight } from '@/lib/types';
import type { ImportCandidate } from './candidates';

const routeKey = (f: Pick<Flight, 'date' | 'from' | 'to'>) => `${f.date}|${f.from}|${f.to}`;

/**
 * Returns candidate key → existing flight id for every candidate that duplicates a saved flight.
 *
 * A duplicate has the same date + origin + destination, and the same flight number (or one of
 * them has none). Each saved flight can only be claimed once, so two genuine same-day
 * round trips on the same route are not collapsed into one.
 */
export function findDuplicates(candidates: ImportCandidate[], existing: Flight[]): Map<string, string> {
  const byRoute = new Map<string, Flight[]>();
  const byId = new Map<string, Flight>();
  for (const f of existing) {
    byId.set(f.id, f);
    const k = routeKey(f);
    const list = byRoute.get(k);
    if (list) list.push(f);
    else byRoute.set(k, [f]);
  }
  const claimed = new Set<string>();
  const result = new Map<string, string>();

  // Pass 1: same id (restoring a backup onto itself) — Pass 2: exact flight number — Pass 3: loose.
  const passes: ((c: ImportCandidate, f: Flight) => boolean)[] = [
    (c, f) => !!c.flight.id && c.flight.id === f.id,
    (c, f) => !!c.flight.flightNumber && c.flight.flightNumber === f.flightNumber,
    (c, f) => !c.flight.flightNumber || !f.flightNumber,
  ];
  for (const [i, match] of passes.entries()) {
    for (const c of candidates) {
      if (result.has(c.key) || !c.flight.date) continue;
      const pool = i === 0 ? (c.flight.id && byId.has(c.flight.id) ? [byId.get(c.flight.id)!] : []) : (byRoute.get(routeKey(c.flight)) ?? []);
      const hit = pool.find((f) => !claimed.has(f.id) && match(c, f));
      if (hit) {
        claimed.add(hit.id);
        result.set(c.key, hit.id);
      }
    }
  }
  return result;
}
