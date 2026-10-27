/**
 * Two-way sync between the local IndexedDB log and a cloud table.
 *
 * Local writes happen in many places (form, import, settings), so instead of hooking
 * every writer we diff against `db.syncMeta`, which records the `updatedAt` of each
 * flight the last time it matched the cloud:
 *   - flight with no meta, or meta.updatedAt ≠ flight.updatedAt → changed locally → push
 *   - meta with no flight → deleted locally → soft-delete in the cloud
 * Pulls fetch rows the server stamped since the last sync. Conflicts (both sides edited
 * since the last sync) resolve last-write-wins on `updatedAt`.
 */
import { db } from '@/lib/db';
import type { Flight } from '@/lib/types';

export interface RemoteRow {
  id: string;
  data: Flight;
  updated_at: number;
  deleted: boolean;
  /** ISO timestamp set by the server on every write. */
  server_updated_at: string;
}

export interface SyncRemote {
  /** All of the user's rows changed after `since` (ISO), or every row when null. */
  pull(since: string | null): Promise<RemoteRow[]>;
  /** Insert or update live flights. */
  upsert(flights: Flight[]): Promise<void>;
  /** Soft-delete flights by id (keeps their data in the cloud for recovery). */
  markDeleted(ids: string[], at: number): Promise<void>;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  deleted: number;
  at: number;
}

interface SyncState {
  userId: string;
  cursor: string | null;
  lastSyncAt?: number;
}

const STATE_KEY = 'sync.state';
/** Re-read a little before the cursor so rows committed out of order are never missed. */
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
const PUSH_CHUNK = 200;

export async function getSyncState(): Promise<SyncState | undefined> {
  return (await db.kv.get(STATE_KEY))?.value as SyncState | undefined;
}

/** Forget what was synced (sign-out / account switch). Local flights are kept. */
export async function resetSyncState(): Promise<void> {
  await db.transaction('rw', db.kv, db.syncMeta, async () => {
    await db.kv.delete(STATE_KEY);
    await db.syncMeta.clear();
  });
}

/** Number of local changes not yet in the cloud. */
export async function countPendingChanges(): Promise<number> {
  const [flights, metas] = await Promise.all([db.flights.toArray(), db.syncMeta.toArray()]);
  const meta = new Map(metas.map((m) => [m.id, m.updatedAt]));
  const ids = new Set(flights.map((f) => f.id));
  return flights.filter((f) => meta.get(f.id) !== f.updatedAt).length + metas.filter((m) => !ids.has(m.id)).length;
}

export async function syncOnce(remote: SyncRemote, userId: string, now: () => number = Date.now): Promise<SyncResult> {
  let state = await getSyncState();
  if (!state || state.userId !== userId) {
    // New account on this device: start from scratch so nothing is mistaken for "already synced".
    await resetSyncState();
    state = { userId, cursor: null };
  }

  // ---- pull ----
  const since = state.cursor ? new Date(Date.parse(state.cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
  const rows = await remote.pull(since);
  let cursor = state.cursor;
  for (const r of rows) if (!cursor || Date.parse(r.server_updated_at) > Date.parse(cursor)) cursor = r.server_updated_at;
  const pulled = await applyRemoteRows(rows);

  // ---- push ----
  const [flights, metas] = await Promise.all([db.flights.toArray(), db.syncMeta.toArray()]);
  const meta = new Map(metas.map((m) => [m.id, m.updatedAt]));
  const liveIds = new Set(flights.map((f) => f.id));
  const changed = flights.filter((f) => meta.get(f.id) !== f.updatedAt);
  const removed = metas.filter((m) => !liveIds.has(m.id)).map((m) => m.id);

  for (let i = 0; i < changed.length; i += PUSH_CHUNK) {
    const part = changed.slice(i, i + PUSH_CHUNK);
    await remote.upsert(part);
    await db.syncMeta.bulkPut(part.map((f) => ({ id: f.id, updatedAt: f.updatedAt })));
  }
  for (let i = 0; i < removed.length; i += PUSH_CHUNK) {
    const part = removed.slice(i, i + PUSH_CHUNK);
    await remote.markDeleted(part, now());
    // Only forget ids that are still deleted locally (a pull could have restored one meanwhile).
    await db.transaction('rw', db.flights, db.syncMeta, async () => {
      const still = await db.flights.bulkGet(part);
      await db.syncMeta.bulkDelete(part.filter((_, j) => !still[j]));
    });
  }

  const at = now();
  await db.kv.put({ key: STATE_KEY, value: { userId, cursor, lastSyncAt: at } satisfies SyncState });
  return { pulled, pushed: changed.length, deleted: removed.length, at };
}

/** Applies pulled rows to the local log; returns how many local records changed. */
async function applyRemoteRows(rows: RemoteRow[]): Promise<number> {
  if (!rows.length) return 0;
  return db.transaction('rw', db.flights, db.syncMeta, async () => {
    const ids = rows.map((r) => r.id);
    const [locals, metas] = await Promise.all([db.flights.bulkGet(ids), db.syncMeta.bulkGet(ids)]);
    const putFlights: Flight[] = [];
    const delFlights: string[] = [];
    const putMeta: { id: string; updatedAt: number }[] = [];
    const delMeta: string[] = [];

    rows.forEach((row, i) => {
      const local = locals[i];
      const meta = metas[i];
      const dirty = !!local && (!meta || meta.updatedAt !== local.updatedAt);

      if (row.deleted) {
        if (!local) {
          if (meta) delMeta.push(row.id);
        } else if (!dirty || row.updated_at >= local.updatedAt) {
          delFlights.push(row.id);
          delMeta.push(row.id);
        } // else: edited locally after the remote delete → keep; it gets pushed back.
        return;
      }

      const take = () => {
        putFlights.push({ ...row.data, id: row.id, updatedAt: row.updated_at });
        putMeta.push({ id: row.id, updatedAt: row.updated_at });
      };
      if (!local) {
        // Deleted locally and the cloud copy hasn't changed since → the delete wins (pushed later).
        if (meta && meta.updatedAt >= row.updated_at) return;
        take();
      } else if (local.updatedAt === row.updated_at) {
        // Same version on both sides (e.g. a fresh device that already had this flight).
        if (meta?.updatedAt !== row.updated_at) putMeta.push({ id: row.id, updatedAt: row.updated_at });
      } else if (!dirty || row.updated_at > local.updatedAt) {
        take();
      } // else: local edit is newer → keep; it gets pushed.
    });

    if (delFlights.length) await db.flights.bulkDelete(delFlights);
    if (putFlights.length) await db.flights.bulkPut(putFlights);
    if (delMeta.length) await db.syncMeta.bulkDelete(delMeta);
    if (putMeta.length) await db.syncMeta.bulkPut(putMeta);
    return delFlights.length + putFlights.length;
  });
}
