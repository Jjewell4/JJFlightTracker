/** Export flights as a Flightradar24-compatible CSV (importable again by this app or FR24 tools). */
import Papa from 'papaparse';
import { getAircraftType, getAirline, getAirport } from '@/data/reference';
import type { Flight } from '@/lib/types';
import { CABIN_CLASS_CODE, REASON_CODE, SEAT_TYPE_CODE } from './cells';

export const FR24_HEADERS = [
  'Date',
  'Flight number',
  'From',
  'To',
  'Dep time',
  'Arr time',
  'Duration',
  'Airline',
  'Aircraft',
  'Registration',
  'Seat number',
  'Seat type',
  'Flight class',
  'Flight reason',
  'Note',
  'Dep_id',
  'Arr_id',
  'Airline_id',
  'Aircraft_id',
] as const;

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

const hms = (t: string | undefined) => (t && /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : '00:00:00');

export function durationHms(min: number | undefined): string {
  if (!min || min <= 0) return '00:00:00';
  return `${pad(min / 60)}:${pad(min % 60)}:00`;
}

/** "San Diego / San Diego International (SAN/KSAN)". */
export function fr24AirportString(ident: string): string {
  const a = getAirport(ident);
  if (!a) return ident;
  return `${a.city} / ${a.name.replace(/ Airport$/, '')} (${a.iata}/${a.ident})`;
}

export function flightToFr24Row(f: Flight): string[] {
  const airline = getAirline(f.airlineIcao) ?? getAirline(f.airlineIata);
  const airlineName = f.airlineName ?? airline?.name ?? '';
  const iata = f.airlineIata ?? airline?.iata ?? '';
  const icao = f.airlineIcao ?? airline?.icao ?? '';
  const type = getAircraftType(f.aircraftType);
  const date = f.datePrecision === 'year' ? f.date.slice(0, 4) : f.datePrecision === 'month' ? f.date.slice(0, 7) : f.date;
  // FR24 uses 00:00:00 for unknown times; keep that convention.
  return [
    date,
    f.flightNumber ?? '',
    fr24AirportString(f.from),
    fr24AirportString(f.to),
    hms(f.depTime),
    hms(f.arrTime),
    durationHms(f.durationMin),
    airlineName || iata || icao ? `${airlineName} (${iata}/${icao})` : ' (/)',
    f.aircraftName || f.aircraftType ? `${f.aircraftName ?? type?.name ?? ''} (${f.aircraftType ?? ''})` : ' ()',
    f.registration ?? '',
    f.seatNumber ?? '',
    String(f.seatType ? SEAT_TYPE_CODE[f.seatType] : 0),
    String(f.cabinClass ? CABIN_CLASS_CODE[f.cabinClass] : 0),
    String(f.reason ? REASON_CODE[f.reason] : 0),
    f.note ?? '',
    '',
    '',
    '',
    '',
  ];
}

/** Oldest-first CSV text (with header, CRLF line ends like FR24). */
export function exportFr24Csv(flights: Flight[]): string {
  const sorted = [...flights].sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? ''));
  return Papa.unparse({ fields: [...FR24_HEADERS], data: sorted.map(flightToFr24Row) }, { newline: '\r\n', escapeFormulae: true });
}

export function csvFileName(now: Date = new Date()): string {
  return `flight-log-${now.toISOString().slice(0, 10)}.csv`;
}

/** Portable, readable columns; JSON remains the lossless backup format. */
export function exportSpreadsheetCsv(flights: Flight[]): string {
  const sorted = [...flights].sort((a, b) => a.date.localeCompare(b.date) || (a.depTime ?? '').localeCompare(b.depTime ?? ''));
  if (!sorted.length) return 'Date,From,To,Flight number,Airline,Departure time,Arrival time,Duration,Aircraft,Registration,Seat,Seat type,Cabin class,Reason,Notes';
  return Papa.unparse(sorted.map((f) => ({
    Date: f.datePrecision === 'year' ? f.date.slice(0, 4) : f.datePrecision === 'month' ? f.date.slice(0, 7) : f.date,
    From: f.from, To: f.to, 'Flight number': f.flightNumber ?? '',
    Airline: f.airlineName || f.airlineIcao || f.airlineIata || '',
    'Departure time': f.depTime ?? '', 'Arrival time': f.arrTime ?? '',
    Duration: f.durationMin ? `${pad(f.durationMin / 60)}:${pad(f.durationMin % 60)}` : '',
    Aircraft: f.aircraftType || f.aircraftName || '', Registration: f.registration ?? '',
    Seat: f.seatNumber ?? '', 'Seat type': f.seatType ?? '',
    'Cabin class': f.cabinClass ?? '', Reason: f.reason ?? '', Notes: f.note ?? '',
  })), { newline: '\r\n', escapeFormulae: true, columns: ['Date','From','To','Flight number','Airline','Departure time','Arrival time','Duration','Aircraft','Registration','Seat','Seat type','Cabin class','Reason','Notes'] });
}
