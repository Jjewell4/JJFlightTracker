/**
 * Flight lookup provider chain.
 *
 *   1. Offline, always: airline from the flight-number prefix + the user's own history.
 *   2. adsbdb.com typical route (free) when settings.enableAdsbdb.
 *   3. AeroDataBox date-specific schedule when settings.aeroDataBoxKey is set.
 *
 * Network providers run in parallel with a timeout, are cached in memory per
 * (provider, flight number, date) and never throw: failures degrade to history-only.
 */
import { normalizeFlightNumber, parseFlightNumber } from '@/lib/flight-utils';
import type { Flight, Settings } from '@/lib/types';
import { isOffline, type FetchLike } from './http';
import { inferAirline, toIcaoCallsign, toIataFlightNumber } from './flight-number';
import { historyLookup } from './providers/history';
import { adsbdbLookup } from './providers/adsbdb';
import { aeroDataBoxLookup } from './providers/aerodatabox';
import type { FlightLookupResult, LookupOutcome, LookupQuery, ProviderResult } from './types';

export type * from './types';
export { inferAirline, toIcaoCallsign, toIataFlightNumber, flightNumberKey, matchAircraftModel } from './flight-number';
export { historyLookup } from './providers/history';

export interface LookupContext {
  settings: Pick<Settings, 'enableAdsbdb' | 'aeroDataBoxKey'>;
  flights?: readonly Flight[];
  /** Flight being edited: excluded from the history provider. */
  excludeId?: string;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const cache = new Map<string, FlightLookupResult[]>();

export function clearLookupCache(): void {
  cache.clear();
}

async function cached(key: string, run: () => Promise<ProviderResult>): Promise<ProviderResult> {
  const hit = cache.get(key);
  if (hit) return { ok: true, results: hit };
  const res = await run();
  // Only definitive answers are cached; transient failures are retried next time.
  if (res.ok) {
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    cache.set(key, res.results);
  }
  return res;
}

const routeKey = (r: FlightLookupResult) => `${r.from}>${r.to}`;

/**
 * Orders candidates by confidence and folds lower-ranked duplicates of the same route into the
 * best one (e.g. adsbdb route + aircraft/times from history), bumping its confidence.
 */
export function mergeResults(all: FlightLookupResult[]): FlightLookupResult[] {
  const sorted = [...all].sort((a, b) => b.confidence - a.confidence);
  const kept: FlightLookupResult[] = [];
  for (const r of sorted) {
    // Distinct legs of a date-specific schedule are separate choices, never merged together.
    const twin = kept.find((k) => routeKey(k) === routeKey(r) && !(k.dateSpecific && r.dateSpecific));
    if (!twin) {
      kept.push({ ...r });
      continue;
    }
    twin.aircraftType ??= r.aircraftType;
    twin.aircraftName ??= r.aircraftType === twin.aircraftType ? r.aircraftName : undefined;
    if (!twin.depTime && !twin.arrTime && r.depTime && r.arrTime) {
      twin.depTime = r.depTime;
      twin.arrTime = r.arrTime;
      twin.arrDayOffset = r.arrDayOffset;
    }
    twin.airline = { ...r.airline, ...stripEmpty(twin.airline) };
    if (!twin.dateSpecific) {
      twin.confidence = Math.min(0.92, Math.round((twin.confidence + 0.12) * 100) / 100);
      if (twin.source === 'history' && r.source === 'adsbdb') twin.sourceLabel += ' · matches typical route';
      if (twin.source === 'adsbdb' && r.source === 'history') twin.sourceLabel = 'Typical route · matches your history';
    }
  }
  return kept;
}

function stripEmpty<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
}

/** Runs the whole chain. Never throws (aborts resolve to an outcome that callers should ignore). */
export async function lookupFlight(query: LookupQuery, ctx: LookupContext): Promise<LookupOutcome> {
  const parsed = parseFlightNumber(query.flightNumber);
  if (!parsed) return { query, flightNumber: '', results: [], status: 'invalid', message: '' };
  const flightNumber = normalizeFlightNumber(query.flightNumber)!;
  const airline = inferAirline(flightNumber);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(query.date);

  let history: FlightLookupResult[] = [];
  try {
    history = historyLookup(flightNumber, ctx.flights, { excludeId: ctx.excludeId });
  } catch {
    history = [];
  }

  const offline = isOffline();
  const net: Promise<ProviderResult>[] = [];
  const opts = { signal: ctx.signal, fetchImpl: ctx.fetchImpl, timeoutMs: ctx.timeoutMs };
  if (!offline) {
    const key = ctx.settings.aeroDataBoxKey?.trim();
    if (key && dateOk) {
      const n = toIataFlightNumber(flightNumber) ?? flightNumber;
      net.push(cached(`adb:${n}:${query.date}`, () => aeroDataBoxLookup(n, query.date, key, opts)));
    }
    if (ctx.settings.enableAdsbdb) {
      const cs = toIcaoCallsign(flightNumber);
      if (cs) net.push(cached(`adsbdb:${cs}`, () => adsbdbLookup(flightNumber, opts)));
    }
  }

  const settled = await Promise.all(net.map((p) => p.catch((): ProviderResult => ({ ok: false, reason: 'network' }))));
  const netResults = settled.flatMap((r) => (r.ok ? r.results : []));
  const netFailed = settled.length > 0 && settled.every((r) => !r.ok);
  const authFailed = settled.some((r) => !r.ok && r.reason === 'auth');

  const results = mergeResults([...netResults, ...history]).map((r) => ({
    ...r,
    airline: { ...stripEmpty(airline), ...stripEmpty(r.airline) },
  }));

  let status: LookupOutcome['status'];
  let message: string;
  const onlyHistory = results.length > 0 && results.every((r) => r.source === 'history');
  if (results.length) {
    status = 'found';
    if ((offline || netFailed) && onlyHistory) message = 'Offline — filled from your history';
    else if (results[0].dateSpecific) message = 'Found the scheduled flight';
    else if (results[0].source === 'history') message = 'Suggested from your history';
    else message = 'Typical route for this flight number';
  } else if (offline) {
    status = 'offline';
    message = "Offline — couldn't look this flight up";
  } else if (netFailed) {
    status = 'error';
    message = authFailed ? 'AeroDataBox key was rejected' : 'Lookup unavailable right now';
  } else {
    status = 'none';
    message = net.length ? 'No match found — enter the route below' : 'No saved match — enter the route below';
  }
  return { query, flightNumber, airline, results, status, message };
}
