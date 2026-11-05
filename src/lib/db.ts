import { readFieldSources, stableJson } from './metadata';
import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { enrichFlight } from './flight-utils';
import { occasionFields, occasionReason } from './occasions';
import {
  DEFAULT_SETTINGS,
  type TripDocument,
  type Flight,
  type FlightInput,
  type FlightOccasion,
  type ImportDraft,
  type Settings,
} from './types';

interface KV {
  key: string;
  value: unknown;
}

/** Cloud sync bookkeeping: the version of each flight last known to match the cloud. */
export interface SyncMeta {
  id: string;
  /** `updatedAt` of the flight when it was last pushed to / pulled from the cloud. */
  updatedAt: number;
  base?: Flight;
  serverStamp?: string;
}

export interface JournalChange {
  id: string;
  at: number;
  label: string;
  owner?: string;
  before: Flight[];
  after: Flight[];
  undone?: boolean;
  conflict?: boolean;
}

class FlightDB extends Dexie {
  flights!: EntityTable<Flight, 'id'>;
  kv!: EntityTable<KV, 'key'>;
  history!: EntityTable<JournalChange, 'id'>;
  trips!: EntityTable<TripDocument, 'id'>;
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
    this.version(4).stores({ history: 'id, at' });
    this.version(5).stores({ trips: 'id, updatedAt' });
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

/** Only record changed values, so later imports can protect a user's corrections. */
export function attributed(input: Flight, before?: Flight, origin: NonNullable<Flight['fieldSources']>[string] = 'manual'): Flight {
  const sources = { ...before?.fieldSources, ...input.fieldSources };
  for (const [key, value] of Object.entries(input)) {
    if (['id', 'createdAt', 'updatedAt', 'source', 'fieldSources'].includes(key)) continue;
    if (JSON.stringify(value) !== JSON.stringify(before?.[key as keyof Flight])) sources[key] = input.fieldSources?.[key] ?? origin;
  }
  return { ...input, fieldSources: readFieldSources(sources) };
}

function manualSources(f: Flight, keys: string[]): Flight['fieldSources'] {
  return readFieldSources({ ...f.fieldSources, ...Object.fromEntries(keys.map(k => [k, 'manual'])) });
}

export async function recordChange(label: string, before: Flight[], after: Flight[], conflict = false): Promise<void> {
  const owner = (await db.kv.get('sync.owner'))?.value as string | undefined;
  const last = await db.history.orderBy('at').last();
  await db.history.put({ id: newId(), at: Math.max(Date.now(), (last?.at ?? 0) + 1), label, before, after, owner, conflict });
}

/** Atomic writes and recovery snapshots. Local changes never wait for the network. */
export async function writeFlights(label: string, flights: Flight[], remove: string[] = []): Promise<void> {
  if (!flights.length && !remove.length) return;
  await db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const ids = [...new Set([...flights.map((f) => f.id), ...remove])];
    const before = (await db.flights.bulkGet(ids)).filter((f): f is Flight => !!f);
    await recordChange(label, before, flights);
    await db.flights.bulkDelete(remove);
    await db.flights.bulkPut(flights);
    for (const f of flights)
      if (f.tripDetails && f.tripDetails.id === f.tripId) {
        const doc = await db.trips.get(f.tripId);
        if (!doc || doc.updatedAt <= f.tripDetails.updatedAt) await db.trips.put(f.tripDetails);
      }
  });
}

export async function addFlight(input: FlightInput): Promise<Flight> {
  return (await addFlights([input]))[0];
}
export async function addFlights(inputs: FlightInput[]): Promise<Flight[]> {
  const now = Date.now();
  const flights = inputs.map((f, i) =>
    attributed(
      compact({ ...f, id: f.id ?? newId(), createdAt: now + i, updatedAt: now + i }) as Flight,
      undefined,
      f.source === 'lookup' ? 'schedule' : f.source,
    ),
  );
  await writeFlights(flights.length === 1 ? 'Add flight' : 'Add flights', flights);
  return flights;
}

