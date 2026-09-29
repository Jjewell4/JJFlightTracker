/**
 * Reference data (airports, airlines, aircraft types, countries).
 *
 * Datasets live in public/data/*.json (built by scripts/build-data.mjs) and are
 * fetched once, then cached by the service worker for offline use.
 *
 * Usage:
 *   await loadReference();            // or: const ready = useReferenceReady();
 *   getAirport('KLAX')                // sync after load; accepts ICAO ident or IATA
 *   searchAirports('los ang')         // ranked results
 */
import { useEffect, useState } from 'react';
import type { AircraftType, Airline, Airport, Continent, Country } from '@/lib/types';

interface Table {
  fields: string[];
  rows: unknown[][];
}

interface RefData {
  airports: Airport[];
  airportByIdent: Map<string, Airport>;
  airportByIata: Map<string, Airport>;
  airlines: Airline[];
  airlineByIcao: Map<string, Airline>;
  airlineByIata: Map<string, Airline>;
  airlineByName: Map<string, Airline>;
  aircraft: AircraftType[];
  aircraftByIcao: Map<string, AircraftType>;
  aircraftByIata: Map<string, AircraftType>;
  countries: Country[];
  countryByCode: Map<string, Country>;
}

let data: RefData | null = null;
let loading: Promise<RefData> | null = null;

const dataUrl = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

