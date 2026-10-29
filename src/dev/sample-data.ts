/**
 * Deterministic sample flight history (~250 flights, 2015–2026) for development,
 * screenshots and demos. Exposed as window.__seedSampleFlights() in dev builds and
 * reachable from Settings ("Load sample data") in all builds.
 */
import { addFlights, db, deleteAllFlights } from '@/lib/db';
import { enrichFlight } from '@/lib/flight-utils';
import { getAirport, loadReference } from '@/data/reference';
import { tzOffsetMinutes, zonedToUtc } from '@/lib/time';
import type { CabinClass, FlightInput, FlightOccasion, FlightReason, SeatType } from '@/lib/types';

// Tiny seeded PRNG (mulberry32) so the sample is stable across runs.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [destination IATA, weight, airline IATA options, aircraft ICAO options, typical block minutes from SAN]
const DESTS: [string, number, string[], string[]][] = [
  ['SFO', 14, ['UA', 'AS', 'WN'], ['A320', 'B738', 'B38M', 'E75L']],
  ['SEA', 12, ['AS', 'DL'], ['B739', 'B38M', 'A320']],
  ['DEN', 9, ['UA', 'WN', 'F9'], ['B738', 'A20N', 'B39M']],
  ['ORD', 8, ['UA', 'AA'], ['B739', 'A321', 'B38M']],
  ['JFK', 6, ['B6', 'DL', 'AA'], ['A321', 'B752', 'A21N']],
  ['EWR', 5, ['UA'], ['B739', 'B772', 'B38M']],
  ['BOS', 5, ['B6', 'AS', 'DL'], ['A321', 'A21N', 'B739']],
  ['DFW', 6, ['AA'], ['A321', 'B738']],
  ['IAH', 5, ['UA'], ['B739', 'B38M']],
  ['ATL', 4, ['DL'], ['B752', 'A321', 'B739']],
  ['PDX', 5, ['AS', 'WN'], ['E75L', 'B737', 'A320']],
  ['PHX', 6, ['WN', 'AA'], ['B737', 'B38M', 'A321']],
  ['LAS', 6, ['WN', 'G4', 'NK'], ['B737', 'B738', 'A320']],
  ['SLC', 4, ['DL'], ['A320', 'BCS3', 'A20N']],
  ['AUS', 5, ['WN', 'AS', 'AA'], ['B38M', 'B737', 'E75L']],
  ['BNA', 4, ['WN', 'AS'], ['B737', 'B38M']],
  ['IAD', 4, ['UA', 'AS'], ['B739', 'A320']],
  ['MSP', 3, ['DL', 'SY'], ['A321', 'B738']],
  ['MCO', 3, ['WN', 'DL'], ['B38M', 'A321']],
  ['ANC', 2, ['AS'], ['B739', 'B38M']],
  ['HNL', 3, ['HA', 'AS'], ['A21N', 'B712', 'B739']],
  ['OGG', 2, ['HA', 'AS'], ['A21N', 'B739']],
  ['MEX', 2, ['AM', 'Y4'], ['B38M', 'A20N']],
  ['SJD', 2, ['AS', 'WN'], ['B739', 'B738']],
  ['GRU', 1, ['UA', 'LA'], ['B789', 'B763']],
  ['SCL', 1, ['LA'], ['B789', 'B788']],
  ['KEF', 1, ['FI'], ['B38M', 'B763']],
  ['LHR', 1, ['BA', 'VS'], ['A35K', 'B789']],
];

const HOME = ['SAN', 'SAN', 'SAN', 'LAX'];
// Flights per year, loosely mirroring the reference profile (pandemic dip in 2020).
const PER_YEAR: Record<number, number> = {
  2015: 4, 2016: 19, 2017: 26, 2018: 38, 2019: 41, 2020: 10, 2021: 12, 2022: 17, 2023: 35, 2024: 18, 2025: 15, 2026: 20,
};