export async function updateFlight(id: string, patch: Partial<FlightInput>): Promise<void> {
  await bulkUpdateFlights([id], patch, 'Edit flight');
}
export async function bulkUpdateFlights(ids: string[], patch: Partial<FlightInput>, label = 'Edit flights'): Promise<void> {
  await db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const before = (await db.flights.bulkGet([...new Set(ids)])).filter((f): f is Flight => !!f);
    if (!before.length) throw new Error('These flights no longer exist');
    const destination = patch.tripId
      ? (await db.flights.filter((f) => f.tripId === patch.tripId && !!f.tripDetails).first())?.tripDetails
      : undefined;
    const after = before.map((f) => {
      const applied = 'tripId' in patch && patch.tripId !== f.tripId ? { ...patch, tripDetails: destination } : patch;
      const sources = { ...f.fieldSources };
      for (const k of Object.keys(patch))
        if (k !== 'fieldSources' && JSON.stringify(patch[k as keyof FlightInput]) !== JSON.stringify(f[k as keyof Flight]))
          sources[k] = patch.fieldSources?.[k] ?? 'manual';
      const merged = {
        ...f,
        ...applied,
        fieldSources: readFieldSources(sources),
        id: f.id,
        createdAt: f.createdAt,
        updatedAt: Math.max(Date.now(), f.updatedAt + 1),
      };
      if ('aircraftType' in patch && patch.aircraftType !== f.aircraftType && !('aircraftName' in patch)) merged.aircraftName = undefined;
      const timingChanged = ['date', 'from', 'to', 'depTime', 'arrTime', 'arrDayOffset'].some(
        (k) => k in patch && patch[k as keyof FlightInput] !== f[k as keyof Flight],
      );
      if (timingChanged) {
        merged.durationMin = undefined;
        merged.distanceKm = undefined;
      }
      const enriched = enrichFlight(merged);
      if (!timingChanged) {
        enriched.durationMin = merged.durationMin;
        enriched.distanceKm = merged.distanceKm;
        enriched.arrDayOffset = merged.arrDayOffset;
      }
      return compact(enriched) as Flight;
    });
    await writeFlights(label, after);
  });
}
export async function deleteFlights(ids: string[]): Promise<void> {
  await writeFlights('Delete flights', [], ids);
}
export async function deleteFlight(id: string): Promise<void> {
  await deleteFlights([id]);
}
export async function deleteAllFlights(): Promise<void> {
  await deleteFlights((await db.flights.toArray()).map((f) => f.id));
}

const sameContent = (a: Flight | undefined, b: Flight | undefined) => {
  const clean = (f: Flight | undefined) =>
    f &&
    Object.fromEntries(
      Object.entries(f)
        .filter(([k]) => k !== 'updatedAt')
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  return stableJson(clean(a)) === stableJson(clean(b));
};
/** Refuses to overwrite edits made after the action being undone. */
export async function undoChange(id: string): Promise<void> {
  await db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const change = await db.history.get(id);
    const owner = (await db.kv.get('sync.owner'))?.value as string | undefined;
    if (!change || change.undone || change.owner !== owner) throw new Error('This change is no longer available');
    const ids = [...new Set([...change.before, ...change.after].map((f) => f.id))];
    const current = await db.flights.bulkGet(ids);
    if (
      ids.some(
        (fid, i) =>
          !sameContent(
            current[i],
            change.after.find((f) => f.id === fid),
          ),
      )
    )
      throw new Error('A flight changed since this action. Review its current details before restoring an older version.');
    await writeFlights(
      `Restore: ${change.label}`,
      change.before.map((f) => ({
        ...f,
        ...(f.tripDetails ? { tripDetails: { ...f.tripDetails, updatedAt: Date.now() } } : {}),
        updatedAt: Math.max(Date.now(), (current[ids.indexOf(f.id)]?.updatedAt ?? f.updatedAt) + 1),
      })),
      ids.filter((fid) => !change.before.some((f) => f.id === fid)),
    );
    await db.history.update(id, { undone: true });
  });
}

