/**
 * AeroDataBox (RapidAPI) flight-by-number-and-date. Needs the user's own key
 * (settings.aeroDataBoxKey). Date-specific, so it is the most trusted provider.
 * GET /flights/number/{flightNumber}/{YYYY-MM-DD}
 */
import { normalizeFlightNumber } from '@/lib/flight-utils';
import { fetchJson, HttpError, type FetchLike } from '../http';
import { matchAircraftModel, resolveAirportIdent, toIataFlightNumber } from '../flight-number';
import type { FlightLookupResult, ProviderResult } from '../types';

export const AERODATABOX_HOST = 'aerodatabox.p.rapidapi.com';

interface AdbTime {
  utc?: string;
  local?: string;
}

interface AdbMovement {
  airport?: { icao?: string; iata?: string; name?: string; municipalityName?: string; countryCode?: string; timeZone?: string };
  scheduledTime?: AdbTime;
  revisedTime?: AdbTime;
  runwayTime?: AdbTime;
  /** Older API versions used flat fields. */
  scheduledTimeLocal?: string;
  actualTimeLocal?: string;
}

interface AdbLeg {
  number?: string;
  status?: string;
  departure?: AdbMovement;
  arrival?: AdbMovement;
  aircraft?: { reg?: string; modeS?: string; model?: string };
  airline?: { name?: string; iata?: string; icao?: string };
}

/**
 * Splits an AeroDataBox local timestamp ("2024-01-01 10:00-08:00", "2024-01-01T10:00:00+01:00")
 * into its local date and "HH:mm" wall-clock time (no time-zone conversion needed).
 */
export function parseLocalTimestamp(s: string | undefined | null): { date: string; time: string } | undefined {
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  return { date: m[1], time: `${m[2]}:${m[3]}` };
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const localOf = (m: AdbMovement | undefined) => parseLocalTimestamp(m?.scheduledTime?.local ?? m?.scheduledTimeLocal);

/** Parses the legs array into one result per leg. Malformed bodies yield []. */
export function parseAeroDataBox(body: unknown, flightNumber: string): FlightLookupResult[] {
  if (!Array.isArray(body)) return [];
  const legs = body as AdbLeg[];
  const out: FlightLookupResult[] = [];
  legs.forEach((leg, i) => {
    const dep = leg?.departure;
    const arr = leg?.arrival;
    const from = resolveAirportIdent(dep?.airport?.icao, dep?.airport?.iata);
    const to = resolveAirportIdent(arr?.airport?.icao, arr?.airport?.iata);
    if (!from || !to) return;
    const depLocal = localOf(dep);
    const arrLocal = localOf(arr);
    const model = matchAircraftModel(leg.aircraft?.model);
    const al = leg.airline;
    out.push({
      key: `aerodatabox:${from}>${to}:${i}`,
      flightNumber: normalizeFlightNumber(leg.number || flightNumber) ?? flightNumber,
      airline: al ? { icao: al.icao || undefined, iata: al.iata || undefined, name: al.name || undefined } : undefined,
      from,
      to,
      depTime: depLocal?.time,
      arrTime: arrLocal?.time,
      arrDayOffset: depLocal && arrLocal ? dayDiff(depLocal.date, arrLocal.date) : undefined,
      aircraftType: model.icao,
      aircraftName: model.name,
      registration: leg.aircraft?.reg?.trim().toUpperCase() || undefined,
      source: 'aerodatabox',
      sourceLabel: 'Scheduled flight',
      confidence: legs.length > 1 ? 0.9 : 0.95,
      dateSpecific: true,
      status: leg.status && leg.status !== 'Unknown' ? leg.status : undefined,
    });
  });
  return out;
}

export async function aeroDataBoxLookup(
  flightNumber: string,
  date: string,
  apiKey: string,
  opts: { signal?: AbortSignal; fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<ProviderResult> {
  const number = toIataFlightNumber(flightNumber);
  if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !apiKey.trim()) return { ok: false, reason: 'unsupported' };
  const url = `https://${AERODATABOX_HOST}/flights/number/${encodeURIComponent(number)}/${date}?withAircraftImage=false&withLocation=false`;
  try {
    const res = await fetchJson(url, {
      ...opts,
      headers: { 'X-RapidAPI-Key': apiKey.trim(), 'X-RapidAPI-Host': AERODATABOX_HOST },
    });
    // 204: nothing on that date. 400: outside the supported date window. 404: unknown flight.
    if (res.status === 204 || res.status === 400 || res.status === 404) return { ok: true, results: [] };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' };
    if (res.status === 429) return { ok: false, reason: 'rate-limit' };
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http' };
    return { ok: true, results: parseAeroDataBox(res.data, number) };
  } catch (e) {
    return { ok: false, reason: e instanceof HttpError ? e.kind : 'network' };
  }
}
