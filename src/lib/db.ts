import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEFAULT_SETTINGS, type Flight, type FlightInput, type Settings } from './types';

interface KV {
  key: string;
  value: unknown;
}

class FlightDB extends Dexie {
  flights!: EntityTable<Flight, 'id'>;
  kv!: EntityTable<KV, 'key'>;

  constructor() {
    super('jordan-flight-tracker');
    this.version(1).stores({
      flights: 'id, date, from, to, airlineIcao, aircraftType, registration, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new FlightDB();

const newId = () =>
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
