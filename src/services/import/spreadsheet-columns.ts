import type { Flight } from '@/lib/types';

/** Adding a domain field requires deciding how it appears in a full spreadsheet. */
export const SPREADSHEET_COLUMNS = {
  date: 'Date', from: 'From', to: 'To', flightNumber: 'Flight number',
  airlineName: 'Airline name', airlineIcao: 'Airline ICAO', airlineIata: 'Airline IATA',
  depTime: 'Departure time', arrTime: 'Arrival time', arrDayOffset: 'Arrival day offset',
  durationMin: 'Duration minutes', distanceKm: 'Distance km',
  aircraftType: 'Aircraft ICAO', aircraftName: 'Aircraft name', registration: 'Registration',
  seatNumber: 'Seat', seatType: 'Seat type', cabinClass: 'Cabin class', reason: 'Reason',
  occasion: 'Occasion', occasion2: 'Second occasion', note: 'Notes',
  tripId: 'Trip ID', tripName: 'Trip name', datePrecision: 'Date precision',
  fieldSources: 'Field sources (JSON)', tripDetails: 'Trip journal (JSON)',
  id: 'Flight ID', source: 'Flight source', createdAt: 'Created at (Unix ms)', updatedAt: 'Updated at (Unix ms)',
} satisfies Record<keyof Flight, string>;
export const SPREADSHEET_VERSION_HEADER = 'Window Seat export';
export const SPREADSHEET_VERSION = '1';

/** Protect formulas while distinguishing literal leading apostrophes on re-import. */
export function escapeSpreadsheetText(value: string): string {
  return /^[=+\-@\t\r\n']/.test(value) ? `'${value}` : value;
}
export function unescapeSpreadsheetText(value: string): string {
  return /^'[=+\-@\t\r\n']/.test(value) ? value.slice(1) : value;
}
