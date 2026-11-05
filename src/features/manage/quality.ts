import type { Flight } from '@/lib/types';
import { flightDistanceKm } from '@/lib/flight-utils';
export interface QualityIssue {
  key: string;
  title: string;
  detail: string;
  flights: Flight[];
}
/** Deliberately conservative: no completeness score, no seat/aircraft/missing-time reminders. */
export function qualityIssues(flights: Flight[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const routes = new Map<string, Flight[]>();
  const fingerprint = (f: Flight) => [f.id, f.date, f.from, f.to, f.depTime, f.flightNumber, f.durationMin].join('|');
  for (const f of flights) {
    const min = f.durationMin;
    const km = flightDistanceKm(f) ?? 0;
    if (min !== undefined && (min <= 0 || min > 24 * 60 || (km > 500 && km / (min / 60) > 1600)))
      issues.push({
        key: `duration:${fingerprint(f)}`,
        title: 'Check recorded duration',
        detail: `${min} minutes for this route looks unusual. Check the date, local times and arrival-day offset.`,
        flights: [f],
      });
    if (f.datePrecision !== 'day') continue;
    const key = [f.date, f.from, f.to].join('|');
    const pool = routes.get(key) ?? [];
    for (const old of pool) {
      // A repeated route alone is not enough: require matching flight numbers or exact times.
      const number = !!f.flightNumber && f.flightNumber === old.flightNumber;
      const time = !!f.depTime && f.depTime === old.depTime;
      const incompatibleTime = !!f.depTime && !!old.depTime && f.depTime !== old.depTime;
      const incompatibleNumber = !!f.flightNumber && !!old.flightNumber && f.flightNumber !== old.flightNumber;
      if (!incompatibleTime && !incompatibleNumber && (number || time))
        issues.push({
          key: `duplicate:${[fingerprint(f), fingerprint(old)].sort().join('::')}`,
          title: 'Possible duplicate',
          detail: 'Same day, route and matching flight number or departure time. Review both before deleting anything.',
          flights: [old, f],
        });
    }
    pool.push(f);
    routes.set(key, pool);
  }
  return issues;
}
