/**
 * Core domain types. This file is the contract shared by every feature:
 * add fields rather than renaming/removing them.
 */

export type DatePrecision = 'day' | 'month' | 'year';
export type SeatType = 'window' | 'middle' | 'aisle';
export type CabinClass = 'economy' | 'premium' | 'business' | 'first' | 'private';
export type FlightReason = 'leisure' | 'business' | 'crew' | 'other';
/** Optional "what the trip was for" tag (see src/lib/occasions.ts). */
export type FlightOccasion =
  | 'vacation'
  | 'family'
  | 'friends'
  | 'wedding'
  | 'holiday'
  | 'event'
  | 'conference'
  | 'work'
  | 'school'
  | 'moving'
  | 'other';
export type FlightSource = 'manual' | 'lookup' | 'screenshot' | 'fr24' | 'csv' | 'backup';

export interface Flight {
  /** Stable unique id (crypto.randomUUID). */
  id: string;
  /** Local departure date, YYYY-MM-DD. With precision month/year the unknown parts are 01. */
  date: string;
  datePrecision: DatePrecision;

  /** Normalized flight number, e.g. "UA123" (airline IATA/ICAO prefix + number, no spaces). */
  flightNumber?: string;
  /** Airline ICAO code (e.g. "UAL") when known – primary airline key. */
  airlineIcao?: string;
  /** Airline IATA code (e.g. "UA") when known. */
  airlineIata?: string;
  /** Airline display name as entered/imported (fallback when codes are unknown). */
  airlineName?: string;

  /** Origin airport ident (ICAO when available, e.g. "KLAX"). See Airport.ident. */
  from: string;
  /** Destination airport ident. */
  to: string;

  /** Scheduled/actual local departure time at origin, "HH:mm". */
  depTime?: string;
  /** Local arrival time at destination, "HH:mm". */
  arrTime?: string;
  /** Days between departure date and local arrival date (0 = same day, 1 = next day, -1 = previous). */
  arrDayOffset?: number;
  /** Block/flight duration in minutes. Derived from times + time zones when possible. */
  durationMin?: number;
  /** Great-circle distance in km (cached; recomputable from airports). */
  distanceKm?: number;

  /** ICAO aircraft type designator, e.g. "B738". */
  aircraftType?: string;
  /** Aircraft display name as entered/imported, e.g. "Boeing 737-800". */
  aircraftName?: string;
  /** Tail number / registration, e.g. "N12345". */
  registration?: string;

  seatNumber?: string;
  seatType?: SeatType;
  cabinClass?: CabinClass;
  reason?: FlightReason;
  /** Optional occasion tag: vacation, wedding, conference, … */
  occasion?: FlightOccasion;
  note?: string;

  /** Set when the user saves a (suggested) trip: every leg of the trip shares the id. */
  tripId?: string;
  /** Saved trip name, repeated on each leg so it syncs with the flights. */
  tripName?: string;

  source: FlightSource;
  createdAt: number;
  updatedAt: number;
}

/** Input for creating a flight (id/timestamps filled in by the repository). */
export type FlightInput = Omit<Flight, 'id' | 'createdAt' | 'updatedAt'> & Partial<Pick<Flight, 'id'>>;

export interface Airport {
  /** ICAO code when available, otherwise OurAirports ident. Unique key. */
  ident: string;
  /** IATA code or '' when none. */
  iata: string;
  name: string;
  city: string;
  /** Sub-national region code, e.g. "CA" for California ('' when unknown). */
  region: string;
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  lat: number;
  lon: number;
  /** IANA time zone, e.g. "America/Los_Angeles" ('' when unknown). */
  tz: string;
  /** 3 = large, 2 = medium, 1 = small. */
  size: 1 | 2 | 3;
  scheduled: boolean;
}

export interface Airline {
  name: string;
  /** IATA code or ''. */
  iata: string;
  /** ICAO code (unique key). */
  icao: string;
  callsign: string;
  /** Country name. */
  country: string;
  active: boolean;
  /** Curated major/current carrier (ranked first in search). */
  major?: boolean;
}

export interface AircraftType {
  name: string;
  iata: string;
  /** ICAO type designator (unique key). */
  icao: string;
}

export type Continent = 'AF' | 'AN' | 'AS' | 'EU' | 'NA' | 'OC' | 'SA';

export interface Country {
  code: string;
  name: string;
  continent: Continent;
}

export interface Settings {
  /** Home country ISO code – used for "domestic vs international". */
  homeCountry: string;
  distanceUnit: 'mi' | 'km';
  /** 12h or 24h clock display. */
  clock: '12h' | '24h';
  theme: 'system' | 'dark' | 'light';
  /** Optional AeroDataBox (RapidAPI) key for rich flight lookups. */
  aeroDataBoxKey?: string;
  /** Enable free adsbdb.com route lookups. */
  enableAdsbdb: boolean;
  /** Load airline logos from pics.avs.io (false = letter badges only). Missing = true. */
  showAirlineLogos?: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  homeCountry: 'US',
  distanceUnit: 'mi',
  clock: '12h',
  theme: 'system',
  enableAdsbdb: true,
  showAirlineLogos: true,
};

/** A flight read from a screenshot (or, later, a forwarded email) that hasn't been saved yet. */
export interface DraftLeg {
  /** YYYY-MM-DD, or '' when the year/date wasn't visible. */
  date: string;
  /** Airport codes as read (IATA/ICAO), '' when unknown. */
  from: string;
  to: string;
  flightNumber: string;
  depTime: string;
  arrTime: string;
  arrDayOffset: number | null;
  aircraftType: string;
  seatNumber: string;
}

/**
 * An import waiting in "To review": created as soon as a screenshot is chosen and read in the
 * background, so nobody has to watch a spinner. Stored on this device only (never synced).
 */
export interface ImportDraft {
  id: string;
  source: 'screenshot' | 'email';
  status: 'reading' | 'ready' | 'failed';
  createdAt: number;
  updatedAt: number;
  /** Prepared JPEG data URL, kept on this device until it has been read (for retries). */
  image?: string;
  /** Small preview for the review list. */
  thumb?: string;
  result?: { flights: DraftLeg[]; warnings: string[] };
  error?: { code: string; message: string };
  /** Indexes of `result.flights` already saved or skipped. */
  handled?: number[];
  /** Forwarded emails: the email_inbox row in Supabase, its subject and sender. */
  remoteId?: string;
  subject?: string;
  sender?: string;
}

