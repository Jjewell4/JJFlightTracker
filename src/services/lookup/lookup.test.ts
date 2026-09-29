import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installReference } from '@/test/reference-fixture';
import type { Flight } from '@/lib/types';
import adsbdbUal123 from './__fixtures__/adsbdb-ual123.json';
import adsbdbUnknown from './__fixtures__/adsbdb-unknown.json';
import adbUa123 from './__fixtures__/aerodatabox-ua123.json';
import adbMultileg from './__fixtures__/aerodatabox-multileg.json';
import { flightNumberKey, inferAirline, matchAircraftModel, toIataFlightNumber, toIcaoCallsign } from './flight-number';
import { parseAdsbdb, adsbdbLookup } from './providers/adsbdb';
import { parseAeroDataBox, parseLocalTimestamp, aeroDataBoxLookup } from './providers/aerodatabox';
import { historyLookup } from './providers/history';
import { clearLookupCache, lookupFlight, mergeResults } from './index';
import { fetchJson, HttpError } from './http';

beforeAll(installReference);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let n = 0;
function flight(p: Partial<Flight>): Flight {
  n++;
  return { id: `f${n}`, date: '2023-01-01', datePrecision: 'day', from: 'KSAN', to: 'KSFO', source: 'manual', createdAt: n, updatedAt: n, ...p };
}

describe('flight number conversion', () => {
  it('converts IATA flight numbers to ICAO callsigns', () => {
    expect(toIcaoCallsign('UA123')).toBe('UAL123');
    expect(toIcaoCallsign('ua 123')).toBe('UAL123');
    expect(toIcaoCallsign('BA0012')).toBe('BAW12');
    expect(toIcaoCallsign('AS 1')).toBe('ASA1');
    expect(toIcaoCallsign('DL 1234')).toBe('DAL1234');
    expect(toIcaoCallsign('B6 915')).toBe('JBU915');
  });
  it('keeps ICAO prefixes and rejects garbage', () => {
    expect(toIcaoCallsign('UAL123')).toBe('UAL123');
    expect(toIcaoCallsign('hello')).toBeUndefined();
    expect(toIcaoCallsign('')).toBeUndefined();
    expect(toIcaoCallsign('123')).toBeUndefined();
  });
  it('converts ICAO flight numbers back to IATA', () => {
    expect(toIataFlightNumber('UAL123')).toBe('UA123');
    expect(toIataFlightNumber('UA 0123')).toBe('UA123');
  });
  it('treats IATA/ICAO forms as the same flight', () => {
    expect(flightNumberKey('UA123')).toBe(flightNumberKey('UAL 0123'));
    expect(flightNumberKey('UA123')).not.toBe(flightNumberKey('UA124'));
  });
  it('infers the airline from the prefix', () => {
    expect(inferAirline('UA 123')).toMatchObject({ icao: 'UAL', iata: 'UA', name: 'United Airlines' });
    expect(inferAirline('ZZ9')).toBeUndefined();
  });
  it('matches aircraft models to ICAO types', () => {
    expect(matchAircraftModel('Boeing 737-900').icao).toBe('B739');
    expect(matchAircraftModel('Boeing 787-9').icao).toBe('B789');
    expect(matchAircraftModel('Airbus A321 NEO').icao).toBe('A21N');
    expect(matchAircraftModel('B38M').icao).toBe('B38M');
    expect(matchAircraftModel(undefined)).toEqual({});
  });
});

