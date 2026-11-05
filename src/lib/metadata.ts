import type { Flight, TripDocument } from './types';
const ORIGINS = new Set(['manual', 'schedule', 'route', 'screenshot', 'email', 'csv', 'fr24', 'estimated', 'backup']);
const FIELDS = new Set([
  'date',
  'datePrecision',
  'from',
  'to',
  'depTime',
  'arrTime',
  'arrDayOffset',
  'durationMin',
  'distanceKm',
  'flightNumber',
  'airlineIcao',
  'airlineIata',
  'airlineName',
  'aircraftType',
  'aircraftName',
  'registration',
  'seatNumber',
  'seatType',
  'cabinClass',
  'reason',
  'occasion',
  'occasion2',
  'note',
  'tripId',
  'tripName',
]);
export function readFieldSources(raw: unknown): Flight['fieldSources'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => FIELDS.has(k) && typeof v === 'string' && ORIGINS.has(v)),
  ) as Flight['fieldSources'];
}
export function readTripDocument(raw: unknown): TripDocument | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    typeof v.note !== 'string' ||
    v.note.length > 10000 ||
    typeof v.updatedAt !== 'number' ||
    !Number.isFinite(v.updatedAt)
  )
    return undefined;
  return {
    id: v.id,
    note: v.note,
    updatedAt: v.updatedAt,
    ...(typeof v.cover === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v.cover) && v.cover.length <= 250000
      ? { cover: v.cover }
      : {}),
  };
}
export const fieldLabel = (key: string) =>
  (
    ({
      depTime: 'Departure time',
      arrTime: 'Arrival time',
      arrDayOffset: 'Arrival day',
      durationMin: 'Duration',
      distanceKm: 'Distance',
      airlineIcao: 'Airline code',
      airlineIata: 'Airline code',
      airlineName: 'Airline',
      aircraftType: 'Aircraft type',
      aircraftName: 'Aircraft',
      seatNumber: 'Seat',
      seatType: 'Seat position',
      cabinClass: 'Cabin',
      occasion2: 'Second occasion',
      tripId: 'Trip',
      tripName: 'Trip name',
      flightNumber: 'Flight number',
      datePrecision: 'Date precision',
      from: 'Departure airport',
      to: 'Arrival airport',
    }) as Record<string, string>
  )[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

export function stableJson(value: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, stable(x)]),
          )
        : v;
  return JSON.stringify(stable(value));
}