/** All flights, newest first. */
export async function getAllFlights(): Promise<Flight[]> {
  const all = await db.flights.toArray();
  return sortFlights(all);
}

/** Newest first by date, then departure time, then creation. */
export function sortFlights(flights: Flight[]): Flight[] {
  return [...flights].sort(
    (a, b) => b.date.localeCompare(a.date) || (b.depTime ?? '').localeCompare(a.depTime ?? '') || b.createdAt - a.createdAt,
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
  await db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const legs = (await db.flights.bulkGet(flightIds)).filter((f): f is Flight => !!f);
    if (!legs.length) throw new Error('None of these flights exist any more');
    const now = Date.now();
    await writeFlights(
      'Group trip',
      legs.map((f) => compact({ ...f, tripId, tripName, fieldSources: manualSources(f, ['tripId','tripName']), tripDetails: undefined, updatedAt: Math.max(now, f.updatedAt + 1) })),
    );
  });
  return tripId;
}

async function updateTripLegs(tripId: string, patch: Pick<Flight, 'tripId' | 'tripName' | 'tripDetails'>): Promise<number> {
  return db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const legs = await db.flights.filter((f) => f.tripId === tripId).toArray();
    const now = Date.now();
    await writeFlights(
      'Edit trip',
      legs.map((f) => compact({ ...f, ...patch, fieldSources: manualSources(f, Object.keys(patch)), updatedAt: Math.max(now, f.updatedAt + 1) })),
    );
    return legs.length;
  });
}

/** Renames a saved trip (an empty name falls back to the automatic title). */
export async function renameTrip(tripId: string, name: string): Promise<void> {
  await updateTripLegs(tripId, { tripId, tripName: name.trim() });
}

/**
 * Tags flights (a trip's legs) with up to two occasions, or clears them (an empty list). The
 * occasions imply a reason, which fills legs that have none (a wedding is leisure).
 */
export async function setOccasions(flightIds: string[], occasions: readonly FlightOccasion[]): Promise<void> {
  await db.transaction('rw', db.flights, db.history, db.kv, db.trips, async () => {
    const legs = (await db.flights.bulkGet(flightIds)).filter((f): f is Flight => !!f);
    const now = Date.now();
    const fields = occasionFields(occasions);
    const reason = occasionReason(occasions);
    await writeFlights(
      'Change occasions',
      legs.map((f) => compact({ ...f, ...fields, fieldSources: manualSources(f, Object.keys(fields)), reason: f.reason ?? reason, updatedAt: Math.max(now, f.updatedAt + 1) })),
    );
  });
}

/** Sets (or clears) the occasions on every leg of a saved trip. */
export async function setTripOccasions(tripId: string, occasions: readonly FlightOccasion[]): Promise<void> {
  const ids = (await db.flights.filter((f) => f.tripId === tripId).toArray()).map((f) => f.id);
  await setOccasions(ids, occasions);
}

/** Removes the trip grouping: clears tripId/tripName on its legs; the flights stay. */
export async function unsaveTrip(tripId: string): Promise<number> {
  return updateTripLegs(tripId, { tripId: undefined, tripName: undefined, tripDetails: undefined });
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

/** Independent trip document; mirrored onto legs so existing cloud/export transports preserve it. */
export async function saveTripDocument(tripId: string, patch: Pick<TripDocument, 'note' | 'cover'>): Promise<void> {
  await db.transaction('rw', db.flights, db.trips, db.history, db.kv, async () => {
    const legs = await db.flights.filter((f) => f.tripId === tripId).toArray();
    if (!legs.length) throw new Error('Save the trip before adding a journal entry');
    if (
      patch.note.length > 10000 ||
      (patch.cover && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(patch.cover) || patch.cover.length > 250000))
    )
      throw new Error('Trip image or note is too large');
    const document: TripDocument = { id: tripId, note: patch.note, cover: patch.cover, updatedAt: Date.now() };
    await writeFlights(
      'Edit trip journal',
      legs.map((f) => ({ ...f, tripDetails: document, updatedAt: Math.max(Date.now(), f.updatedAt + 1) })),
    );
  });
}