describe('adsbdb provider', () => {
  it('parses a known callsign', () => {
    const [r] = parseAdsbdb(adsbdbUal123, 'UA123');
    expect(r).toMatchObject({ from: 'KSAN', to: 'KEWR', flightNumber: 'UA123', source: 'adsbdb', sourceLabel: 'Typical route', dateSpecific: false });
    expect(r.airline).toMatchObject({ icao: 'UAL', iata: 'UA' });
    expect(r.confidence).toBeLessThan(0.6);
  });
  it('handles unknown callsigns and junk', () => {
    expect(parseAdsbdb(adsbdbUnknown, 'UA123')).toEqual([]);
    expect(parseAdsbdb(null, 'UA123')).toEqual([]);
    expect(parseAdsbdb({ response: { flightroute: null } }, 'UA123')).toEqual([]);
  });
  it('requests the ICAO callsign', async () => {
    const f = vi.fn(async () => jsonResponse(adsbdbUal123));
    const res = await adsbdbLookup('UA 123', { fetchImpl: f });
    expect(f).toHaveBeenCalledWith('https://api.adsbdb.com/v0/callsign/UAL123', expect.anything());
    expect(res.ok && res.results[0].to).toBe('KEWR');
  });
  it('treats 404 unknown callsign as a definitive empty answer', async () => {
    const res = await adsbdbLookup('UA123', { fetchImpl: async () => jsonResponse(adsbdbUnknown, 404) });
    expect(res).toEqual({ ok: true, results: [] });
  });
  it('reports network failures instead of throwing', async () => {
    const res = await adsbdbLookup('UA123', {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(res).toEqual({ ok: false, reason: 'network' });
  });
});

describe('AeroDataBox provider', () => {
  it('parses local timestamps', () => {
    expect(parseLocalTimestamp('2024-01-01 10:00-08:00')).toEqual({ date: '2024-01-01', time: '10:00' });
    expect(parseLocalTimestamp('2024-01-01T07:05:00+09:00')).toEqual({ date: '2024-01-01', time: '07:05' });
    expect(parseLocalTimestamp('nope')).toBeUndefined();
  });
  it('parses a single leg', () => {
    const [r] = parseAeroDataBox(adbUa123, 'UA123');
    expect(r).toMatchObject({
      from: 'KSAN',
      to: 'KEWR',
      depTime: '06:05',
      arrTime: '14:30',
      arrDayOffset: 0,
      aircraftType: 'B739',
      registration: 'N37470',
      flightNumber: 'UA123',
      status: 'Arrived',
      dateSpecific: true,
      source: 'aerodatabox',
    });
    expect(r.confidence).toBeGreaterThan(0.9);
  });
  it('parses multiple legs with overnight offsets', () => {
    const legs = parseAeroDataBox(adbMultileg, 'UA1');
    expect(legs.map((l) => `${l.from}>${l.to}`)).toEqual(['KSFO>PHNL', 'PHNL>RJAA']);
    expect(legs[0].arrDayOffset).toBe(1);
    expect(legs[1]).toMatchObject({ depTime: '03:30', arrTime: '07:10', arrDayOffset: 1, registration: 'N78001', status: undefined });
    expect(new Set(legs.map((l) => l.key)).size).toBe(2);
  });
  it('ignores non-array bodies', () => {
    expect(parseAeroDataBox({ message: 'x' }, 'UA1')).toEqual([]);
    expect(parseAeroDataBox(null, 'UA1')).toEqual([]);
  });
  it('sends RapidAPI headers and handles 204/400/401', async () => {
    const f = vi.fn(async (..._args: unknown[]) => jsonResponse(adbUa123));
    await aeroDataBoxLookup('UAL123', '2024-03-04', ' key ', { fetchImpl: f });
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://aerodatabox.p.rapidapi.com/flights/number/UA123/2024-03-04?withAircraftImage=false&withLocation=false');
    expect(init.headers).toEqual({ 'X-RapidAPI-Key': 'key', 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' });
    expect(await aeroDataBoxLookup('UA123', '2024-03-04', 'k', { fetchImpl: async () => jsonResponse(null, 204) })).toEqual({ ok: true, results: [] });
    expect(await aeroDataBoxLookup('UA123', '1990-03-04', 'k', { fetchImpl: async () => jsonResponse({ message: 'out of range' }, 400) })).toEqual({ ok: true, results: [] });
    expect(await aeroDataBoxLookup('UA123', '2024-03-04', 'k', { fetchImpl: async () => jsonResponse({}, 401) })).toEqual({ ok: false, reason: 'auth' });
  });
});

describe('history provider', () => {
  const flights = [
    flight({ flightNumber: 'UA123', from: 'KSAN', to: 'KEWR', date: '2022-05-01', aircraftType: 'B738', depTime: '06:00', arrTime: '14:20' }),
    flight({ flightNumber: 'UAL123', from: 'KSAN', to: 'KEWR', date: '2023-07-01', aircraftType: 'B739', airlineIcao: 'UAL' }),
    flight({ flightNumber: 'UA123', from: 'KSAN', to: 'KIAH', date: '2024-01-01' }),
    flight({ flightNumber: 'UA124', from: 'KEWR', to: 'KSAN', date: '2024-01-02' }),
  ];
  it('suggests the most-flown route with the latest aircraft and times', () => {
    const res = historyLookup('ua 123', flights);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ from: 'KSAN', to: 'KEWR', aircraftType: 'B739', depTime: '06:00', arrTime: '14:20', source: 'history', sourceLabel: "You've flown this 2×" });
    expect(res[1]).toMatchObject({ from: 'KSAN', to: 'KIAH', sourceLabel: 'You flew this before' });
    expect(res[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(res[1].confidence).toBeLessThan(res[0].confidence);
  });
  it('returns nothing for unknown flight numbers or empty history', () => {
    expect(historyLookup('UA999', flights)).toEqual([]);
    expect(historyLookup('UA123', undefined)).toEqual([]);
    expect(historyLookup('???', flights)).toEqual([]);
  });
  it('excludes the flight being edited', () => {
    const res = historyLookup('UA124', flights, { excludeId: flights[3].id });
    expect(res).toEqual([]);
  });
});

describe('lookup chain', () => {
  beforeEach(() => clearLookupCache());
  afterEach(() => vi.unstubAllGlobals());

  const settings = { enableAdsbdb: true, aeroDataBoxKey: undefined };

  it('merges adsbdb with history for the same route', () => {
    const merged = mergeResults([
      ...parseAdsbdb(adsbdbUal123, 'UA123'),
      ...historyLookup('UA123', [flight({ flightNumber: 'UA123', from: 'KSAN', to: 'KEWR', aircraftType: 'B739' })]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: 'history', aircraftType: 'B739' });
    expect(merged[0].sourceLabel).toMatch(/matches typical route/);
  });

  it('ranks date-specific AeroDataBox results first and caches them', async () => {
    const f = vi.fn(async (url: string) => (url.includes('aerodatabox') ? jsonResponse(adbUa123) : jsonResponse(adsbdbUal123)));
    const ctx = { settings: { enableAdsbdb: true, aeroDataBoxKey: 'k' }, fetchImpl: f };
    const out = await lookupFlight({ flightNumber: 'UA 123', date: '2024-03-04' }, ctx);
    expect(out.status).toBe('found');
    expect(out.results).toHaveLength(1); // adsbdb folded into the scheduled flight
    expect(out.results[0]).toMatchObject({ source: 'aerodatabox', registration: 'N37470' });
    expect(out.results[0].airline?.name).toBeTruthy();
    expect(f).toHaveBeenCalledTimes(2);
    await lookupFlight({ flightNumber: 'UA123', date: '2024-03-04' }, ctx);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back to history when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const f = vi.fn();
    const out = await lookupFlight(
      { flightNumber: 'UA123', date: '2024-03-04' },
      { settings, fetchImpl: f, flights: [flight({ flightNumber: 'UA123', from: 'KSAN', to: 'KEWR' })] },
    );
    expect(f).not.toHaveBeenCalled();
    expect(out.status).toBe('found');
    expect(out.message).toBe('Offline — filled from your history');
    expect(out.results[0].airline).toMatchObject({ icao: 'UAL' });
  });

  it('degrades gracefully when the network fails', async () => {
    const out = await lookupFlight(
      { flightNumber: 'UA123', date: '2024-03-04' },
      {
        settings,
        fetchImpl: async () => {
          throw new TypeError('blocked');
        },
      },
    );
    expect(out).toMatchObject({ status: 'error', results: [], airline: { icao: 'UAL' } });
  });

  it('reports no match and invalid input', async () => {
    const none = await lookupFlight({ flightNumber: 'UA123', date: '2024-03-04' }, { settings, fetchImpl: async () => jsonResponse(adsbdbUnknown, 404) });
    expect(none.status).toBe('none');
    const invalid = await lookupFlight({ flightNumber: 'x', date: '2024-03-04' }, { settings });
    expect(invalid.status).toBe('invalid');
  });

  it('skips network providers when disabled', async () => {
    const f = vi.fn();
    const out = await lookupFlight({ flightNumber: 'UA123', date: '2024-03-04' }, { settings: { enableAdsbdb: false }, fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(out.status).toBe('none');
  });
});

describe('fetchJson', () => {
  it('times out', async () => {
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    await expect(fetchJson('https://x', { fetchImpl: hang, timeoutMs: 20 })).rejects.toEqual(new HttpError('timeout'));
  });
  it('propagates external aborts', async () => {
    const ctrl = new AbortController();
    const hang = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const p = fetchJson('https://x', { fetchImpl: hang, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });
});