async function fetchTable(name: string): Promise<Table> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`);
  return res.json();
}

/** Builds an index from a set of reference tables. Exported for tests (no network). */
export function buildReference(tables: {
  airports: Table;
  airlines: Table;
  aircraft: Table;
  countries: Table;
}): RefData {
  const airports: Airport[] = tables.airports.rows.map((r) => ({
    ident: r[0] as string,
    iata: r[1] as string,
    name: r[2] as string,
    city: r[3] as string,
    region: r[4] as string,
    country: r[5] as string,
    lat: r[6] as number,
    lon: r[7] as number,
    tz: r[8] as string,
    size: r[9] as 1 | 2 | 3,
    scheduled: r[10] === 1,
  }));
  const airportByIdent = new Map(airports.map((a) => [a.ident, a]));
  const airportByIata = new Map<string, Airport>();
  // Rows are sorted largest-first, so the first airport claiming an IATA code wins.
  for (const a of airports) if (a.iata && !airportByIata.has(a.iata)) airportByIata.set(a.iata, a);

  const airlines: Airline[] = tables.airlines.rows.map((r) => ({
    name: r[0] as string,
    iata: r[1] as string,
    icao: r[2] as string,
    callsign: r[3] as string,
    country: r[4] as string,
    active: (r[5] as number) >= 1,
    major: r[5] === 2,
  }));
  const airlineByIcao = new Map(airlines.map((a) => [a.icao, a]));
  const airlineByIata = new Map<string, Airline>();
  const airlineByName = new Map<string, Airline>();
  // Active airlines come first in the dataset, so they win IATA/name collisions.
  for (const a of airlines) {
    if (a.iata && !airlineByIata.has(a.iata)) airlineByIata.set(a.iata, a);
    const key = normalize(a.name);
    if (!airlineByName.has(key)) airlineByName.set(key, a);
  }

  const aircraft: AircraftType[] = tables.aircraft.rows.map((r) => ({
    name: r[0] as string,
    iata: r[1] as string,
    icao: r[2] as string,
  }));
  const aircraftByIcao = new Map(aircraft.map((a) => [a.icao, a]));
  const aircraftByIata = new Map<string, AircraftType>();
  for (const a of aircraft) if (a.iata && !aircraftByIata.has(a.iata)) aircraftByIata.set(a.iata, a);

  const countries: Country[] = tables.countries.rows.map((r) => ({
    code: r[0] as string,
    name: r[1] as string,
    continent: r[2] as Continent,
  }));
  const countryByCode = new Map(countries.map((c) => [c.code, c]));

  return {
    airports,
    airportByIdent,
    airportByIata,
    airlines,
    airlineByIcao,
    airlineByIata,
    airlineByName,
    aircraft,
    aircraftByIcao,
    aircraftByIata,
    countries,
    countryByCode,
  };
}

/** Install pre-built reference data (used by tests). */
export function setReference(ref: RefData): void {
  data = ref;
}

export function loadReference(): Promise<RefData> {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = Promise.all([
      fetchTable('airports.json'),
      fetchTable('airlines.json'),
      fetchTable('aircraft.json'),
      fetchTable('countries.json'),
    ])
      .then(([airports, airlines, aircraft, countries]) => {
        data = buildReference({ airports, airlines, aircraft, countries });
        return data;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

export function isReferenceLoaded(): boolean {
  return data !== null;
}

/** React hook: true once reference data is available. Triggers loading. */
export function useReferenceReady(): boolean {
  const [ready, setReady] = useState(isReferenceLoaded());
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadReference()
      .then(() => alive && setReady(true))
      .catch((e) => console.error(e));
    return () => {
      alive = false;
    };
  }, [ready]);
  return ready;
}

function req(): RefData {
  if (!data) throw new Error('Reference data not loaded – call loadReference() first');
  return data;
}

// ---------- lookups (sync; require loadReference) ----------

/** Look up by ICAO ident ("KLAX") or IATA ("LAX"). Case-insensitive. */
export function getAirport(code: string | undefined | null): Airport | undefined {
  if (!code || !data) return undefined;
  const c = code.trim().toUpperCase();
  return c.length === 3 ? (data.airportByIata.get(c) ?? data.airportByIdent.get(c)) : (data.airportByIdent.get(c) ?? data.airportByIata.get(c));
}

/** Look up by ICAO ("UAL") or IATA ("UA"). Case-insensitive. */
export function getAirline(code: string | undefined | null): Airline | undefined {
  if (!code || !data) return undefined;
  const c = code.trim().toUpperCase();
  return c.length === 3 ? (data.airlineByIcao.get(c) ?? data.airlineByIata.get(c)) : (data.airlineByIata.get(c) ?? data.airlineByIcao.get(c));
}

export function getAirlineByName(name: string | undefined | null): Airline | undefined {
  if (!name || !data) return undefined;
  return data.airlineByName.get(normalize(name));
}

/** Look up by ICAO type ("B738") or IATA type ("738"). */
export function getAircraftType(code: string | undefined | null): AircraftType | undefined {
  if (!code || !data) return undefined;
  const c = code.trim().toUpperCase();
  return data.aircraftByIcao.get(c) ?? data.aircraftByIata.get(c);
}

export function getCountry(code: string | undefined | null): Country | undefined {
  if (!code || !data) return undefined;
  return data.countryByCode.get(code.toUpperCase());
}

export function allCountries(): Country[] {
  return data?.countries ?? [];
}

export function allAirports(): Airport[] {
  return data?.airports ?? [];
}

export function allAirlines(): Airline[] {
  return data?.airlines ?? [];
}

export function allAircraftTypes(): AircraftType[] {
  return data?.aircraft ?? [];
}

// ---------- search ----------

/** Lowercase, strip accents and punctuation. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function wordScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  if (haystack === needle) return 100;
  // Whole-word match ("san" in "san francisco") beats a mere prefix ("sandefjord").
  if (haystack.startsWith(`${needle} `)) return 80;
  if (haystack.includes(` ${needle} `) || haystack.endsWith(` ${needle}`)) return 50;
  if (haystack.startsWith(needle)) return 60;
  if (haystack.includes(` ${needle}`)) return 40;
  if (haystack.includes(needle)) return 15;
  return 0;
}

/** Busiest passenger hubs – small ranking boost so "chicago" → ORD, "london" → LHR. */
const HUBS = new Set(
  'ATL DFW DEN ORD LAX JFK LAS MCO MIA CLT SEA PHX EWR SFO IAH BOS FLL MSP LGA DTW PHL SLC BWI IAD SAN DCA TPA BNA AUS HNL ANC YYZ YVR YUL MEX CUN GDL BOG LIM SCL GRU GIG EZE PTY LHR CDG AMS FRA IST MAD BCN MUC FCO LGW DUB ZRH CPH OSL ARN VIE LIS KEF DXB DOH AUH DEL BOM SIN HKG ICN HND NRT PEK PVG CAN BKK KUL CGK MNL TPE SYD MEL AKL JNB CAI'.split(' '),
);

/**
 * Ranked airport search over IATA, ICAO, city, name and region.
 * Exact code matches rank first; bigger airports rank higher.
 */
export function searchAirports(query: string, limit = 8): Airport[] {
  const d = req();
  const q = normalize(query);
  if (!q) return [];
  const upper = query.trim().toUpperCase();
  const scored: { a: Airport; s: number }[] = [];
  const terms = q.split(' ');
  for (const a of d.airports) {
    let s = 0;
    if (a.iata === upper) s += 1000;
    else if (a.ident === upper) s += 900;
    else if (upper.length >= 2 && a.iata.startsWith(upper)) s += 120;
    const city = normalize(a.city);
    const name = normalize(a.name);
    let textScore = 0;
    for (const t of terms) {
      const ts = Math.max(wordScore(city, t) * 1.3, wordScore(name, t), a.region && t === a.region.toLowerCase() ? 30 : 0);
      if (ts === 0) {
        textScore = 0;
        break;
      }
      textScore += ts;
    }
    s += textScore;
    if (s === 0) continue;
    s += a.size * 12 + (a.scheduled ? 10 : 0) + (a.iata ? 8 : 0);
    if (HUBS.has(a.iata)) s += 30;
    scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map((x) => x.a);
}

/** Ranked airline search over IATA, ICAO, name and callsign. Active airlines rank higher. */
export function searchAirlines(query: string, limit = 8): Airline[] {
  const d = req();
  const q = normalize(query);
  if (!q) return [];
  const upper = query.trim().toUpperCase();
  const scored: { a: Airline; s: number }[] = [];
  for (const a of d.airlines) {
    let s = 0;
    if (a.iata === upper) s += 1000;
    else if (a.icao === upper) s += 900;
    s += Math.max(wordScore(normalize(a.name), q) * 1.5, wordScore(normalize(a.callsign), q) * 0.5);
    if (s === 0) continue;
    if (a.active) s += 40;
    if (a.major) s += 60;
    if (a.iata) s += 10;
    scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map((x) => x.a);
}

/** Ranked aircraft-type search over ICAO/IATA designators and names. */
export function searchAircraftTypes(query: string, limit = 8): AircraftType[] {
  const d = req();
  const q = normalize(query);
  if (!q) return [];
  const upper = query.trim().toUpperCase();
  const terms = q.split(' ');
  const scored: { a: AircraftType; s: number }[] = [];
  for (const a of d.aircraft) {
    let s = 0;
    if (a.icao === upper) s += 1000;
    else if (a.iata === upper) s += 800;
    else if (a.icao.startsWith(upper)) s += 100;
    const name = normalize(a.name);
    let textScore = 0;
    for (const t of terms) {
      const ts = wordScore(name, t);
      if (ts === 0) {
        textScore = 0;
        break;
      }
      textScore += ts;
    }
    s += textScore;
    if (s === 0) continue;
    scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map((x) => x.a);
}
