/** Outbound helpers for a flight: live-tracking links and calendar (.ics) export. */
import { getAirport } from '@/data/reference';
import { airportCode, flightAirlineName } from '@/lib/flight-utils';
import { estimateDurationMin } from '@/lib/geo';
import { addDays, todayLocal, zonedToUtc } from '@/lib/time';
import type { Flight } from '@/lib/types';
import { toIataFlightNumber, toIcaoCallsign } from '@/services/lookup/flight-number';
import { flightDistanceKm } from '@/lib/flight-utils';

export interface TrackingLink {
  label: string;
  url: string;
}

/** Live-tracking pages for the flight number (Flightradar24 by IATA, FlightAware by ICAO callsign). */
export function trackingLinks(f: Pick<Flight, 'flightNumber'>): TrackingLink[] {
  const links: TrackingLink[] = [];
  const iata = toIataFlightNumber(f.flightNumber);
  const icao = toIcaoCallsign(f.flightNumber);
  if (iata) links.push({ label: 'Flightradar24', url: `https://www.flightradar24.com/data/flights/${iata.toLowerCase()}` });
  if (icao) links.push({ label: 'FlightAware', url: `https://flightaware.com/live/flight/${icao}` });
  return links;
}

/** True from the day before departure through the day after, when live tracking is useful. */
export function isTrackable(f: Pick<Flight, 'date' | 'datePrecision' | 'flightNumber'>, today = todayLocal()): boolean {
  if (f.datePrecision !== 'day' || !f.flightNumber) return false;
  return f.date >= addDays(today, -1) && f.date <= addDays(today, 1);
}

const icsDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/** Folds lines to 75 octets as RFC 5545 requires (ASCII-safe approximation). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * A single-event calendar file for a day-precision flight. Times are converted to UTC using
 * each airport's time zone; without times it becomes an all-day event.
 */
export function buildIcs(f: Flight, now = Date.now()): string | undefined {
  if (f.datePrecision !== 'day') return undefined;
  const from = getAirport(f.from);
  const to = getAirport(f.to);
  const fromCode = airportCode(f.from);
  const toCode = airportCode(f.to);
  const airline = flightAirlineName(f);
  const summary = `✈ ${[f.flightNumber, `${fromCode} → ${toCode}`].filter(Boolean).join(' ')}`;
  const details = [
    airline && f.flightNumber ? `${airline} ${f.flightNumber}` : airline,
    from ? `From ${from.name} (${fromCode})` : `From ${fromCode}`,
    to ? `To ${to.name} (${toCode})` : `To ${toCode}`,
    f.seatNumber ? `Seat ${f.seatNumber}` : undefined,
    f.note,
  ].filter(Boolean) as string[];

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FlightJournal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'];
  lines.push(`UID:${f.id}@flightjournal`, `DTSTAMP:${icsDate(now)}`);
  if (f.depTime) {
    const start = zonedToUtc(f.date, f.depTime, from?.tz || undefined);
    let end: number;
    if (f.arrTime) end = zonedToUtc(addDays(f.date, f.arrDayOffset ?? 0), f.arrTime, to?.tz || undefined);
    else {
      const km = flightDistanceKm(f);
      end = start + (f.durationMin ?? (km ? estimateDurationMin(km) : 120)) * 60_000;
    }
    if (end <= start) end = start + 60 * 60_000;
    lines.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${f.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(f.date, 1).replace(/-/g, '')}`);
  }
  lines.push(`SUMMARY:${icsText(summary)}`, `LOCATION:${icsText(from ? `${from.name} (${fromCode})` : fromCode)}`, `DESCRIPTION:${icsText(details.join('\n'))}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(f: Flight): string {
  return `flight-${[f.flightNumber, airportCode(f.from), airportCode(f.to), f.date].filter(Boolean).join('-').toLowerCase()}.ics`;
}
