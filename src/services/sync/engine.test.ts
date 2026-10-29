import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, addFlight, deleteFlight, updateFlight, getAllFlights } from '@/lib/db';
import type { Flight } from '@/lib/types';
import { adoptLocalFlights, countPendingChanges, resetSyncState, syncOnce, type RemoteRow, type SyncRemote } from './engine';

/** In-memory stand-in for the Supabase table: server stamps every write with an increasing time. */
class FakeCloud {
  rows = new Map<string, RemoteRow>();
  private clock = Date.parse('2026-01-01T00:00:00Z');
  private stamp() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  remote(): SyncRemote {
    return {
      pull: async (since) => [...this.rows.values()].filter((r) => !since || Date.parse(r.server_updated_at) > Date.parse(since)).map((r) => structuredClone(r)),
      upsert: async (flights) => {
        for (const f of flights) this.rows.set(f.id, { id: f.id, data: structuredClone(f), updated_at: f.updatedAt, deleted: false, server_updated_at: this.stamp() });
      },
      markDeleted: async (ids, at) => {
        for (const id of ids) {
          const r = this.rows.get(id);
          if (r) this.rows.set(id, { ...r, deleted: true, updated_at: at, server_updated_at: this.stamp() });
        }
      },
    };
  }
  /** Simulates an edit made on another device that already synced. */
  editRemote(id: string, patch: Partial<Flight>, updatedAt: number) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, data: { ...r.data, ...patch, updatedAt }, updated_at: updatedAt, server_updated_at: this.stamp() });
  }
}

type Snapshot = { flights: Flight[]; meta: { id: string; updatedAt: number }[]; kv: { key: string; value: unknown }[] };
async function snapshot(): Promise<Snapshot> {
  return { flights: await db.flights.toArray(), meta: await db.syncMeta.toArray(), kv: await db.kv.toArray() };
}
async function restore(s: Snapshot) {
  await db.transaction('rw', db.flights, db.syncMeta, db.kv, async () => {
    await Promise.all([db.flights.clear(), db.syncMeta.clear(), db.kv.clear()]);
    await db.flights.bulkPut(s.flights);
    await db.syncMeta.bulkPut(s.meta);
    await db.kv.bulkPut(s.kv);
  });
}
const EMPTY: Snapshot = { flights: [], meta: [], kv: [] };

const base = { datePrecision: 'day' as const, source: 'manual' as const };
const USER = 'user-1';

let cloud: FakeCloud;
beforeEach(async () => {
  cloud = new FakeCloud();
  await restore(EMPTY);
});

