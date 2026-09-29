/**
 * adsbdb.com callsign → route (free, no key). Returns the *current typical* route for a
 * callsign, not what flew on a particular historical date, so it is labelled "Typical route".
 * Docs: https://www.adsbdb.com/ — GET /v0/callsign/{ICAO callsign}.
 */
import { normalizeFlightNumber } from '@/lib/flight-utils';
import { fetchJson, HttpError, type FetchLike } from '../http';
import { resolveAirportIdent, toIcaoCallsign } from '../flight-number';
import type { FlightLookupResult, ProviderResult } from '../types';

export const ADSBDB_BASE = 'https://api.adsbdb.com/v0';

interface AdsbdbAirport {
  iata_code?: string | null;
  icao_code?: string | null;
  name?: string | null;
  municipality?: string | null;
  country_iso_name?: string | null;
  latitude?: number;
  longitude?: number;
}

interface AdsbdbFlightroute {
  callsign?: string;
  callsign_icao?: string | null;
  callsign_iata?: string | null;
  airline?: { name?: string; icao?: string; iata?: string | null; country?: string; callsign?: string } | null;
  origin?: AdsbdbAirport | null;
  destination?: AdsbdbAirport | null;
}

/** Parses an adsbdb callsign response body. Unknown callsigns and malformed bodies yield []. */
export function parseAdsbdb(body: unknown, flightNumber: string): FlightLookupResult[] {
  const response = (body as { response?: unknown } | null)?.response;
  if (!response || typeof response !== 'object') return []; // e.g. "unknown callsign"
  const route = (response as { flightroute?: AdsbdbFlightroute | null }).flightroute;
  if (!route?.origin || !route.destination) return [];
  const from = resolveAirportIdent(route.origin.icao_code, route.origin.iata_code);
  const to = resolveAirportIdent(route.destination.icao_code, route.destination.iata_code);
  if (!from || !to || from === to) return [];
  const al = route.airline;
  return [
    {
      key: `adsbdb:${from}>${to}`,
      flightNumber: normalizeFlightNumber(route.callsign_iata || flightNumber) ?? flightNumber,
      airline: al ? { icao: al.icao || undefined, iata: al.iata || undefined, name: al.name || undefined } : undefined,
      from,
      to,
      source: 'adsbdb',
      sourceLabel: 'Typical route',
      confidence: 0.5,
      dateSpecific: false,
    },
  ];
}

export async function adsbdbLookup(
  flightNumber: string,
  opts: { signal?: AbortSignal; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ProviderResult> {
  const callsign = toIcaoCallsign(flightNumber);
  if (!callsign) return { ok: false, reason: 'unsupported' };
  try {
    const res = await fetchJson(`${ADSBDB_BASE}/callsign/${encodeURIComponent(callsign)}`, opts);
    // adsbdb answers unknown callsigns with 404 + { response: "unknown callsign" }.
    if (res.status === 404 || res.status === 204) return { ok: true, results: [] };
    if (res.status === 429) return { ok: false, reason: 'rate-limit' };
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http' };
    return { ok: true, results: parseAdsbdb(res.data, flightNumber) };
  } catch (e) {
    return { ok: false, reason: e instanceof HttpError ? e.kind : 'network' };
  }
}
