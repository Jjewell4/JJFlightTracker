/** Detects candidates that already exist in the log. */
import type { Flight } from '@/lib/types';
import type { ImportCandidate } from './candidates';

const routeKey = (f: Pick<Flight, 'date' | 'from' | 'to'>) => `${f.date}|${f.from}|${f.to}`;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Both sides have a departure time and it is the same. */
const sameDep = (a?: string, b?: string) => !!a && !!b && a === b;
/** Departure times don't rule a match out: one is missing, or they are within an hour (e.g. scheduled vs actual). */
const closeDep = (a?: string, b?: string) => {
  if (!a || !b) return true;
  const d = Math.abs(toMin(a) - toMin(b));
  return Math.min(d, 24 * 60 - d) <= 60;
};

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

  // Pass 1: same id (restoring a backup onto itself) — then exact flight number, then loose
  // (a number is missing). Within each, an identical departure time is claimed first so a
  // 07:00 row can't take the saved 19:00 flight from the 19:00 row; loose matches never pair
  // departure times more than an hour apart.
  const sameNumber = (c: ImportCandidate, f: Flight) => !!c.flight.flightNumber && c.flight.flightNumber === f.flightNumber;
  const loose = (c: ImportCandidate, f: Flight) => !c.flight.flightNumber || !f.flightNumber;
  const passes: ((c: ImportCandidate, f: Flight) => boolean)[] = [
    (c, f) => !!c.flight.id && c.flight.id === f.id,
    (c, f) => sameNumber(c, f) && sameDep(c.flight.depTime, f.depTime),
    (c, f) => sameNumber(c, f),
    (c, f) => loose(c, f) && sameDep(c.flight.depTime, f.depTime),
    (c, f) => loose(c, f) && closeDep(c.flight.depTime, f.depTime),
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
