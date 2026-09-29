/**
 * Parsing of "reference" cells: airports, airlines and aircraft as written by
 * Flightradar24 ("San Diego / San Diego International (SAN/KSAN)") or as bare codes/names.
 * Resolution against the reference data requires `loadReference()` to have completed.
 */
import { getAirline, getAirlineByName, getAircraftType, getAirport, normalize, searchAirports } from '@/data/reference';
import type { Airport } from '@/lib/types';
import { cellText, type Cell } from './cells';

export interface AirportRef {
  iata?: string;
  icao?: string;
  /** Free text (city/airport name) when present. */
  name?: string;
  raw: string;
}

const CODE = /^[A-Za-z0-9]{3,4}$/;

/** Splits an airport cell into its codes/name. Returns undefined for blank cells. */
export function parseAirportRef(v: Cell): AirportRef | undefined {
  const raw = cellText(v);
  if (!raw) return undefined;

  let m = /^(.*?)\(\s*([A-Za-z0-9]{0,4})\s*\/\s*([A-Za-z0-9]{0,4})\s*\)\s*$/.exec(raw);
  if (m) {
    const [a, b] = [m[2].toUpperCase(), m[3].toUpperCase()];
    // FR24 order is IATA/ICAO, but be tolerant of a swapped pair.
    const [iata, icao] = a.length === 4 && b.length <= 3 ? [b, a] : [a, b];
    return { iata: iata || undefined, icao: icao || undefined, name: m[1].trim() || undefined, raw };
  }
  if ((m = /^(.*?)\(\s*([A-Za-z0-9]{3,4})\s*\)\s*$/.exec(raw))) {
    const c = m[2].toUpperCase();
    return { ...(c.length === 3 ? { iata: c } : { icao: c }), name: m[1].trim() || undefined, raw };
  }
  if (CODE.test(raw)) {
    const c = raw.toUpperCase();
    return c.length === 3 ? { iata: c, raw } : { icao: c, raw };
  }
  // "SAN - San Diego" / "San Diego - SAN"
  if ((m = /^([A-Za-z0-9]{3,4})\s*[-–—:,]\s+(.+)$/.exec(raw)) && m[1] === m[1].toUpperCase()) {
    const c = m[1];
    return { ...(c.length === 3 ? { iata: c } : { icao: c }), name: m[2].trim(), raw };
  }
  if ((m = /^(.+?)\s+[-–—:]\s*([A-Z0-9]{3,4})$/.exec(raw))) {
    const c = m[2];
    return { ...(c.length === 3 ? { iata: c } : { icao: c }), name: m[1].trim(), raw };
  }
  return { name: raw, raw };
}

export interface ResolvedAirport {
  airport?: Airport;
  /** Best identifier to store on the flight (canonical ICAO ident when found). */
  ident: string;
  /** True when we matched by name only (not by an explicit code). */
  guessed?: boolean;
}

/** Resolves ICAO → IATA → (unambiguous) name. Unknown airports keep their code as ident. */
export function resolveAirport(ref: AirportRef | undefined): ResolvedAirport | undefined {
  if (!ref) return undefined;
  const byCode = getAirport(ref.icao) ?? getAirport(ref.iata);
  if (byCode) return { airport: byCode, ident: byCode.ident };
  const code = ref.icao ?? ref.iata;
  if (code) return { ident: code };
  if (ref.name) {
    const q = normalize(ref.name);
    const hit = searchAirports(ref.name, 1)[0];
    if (hit && (normalize(hit.city) === q || normalize(hit.name) === q)) return { airport: hit, ident: hit.ident, guessed: true };
    return { ident: ref.name.toUpperCase().slice(0, 40) };
  }
  return { ident: ref.raw };
}

export interface AirlineRef {
  name?: string;
  iata?: string;
  icao?: string;
}

/** "United Airlines (UA/UAL)", " (/)", "UA", "UAL", "United Airlines". */
export function parseAirlineRef(v: Cell): AirlineRef | undefined {
  const raw = cellText(v);
  if (!raw) return undefined;
  const m = /^(.*?)\(\s*([A-Za-z0-9]{0,3})\s*\/\s*([A-Za-z0-9]{0,4})\s*\)\s*$/.exec(raw);
  if (m) {
    const out: AirlineRef = {
      name: m[1].trim() || undefined,
      iata: m[2].toUpperCase() || undefined,
      icao: m[3].toUpperCase() || undefined,
    };
    return out.name || out.iata || out.icao ? out : undefined;
  }
  const single = /^(.*?)\(\s*([A-Za-z0-9]{2,3})\s*\)\s*$/.exec(raw);
  if (single) {
    const c = single[2].toUpperCase();
    return { name: single[1].trim() || undefined, ...(c.length === 3 ? { icao: c } : { iata: c }) };
  }
  if (/^[A-Z0-9]{2,3}$/.test(raw) && (getAirline(raw) || raw.length === 2)) {
    return raw.length === 3 ? { icao: raw } : { iata: raw };
  }
  return { name: raw };
}

/** Looks up an airline from whatever we know: ICAO, IATA, then name. */
export function resolveAirline(ref: AirlineRef | undefined) {
  if (!ref) return undefined;
  return getAirline(ref.icao) ?? (ref.iata ? getAirline(ref.iata) : undefined) ?? getAirlineByName(ref.name);
}

export interface AircraftRef {
  name?: string;
  icao?: string;
}

/** "Boeing 737-900 (B739)", " ()", "B739", "Boeing 737-900". */
export function parseAircraftRef(v: Cell): AircraftRef | undefined {
  const raw = cellText(v);
  if (!raw) return undefined;
  const m = /^(.*?)\(\s*([A-Za-z0-9]{0,4})\s*\)\s*$/.exec(raw);
  if (m) {
    const out = { name: m[1].trim() || undefined, icao: m[2].toUpperCase() || undefined };
    return out.name || out.icao ? out : undefined;
  }
  if (/^[A-Za-z0-9]{3,4}$/.test(raw)) {
    const t = getAircraftType(raw);
    if (t) return { icao: t.icao, name: t.name };
  }
  return { name: raw };
}
