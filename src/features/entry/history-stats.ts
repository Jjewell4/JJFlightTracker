/** "Recent & frequent" suggestions derived from the user's logged flights. */
import type { Flight } from '@/lib/types';

export interface UsageStats {
  /** Airport idents, most recently used first. */
  recentAirports: string[];
  /** Airport idents by visit count. */
  frequentAirports: string[];
  /** from → (to → count) */
  routes: Map<string, Map<string, number>>;
  /** Airline ICAO codes (or names), most recent first then by count. */
  airlines: string[];
  /** Aircraft ICAO types, most recent first then by count. */
  aircraft: string[];
}

function rankByCount(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Flights are expected newest first (as returned by useFlights). */
export function usageStats(flights: readonly Flight[] | undefined): UsageStats {
  const recent: string[] = [];
  const counts = new Map<string, number>();
  const routes = new Map<string, Map<string, number>>();
  const airlineCounts = new Map<string, number>();
  const aircraftCounts = new Map<string, number>();
  const recentAirlines: string[] = [];
  const recentAircraft: string[] = [];
  for (const f of flights ?? []) {
    for (const a of [f.to, f.from]) {
      if (!a) continue;
      counts.set(a, (counts.get(a) ?? 0) + 1);
      if (recent.length < 6 && !recent.includes(a)) recent.push(a);
    }
    if (f.from && f.to) {
      let m = routes.get(f.from);
      if (!m) routes.set(f.from, (m = new Map()));
      m.set(f.to, (m.get(f.to) ?? 0) + 1);
    }
    const al = f.airlineIcao || f.airlineIata;
    if (al) {
      airlineCounts.set(al, (airlineCounts.get(al) ?? 0) + 1);
      if (recentAirlines.length < 3 && !recentAirlines.includes(al)) recentAirlines.push(al);
    }
    if (f.aircraftType) {
      aircraftCounts.set(f.aircraftType, (aircraftCounts.get(f.aircraftType) ?? 0) + 1);
      if (recentAircraft.length < 3 && !recentAircraft.includes(f.aircraftType)) recentAircraft.push(f.aircraftType);
    }
  }
  const merge = (first: string[], rest: string[], max: number) => [...new Set([...first, ...rest])].slice(0, max);
  return {
    recentAirports: recent,
    frequentAirports: rankByCount(counts),
    routes,
    airlines: merge(recentAirlines, rankByCount(airlineCounts), 8),
    aircraft: merge(recentAircraft, rankByCount(aircraftCounts), 8),
  };
}

/** Destinations flown from `from` (or origins flown to `to` when reverse), most flown first. */
export function routePartners(stats: UsageStats, ident: string, reverse = false): string[] {
  if (!reverse) return rankByCount(stats.routes.get(ident) ?? new Map());
  const counts = new Map<string, number>();
  for (const [from, tos] of stats.routes) {
    const n = tos.get(ident);
    if (n) counts.set(from, n);
  }
  return rankByCount(counts);
}
