import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { OCCASION_REASON } from './occasions';
import { DEFAULT_SETTINGS, type Flight, type FlightInput, type FlightOccasion, type ImportDraft, type Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

/** Cloud sync bookkeeping: the version of each flight last known to match the cloud. */
export interface SyncMeta {
  id: string;
  /** `updatedAt` of the flight when it was last pushed to / pulled from the cloud. */
  updatedAt: number;
}

class FlightDB extends Dexie {
  flights!: EntityTable<Flight, 'id'>;
  kv!: EntityTable<KV, 'key'>;
  syncMeta!: EntityTable<SyncMeta, 'id'>;
  /** Screenshot imports waiting in "To review" (device-only, not synced or backed up). */
  drafts!: EntityTable<ImportDraft, 'id'>;

  constructor() {
    super('jordan-flight-tracker');
    this.version(1).stores({
      flights: 'id, date, from, to, airlineIcao, aircraftType, registration, updatedAt',
      kv: 'key',
    });
    this.version(2).stores({ syncMeta: 'id' });
    this.version(3).stores({ drafts: 'id, createdAt, status' });
  }
}

export const db = new FlightDB();

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Removes undefined/empty-string fields so records stay compact and comparable. */
function compact<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out as T;
}

export async function addFlight(input: FlightInput): Promise<Flight> {
  const now = Date.now();
  const flight = compact({ ...input, id: input.id ?? newId(), createdAt: now, updatedAt: now }) as Flight;
  await db.flights.put(flight);
  return flight;
}

export async function addFlights(inputs: FlightInput[]): Promise<Flight[]> {
  const now = Date.now();
  const flights = inputs.map((f, i) => compact({ ...f, id: f.id ?? newId(), createdAt: now + i, updatedAt: now + i }) as Flight);
  await db.flights.bulkPut(flights);
  return flights;
}

export async function updateFlight(id: string, patch: Partial<FlightInput>): Promise<void> {
  const existing = await db.flights.get(id);
  if (!existing) throw new Error(`Flight ${id} not found`);
  const merged = compact({ ...existing, ...patch, id, createdAt: existing.createdAt, updatedAt: Date.now() }) as Flight;
  await db.flights.put(merged);
}

export async function deleteFlight(id: string): Promise<void> {
  await db.flights.delete(id);
}

export async function deleteAllFlights(): Promise<void> {
  await db.flights.clear();
}

/** All flights, newest first. */
export async function getAllFlights(): Promise<Flight[]> {
  const all = await db.flights.toArray();
  return sortFlights(all);
}

/** Newest first by date, then departure time, then creation. */
export function sortFlights(flights: Flight[]): Flight[] {
  return [...flights].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.depTime ?? '').localeCompare(a.depTime ?? '') ||
      b.createdAt - a.createdAt,
  );
}

/** Live-updating list of all flights (newest first). `undefined` while loading. */
export function useFlights(): Flight[] | undefined {
  return useLiveQuery(getAllFlights, []);
}

export function useFlight(id: string | undefined): Flight | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.flights.get(id)) ?? null) : null), [id]);
}

// ---------- trips ----------
// A saved trip is just a shared `tripId` (+ `tripName`) on each leg, so it syncs with the
// flights. Every write bumps `updatedAt` like updateFlight does, so sync pushes the change.

/** Saves flights as one trip (a new tripId and the name on every leg). Returns the trip id. */
export async function saveTrip(flightIds: string[], name: string): Promise<string> {
  const tripId = newId();
  const tripName = name.trim();
  await db.transaction('rw', db.flights, async () => {
    const legs = (await db.flights.bulkGet(flightIds)).filter((f): f is Flight => !!f);
    if (!legs.length) throw new Error('None of these flights exist any more');
    const now = Date.now();
    await db.flights.bulkPut(legs.map((f) => compact({ ...f, tripId, tripName, updatedAt: now })));
  });
  return tripId;
}

async function updateTripLegs(tripId: string, patch: Pick<Flight, 'tripId' | 'tripName'>): Promise<number> {
  return db.transaction('rw', db.flights, async () => {
    const legs = await db.flights.filter((f) => f.tripId === tripId).toArray();
    const now = Date.now();
    await db.flights.bulkPut(legs.map((f) => compact({ ...f, ...patch, updatedAt: now })));
    return legs.length;
  });
}

/** Renames a saved trip (an empty name falls back to the automatic title). */
export async function renameTrip(tripId: string, name: string): Promise<void> {
  await updateTripLegs(tripId, { tripId, tripName: name.trim() });
}

/**
 * Tags flights (a trip's legs) with an occasion, or clears it. An occasion implies a reason, which
 * fills legs that have none (a wedding is leisure, a conference business).
 */
export async function setOccasion(flightIds: string[], occasion: FlightOccasion | undefined): Promise<void> {
  await db.transaction('rw', db.flights, async () => {
    const legs = (await db.flights.bulkGet(flightIds)).filter((f): f is Flight => !!f);
    const now = Date.now();
    const reason = occasion && OCCASION_REASON[occasion];
    await db.flights.bulkPut(legs.map((f) => compact({ ...f, occasion, reason: f.reason ?? reason, updatedAt: now })));
  });
}

/** Removes the trip grouping: clears tripId/tripName on its legs; the flights stay. */
export async function unsaveTrip(tripId: string): Promise<number> {
  return updateTripLegs(tripId, { tripId: undefined, tripName: undefined });
}

// ---------- settings ----------

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  // Read-modify-write in one transaction so concurrent saves can't drop each other's fields.
  await db.transaction('rw', db.kv, async () => {
    const current = await getSettings();
    await db.kv.put({ key: 'settings', value: { ...current, ...patch } });
  });
}

/** Live settings; returns defaults while loading so callers never deal with undefined. */
export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS);
}
