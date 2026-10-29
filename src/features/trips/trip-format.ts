/** Display text for trips: stats lines, stop labels and the share text. */
import { getAirport } from '@/data/reference';
import { airportCode } from '@/lib/flight-utils';
import { formatDuration } from '@/lib/time';
import { cityName, stopNights, tripDates, tripRoute, tripTitle, type Trip, type TripStop } from '@/lib/trips';
import type { Flight, Settings } from '@/lib/types';
import { formatDistance } from '@/features/flights/flight-logic';
import { prettyFlightNumber } from '@/features/flights/FlightRow';

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** City (or airport name / code) for an airport ident. */
export function placeName(ident: string): string {
  return getAirport(ident) ? cityName(ident) : airportCode(ident);
}

/** "5 nights", "Day trip" (two+ legs, same day) or '' (a lone leg). */
export function nightsLabel(t: Trip): string {
  if (t.nights > 0) return plural(t.nights, 'night');
  return t.flights.length > 1 ? 'Day trip' : '';
}

/** "4 flights · 5 nights · 2,441 mi". */
export function tripStatsLine(t: Trip, unit: Settings['distanceUnit']): string {
  return [plural(t.flights.length, 'flight'), nightsLabel(t), t.distanceKm > 0 ? formatDistance(t.distanceKm, unit) : '']
    .filter(Boolean)
    .join(' · ');
}

/** "SAN → DEN → BOS → SAN" (plain text, for sharing and accessible labels). */
export function routeText(t: Trip): string {
  return tripRoute(t)
    .map((s) => airportCode(s.airport))
    .join(' → ');
}

export interface StopLabel {
  kind: 'connection' | 'overnight' | 'stay';
  text: string;
  /** Secondary detail, e.g. the layover length or an airport change. */
  detail?: string;
}

/** What happens between two legs: "Connection in Denver · 1h 15m" / "4 nights in Boston". */
export function stopLabel(stop: TripStop, arriving: Flight, departing: Flight): StopLabel {
  const place = placeName(stop.airport);
  const change = arriving.to !== departing.from ? `${airportCode(arriving.to)} → ${airportCode(departing.from)}` : undefined;
  if (stop.kind === 'stay') {
    const nights = stopNights(arriving, departing);
    return { kind: 'stay', text: nights ? `${plural(nights, 'night')} in ${place}` : `A day in ${place}`, detail: change };
  }
  const overnight = stopNights(arriving, departing) > 0;
  return {
    kind: overnight ? 'overnight' : 'connection',
    text: `${overnight ? 'Overnight in' : 'Connection in'} ${place}`,
    detail: [formatDuration(stop.stayMin), change].filter(Boolean).join(' · '),
  };
}

/** Plain-text summary for the share sheet / clipboard. */
export function tripShareText(t: Trip, unit: Settings['distanceUnit']): string {
  const legs = t.flights.map((f) => {
    const date = new Date(`${f.date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    return `${date}  ${[prettyFlightNumber(f.flightNumber), `${airportCode(f.from)} → ${airportCode(f.to)}`].filter(Boolean).join('  ')}`;
  });
  return [`${tripTitle(t)} · ${tripDates(t)}`, routeText(t), tripStatsLine(t, unit), '', ...legs].join('\n');
}