describe('cloud sync engine', () => {
  it('commits a local flight while the cloud is stalled, then syncs it after reconnection', async () => {
    let release!: (rows: RemoteRow[]) => void;
    const remote = cloud.remote();
    const stalled = new Promise<RemoteRow[]>((resolve) => { release = resolve; });
    const syncing = syncOnce({ ...remote, pull: () => stalled }, USER);
    // The local DB must remain writable even while the network request is pending.
    const saved = await addFlight({ ...base, id: 'offline', date: '2026-01-01', from: 'KSAN', to: 'KSFO' });
    expect((await db.flights.get(saved.id))?.from).toBe('KSAN');
    expect(cloud.rows.size).toBe(0);
    release([]);
    await syncing;
    expect(cloud.rows.get(saved.id)?.data.from).toBe('KSAN');
    expect(await countPendingChanges()).toBe(0);
  });

  it('keeps a failed upload pending across a database reopen and retries without duplicates', async () => {
    const saved = await addFlight({ ...base, id: 'retry', date: '2026-01-01', from: 'KSAN', to: 'KSFO' });
    await expect(syncOnce({ ...cloud.remote(), upsert: async () => { throw new Error('offline'); } }, USER)).rejects.toThrow('offline');
    db.close();
    await db.open();
    expect(await db.flights.get(saved.id)).toEqual(saved);
    expect(await countPendingChanges()).toBe(1);
    await syncOnce(cloud.remote(), USER);
    await syncOnce(cloud.remote(), USER);
    expect(cloud.rows.size).toBe(1);
    expect(await countPendingChanges()).toBe(0);
  });

  it('pushes the existing log on first sync, then is idempotent', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await addFlight({ ...base, id: 'b', date: '2024-02-01', from: 'KSFO', to: 'KSAN' });
    expect(await countPendingChanges()).toBe(2);

    const r1 = await syncOnce(cloud.remote(), USER);
    expect(r1).toMatchObject({ pushed: 2, pulled: 0, deleted: 0 });
    expect(cloud.rows.size).toBe(2);
    expect(await countPendingChanges()).toBe(0);

    const r2 = await syncOnce(cloud.remote(), USER);
    expect(r2).toMatchObject({ pushed: 0, pulled: 0, deleted: 0 });
  });

  it('restores everything on a new device', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO', note: 'window seat' });
    await syncOnce(cloud.remote(), USER);

    await restore(EMPTY); // lost phone → fresh install
    const r = await syncOnce(cloud.remote(), USER);
    expect(r.pulled).toBe(1);
    const [f] = await getAllFlights();
    expect(f).toMatchObject({ id: 'a', note: 'window seat' });
    expect(await countPendingChanges()).toBe(0);
  });

  it('propagates edits and deletes between two devices', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await addFlight({ ...base, id: 'b', date: '2024-02-01', from: 'KSFO', to: 'KSAN' });
    await syncOnce(cloud.remote(), USER);
    const phone = await snapshot();

    await restore(EMPTY);
    await syncOnce(cloud.remote(), USER);
    const laptop = await snapshot();

    // Phone edits a and deletes b.
    await restore(phone);
    await updateFlight('a', { seatNumber: '12A' });
    await deleteFlight('b');
    const r = await syncOnce(cloud.remote(), USER);
    expect(r).toMatchObject({ pushed: 1, deleted: 1 });
    expect(cloud.rows.get('b')).toMatchObject({ deleted: true });
    expect(cloud.rows.get('b')!.data.from).toBe('KSFO'); // data kept for recovery

    // Laptop picks both up.
    await restore(laptop);
    await syncOnce(cloud.remote(), USER);
    const flights = await getAllFlights();
    expect(flights.map((f) => f.id)).toEqual(['a']);
    expect(flights[0].seatNumber).toBe('12A');
    expect(await countPendingChanges()).toBe(0);
  });

  it('resolves conflicting edits last-write-wins', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await syncOnce(cloud.remote(), USER);
    const local = (await db.flights.get('a'))!;

    // Remote edit is newer than the local one.
    await db.flights.put({ ...local, note: 'local', updatedAt: local.updatedAt + 10 });
    cloud.editRemote('a', { note: 'remote' }, local.updatedAt + 20);
    await syncOnce(cloud.remote(), USER);
    expect((await db.flights.get('a'))!.note).toBe('remote');

    // Local edit is newer than the remote one.
    await db.flights.put({ ...(await db.flights.get('a'))!, note: 'local2', updatedAt: local.updatedAt + 40 });
    cloud.editRemote('a', { note: 'remote2' }, local.updatedAt + 30);
    await syncOnce(cloud.remote(), USER);
    expect((await db.flights.get('a'))!.note).toBe('local2');
    expect(cloud.rows.get('a')!.data.note).toBe('local2');
  });

  it('keeps a flight deleted locally unless the cloud copy was edited afterwards', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await addFlight({ ...base, id: 'b', date: '2024-01-02', from: 'KSAN', to: 'KSFO' });
    await syncOnce(cloud.remote(), USER);
    const b = (await db.flights.get('b'))!;

    await deleteFlight('a');
    await deleteFlight('b');
    cloud.editRemote('b', { note: 'edited elsewhere' }, b.updatedAt + 1000);
    await syncOnce(cloud.remote(), USER);

    expect(cloud.rows.get('a')!.deleted).toBe(true);
    expect((await db.flights.get('b'))?.note).toBe('edited elsewhere');
    expect(cloud.rows.get('b')!.deleted).toBe(false);
  });

  it('never uploads another account’s flights without asking, then pushes them once adopted', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await syncOnce(cloud.remote(), USER);
    await resetSyncState(); // signed out

    const other = new FakeCloud();
    await expect(syncOnce(other.remote(), 'user-2')).rejects.toMatchObject({ name: 'AccountSwitchError', count: 1 });
    expect(other.rows.has('a')).toBe(false);

    await adoptLocalFlights('user-2');
    const r = await syncOnce(other.remote(), 'user-2');
    expect(r.pushed).toBe(1);
    expect(other.rows.has('a')).toBe(true);
  });

  it('adopts flights logged before ever signing in, and lets an emptied device switch freely', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    expect((await syncOnce(cloud.remote(), USER)).pushed).toBe(1);
    await resetSyncState();
    await db.flights.clear();
    const other = new FakeCloud();
    await expect(syncOnce(other.remote(), 'user-2')).resolves.toMatchObject({ pushed: 0 });
  });

  it('re-reads every row about once a week to heal anything a pull missed', async () => {
    let t = Date.parse('2026-01-01T00:00:00Z');
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    const remote = cloud.remote();
    const pull = vi.spyOn(remote, 'pull');
    await syncOnce(remote, USER, () => t);
    t += 60_000;
    await syncOnce(remote, USER, () => t); // pulls its own pushed row → cursor set
    t += 60_000;
    await syncOnce(remote, USER, () => t);
    expect(pull.mock.calls.at(-1)?.[0]).not.toBeNull();
    t += 8 * 24 * 60 * 60 * 1000;
    await syncOnce(remote, USER, () => t);
    expect(pull.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('marks identical flights already present on both sides as synced without re-pushing', async () => {
    await addFlight({ ...base, id: 'a', date: '2024-01-01', from: 'KSAN', to: 'KSFO' });
    await syncOnce(cloud.remote(), USER);
    // Same device data but sync bookkeeping lost (e.g. cleared site data then restored a backup).
    await db.syncMeta.clear();
    await db.kv.clear();
    const r = await syncOnce(cloud.remote(), USER);
    expect(r).toMatchObject({ pushed: 0, pulled: 0 });
  });
});
