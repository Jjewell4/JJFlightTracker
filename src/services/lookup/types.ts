/** Normalized flight lookup contract shared by all providers. */

export type LookupSource = 'history' | 'adsbdb' | 'aerodatabox';

export interface AirlineInfo {
  icao?: string;
  iata?: string;
  name?: string;
}

/** One candidate answer for "what was flight X on date Y?". */
export interface FlightLookupResult {
  /** Stable key (provider + route + leg) for React lists. */
  key: string;
  /** Normalized flight number, e.g. "UA123". */
  flightNumber: string;
  airline?: AirlineInfo;
  /** Origin airport ident (ICAO when known). */
  from?: string;
  /** Destination airport ident. */
  to?: string;
  /** Local departure time "HH:mm". */
  depTime?: string;
  /** Local arrival time "HH:mm". */
  arrTime?: string;
  /** Local arrival date minus local departure date, when known. */
  arrDayOffset?: number;
  /** ICAO aircraft type designator. */
  aircraftType?: string;
  /** Aircraft display name, e.g. "Boeing 737-900". */
  aircraftName?: string;
  registration?: string;
  source: LookupSource;
  /** Short human label, e.g. "Your history · 3 flights" or "Typical route". */
  sourceLabel: string;
  /** 0–1. ≥0.6 is considered safe to auto-fill empty fields. */
  confidence: number;
  /** True when the data is specific to the requested date (not a typical/historical pattern). */
  dateSpecific: boolean;
  /** Provider flight status, e.g. "Arrived". */
  status?: string;
}

export interface LookupQuery {
  /** Any user-entered form: "UA 123", "ual123". */
  flightNumber: string;
  /** YYYY-MM-DD local departure date. */
  date: string;
}

export type LookupStatus = 'found' | 'none' | 'offline' | 'error' | 'invalid';

export interface LookupOutcome {
  query: LookupQuery;
  /** Normalized flight number ("UA123") or '' when invalid. */
  flightNumber: string;
  /** Airline inferred from the flight number prefix (offline). */
  airline?: AirlineInfo;
  /** Ranked candidates, best first. */
  results: FlightLookupResult[];
  status: LookupStatus;
  /** Quiet one-line status for the UI. */
  message: string;
}

/** Result of a single network provider call. `ok: false` means the provider could not answer (network, auth…). */
export type ProviderResult =
  | { ok: true; results: FlightLookupResult[] }
  | { ok: false; reason: 'offline' | 'timeout' | 'network' | 'aborted' | 'auth' | 'rate-limit' | 'http' | 'parse' | 'unsupported' };
