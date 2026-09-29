/** Flight-number helpers: airline inference and IATA ⇄ ICAO callsign conversion (offline). */
import { getAircraftType, getAirline, getAirport, normalize, searchAircraftTypes } from '@/data/reference';
import { parseFlightNumber } from '@/lib/flight-utils';
import type { AirlineInfo } from './types';

/** Airline from a flight number prefix ("UA123" → United). Undefined when unknown. */
export function inferAirline(flightNumber: string | undefined): AirlineInfo | undefined {
  const p = parseFlightNumber(flightNumber);
  if (!p) return undefined;
  const a = getAirline(p.prefix);
  if (!a) return undefined;
  return { icao: a.icao, iata: a.iata || undefined, name: a.name };
}

/**
 * ICAO callsign as used by ADS-B / adsbdb: "UA123" → "UAL123", "BA 0012" → "BAW12".
 * 3-letter prefixes are assumed to already be ICAO. Undefined when the airline has no ICAO code.
 */
export function toIcaoCallsign(flightNumber: string | undefined): string | undefined {
  const p = parseFlightNumber(flightNumber);
  if (!p) return undefined;
  if (/^[A-Z]{3}$/.test(p.prefix)) return `${p.prefix}${p.number}`;
  const a = getAirline(p.prefix);
  if (!a?.icao || !/^[A-Z]{3}$/.test(a.icao)) return undefined;
  return `${a.icao}${p.number}`;
}

/** IATA-style flight number for schedule APIs: "UAL123" → "UA123". Falls back to the normalized input. */
export function toIataFlightNumber(flightNumber: string | undefined): string | undefined {
  const p = parseFlightNumber(flightNumber);
  if (!p) return undefined;
  if (p.prefix.length === 3) {
    const a = getAirline(p.prefix);
    if (a?.iata) return `${a.iata}${p.number}`;
  }
  return `${p.prefix}${p.number}`;
}

/** Canonical identity for comparing flight numbers across IATA/ICAO forms ("UA123" ≡ "UAL123"). */
export function flightNumberKey(flightNumber: string | undefined): string | undefined {
  const p = parseFlightNumber(flightNumber);
  if (!p) return undefined;
  const a = getAirline(p.prefix);
  return `${a?.icao || p.prefix}${p.number}`;
}

/** Resolves an airport from provider codes to our ident; falls back to the raw ICAO/IATA code. */
export function resolveAirportIdent(icao?: string | null, iata?: string | null): string | undefined {
  const a = getAirport(icao || undefined) ?? getAirport(iata || undefined);
  if (a) return a.ident;
  return (icao || iata || undefined)?.toUpperCase();
}

/** Maps a free-text model ("Boeing 737-900", "Airbus A321 NEO") to an ICAO type designator. */
export function matchAircraftModel(model: string | undefined | null): { icao?: string; name?: string } {
  if (!model?.trim()) return {};
  const direct = getAircraftType(model.trim());
  if (direct) return { icao: direct.icao, name: direct.name };
  const cleaned = model.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const q = normalize(cleaned);
  const hits = searchAircraftTypes(cleaned, 5);
  const exact = hits.find((h) => normalize(h.name).replace(/ dreamliner$/, '') === q);
  const best = exact ?? hits[0];
  return best ? { icao: best.icao, name: best.name } : { name: model.trim() };
}