export async function generateSampleFlights(): Promise<FlightInput[]> {
  await loadReference();
  const r = rng(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];
  const totalW = DESTS.reduce((s, d) => s + d[1], 0);
  const pickDest = () => {
    let x = r() * totalW;
    for (const d of DESTS) if ((x -= d[1]) <= 0) return d;
    return DESTS[0];
  };
  const out: FlightInput[] = [];
  for (const [yearStr, count] of Object.entries(PER_YEAR)) {
    const year = Number(yearStr);
    let trips = Math.ceil(count / 2);
    while (trips-- > 0 && out.filter((f) => f.date.startsWith(yearStr)).length < count) {
      const [dest, , airlines, aircraft] = pickDest();
      const home = pick(HOME);
      const airline = pick(airlines);
      const month = 1 + Math.floor(r() * (year === 2026 ? 9 : 12));
      const day = 1 + Math.floor(r() * 27);
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const back = new Date(Date.UTC(year, month - 1, day + 2 + Math.floor(r() * 6))).toISOString().slice(0, 10);
      const reason: FlightReason = r() < 0.62 ? 'business' : 'leisure';
      const cabin: CabinClass = r() < 0.9 ? 'economy' : r() < 0.9 ? 'premium' : 'first';
      const seatType: SeatType = r() < 0.73 ? 'window' : r() < 0.75 ? 'aisle' : 'middle';
      const seatRow = 6 + Math.floor(r() * 28);
      const seatLetter = seatType === 'window' ? pick(['A', 'F']) : seatType === 'aisle' ? pick(['C', 'D']) : pick(['B', 'E']);
      const dep = 6 * 60 + Math.floor(r() * 14 * 60);
      const t = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      // Derived from the day (not r()) so the rest of the sample log stays the same.
      const occasion: FlightOccasion | undefined =
        day % 3 === 0 ? undefined : reason === 'business' ? (day % 2 ? 'work' : 'conference') : (['vacation', 'family', 'wedding', 'friends', 'holiday'] as const)[day % 5];
      const common = { datePrecision: 'day' as const, source: 'manual' as const, reason, occasion, cabinClass: cabin, seatType };
      const mk = (from: string, to: string, d: string, depMin: number, num: number): FlightInput => {
        const base = enrichFlight({ ...common, date: d, from, to, flightNumber: `${airline}${num}`, aircraftType: pick(aircraft), seatNumber: `${seatRow}${seatLetter}` });
        const km = base.distanceKm ?? 800;
        const block = Math.round(35 + (km / 800) * 60);
        // Arrival wall-clock time is expressed in the destination's time zone.
        const fromTz = getAirport(base.from)?.tz;
        const toTz = getAirport(base.to)?.tz;
        const arrUtc = zonedToUtc(d, t(depMin), fromTz) + block * 60000;
        const arrLocal = new Date(arrUtc + (toTz ? tzOffsetMinutes(toTz, new Date(arrUtc)) : 0) * 60000);
        const arrMin = arrLocal.getUTCHours() * 60 + arrLocal.getUTCMinutes();
        return enrichFlight({ ...base, depTime: t(depMin), arrTime: t(arrMin), durationMin: undefined, arrDayOffset: undefined });
      };
      out.push(mk(home, dest, date, dep, 100 + Math.floor(r() * 2800)));
      if (out.filter((f) => f.date.startsWith(yearStr)).length < count) out.push(mk(dest, home, back, 7 * 60 + Math.floor(r() * 12 * 60), 100 + Math.floor(r() * 2800)));
    }
  }
  return out;
}

export async function seedSampleFlights({ replace = true } = {}): Promise<number> {
  const flights = await generateSampleFlights();
  // One transaction: a failure never leaves the log wiped but not re-filled.
  await db.transaction('rw', db.flights, async () => {
    if (replace) await deleteAllFlights();
    await addFlights(flights);
  });
  return flights.length;
}

declare global {
  interface Window {
    __seedSampleFlights?: () => Promise<number>;
  }
}

// Dev-only console/screenshot hook (scripts/screenshot.mjs --seed); never in production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') window.__seedSampleFlights = () => seedSampleFlights();
