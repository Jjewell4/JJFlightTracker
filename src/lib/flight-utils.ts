/** Derived information about flights (requires reference data to be loaded). */
import { getAirline, getAirlineByName, getAircraftType, getAirport } from '@/data/reference';
import { distanceKm } from './geo';
import { computeDuration } from './time';
import type { Flight, FlightInput } from './types';

/** Splits "UA 123" / "ual123" / "UA0123" into { prefix: "UA", number: "123" }. */
export function parseFlightNumber(raw: string | undefined): { prefix: string; number: string } | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, '').toUpperCase();
  // Airline designators are 2 chars (letters/digits, not both digits) or 3 letters.
  const m = /^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4})([A-Z]?)$/.exec(s);
  if (!m) return undefined;
  return { prefix: m[1], number: String(Number(m[2])) + m[3] };
}

/** Normalizes a flight number to "UA123" form ('' if unparseable input is empty). */
export function normalizeFlightNumber(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  const p = parseFlightNumber(raw);
  return p ? `${p.prefix}${p.number}` : raw.replace(/\s+/g, '').toUpperCase();
}

export function flightDistanceKm(f: Pick<Flight, 'from' | 'to' | 'distanceKm'>): number | undefined {
  if (f.distanceKm) return f.distanceKm;
  const a = getAirport(f.from);
  const b = getAirport(f.to);
  return a && b ? distanceKm(a, b) : undefined;
}

/** Display airline name for a flight. */
export function flightAirlineName(f: Pick<Flight, 'airlineIcao' | 'airlineIata' | 'airlineName'>): string | undefined {
  return getAirline(f.airlineIcao)?.name ?? getAirline(f.airlineIata)?.name ?? f.airlineName;
}

export function flightAircraftName(f: Pick<Flight, 'aircraftType' | 'aircraftName'>): string | undefined {
  return f.aircraftName ?? getAircraftType(f.aircraftType)?.name;
}

/** Airport display code: IATA if available else ident. */
export function airportCode(ident: string): string {
  return getAirport(ident)?.iata || ident;
}

export function isInternational(f: Pick<Flight, 'from' | 'to'>): boolean | undefined {
  const a = getAirport(f.from);
  const b = getAirport(f.to);
  if (!a || !b) return undefined;
  return a.country !== b.country;
}

/**
 * Fills in derived fields: airline codes from flight number/name, canonical airport idents,
 * distance and duration. Never overwrites values the user supplied (except normalizing).
 */
export function enrichFlight<T extends FlightInput | Flight>(f: T): T & FlightInput {
  const out: T & FlightInput = { ...f };
  const from = getAirport(out.from);
  const to = getAirport(out.to);
  if (from) out.from = from.ident;
  if (to) out.to = to.ident;

  if (out.flightNumber) out.flightNumber = normalizeFlightNumber(out.flightNumber);
  if (!out.airlineIcao && !out.airlineIata) {
    const prefix = parseFlightNumber(out.flightNumber)?.prefix;
    const airline = getAirline(prefix) ?? getAirlineByName(out.airlineName);
    if (airline) {
      out.airlineIcao = airline.icao;
      out.airlineIata = airline.iata || undefined;
      out.airlineName ??= airline.name;
    }
  } else {
    const airline = getAirline(out.airlineIcao) ?? getAirline(out.airlineIata);
    if (airline) {
      out.airlineIcao ??= airline.icao;
      out.airlineIata ??= airline.iata || undefined;
      out.airlineName ??= airline.name;
    }
  }

  if (out.aircraftType && !out.aircraftName) out.aircraftName = getAircraftType(out.aircraftType)?.name;

  if (from && to) out.distanceKm = Math.round(distanceKm(from, to));
  if (out.datePrecision === 'day' && out.depTime && out.arrTime) {
    const d = computeDuration({
      date: out.date,
      depTime: out.depTime,
      arrTime: out.arrTime,
      arrDayOffset: out.arrDayOffset,
      fromTz: from?.tz,
      toTz: to?.tz,
    });
    if (d) {
      out.durationMin = d.durationMin;
      out.arrDayOffset = d.arrDayOffset;
    }
  }
  return out;
}
