import { beforeEach, expect, it } from 'vitest';
import { db, addFlight, updateFlight } from '@/lib/db';
import { mergeFlightVersions, syncOnce, type SyncRemote, type RemoteRow } from './engine';
const base = {
  id: 'flight',
  date: '2026-01-01',
  datePrecision: 'day' as const,
  from: 'KSFO',
  to: 'KORD',
  source: 'manual' as const,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(async () => {
  await Promise.all([db.flights.clear(), db.syncMeta.clear(), db.kv.clear(), db.history.clear()]);
});
it('merges independent edits and keeps related route/timing values together', () => {
  const r = mergeFlightVersions(base, { ...base, seatNumber: '14F', updatedAt: 2 }, { ...base, note: 'Loved it', updatedAt: 3 });
  expect(r.merged).toMatchObject({ seatNumber: '14F', note: 'Loved it' });
  expect(r.conflicts).toEqual([]);
  const conflict = mergeFlightVersions(
    base,
    { ...base, to: 'KJFK', depTime: '10:00', updatedAt: 5 },
    { ...base, arrTime: '20:00', updatedAt: 4 },
  );
  expect(conflict.conflicts).toEqual(['date']);
  expect(conflict.merged.to).toBe('KJFK');
  expect(conflict.merged.arrTime).toBeUndefined();
});
it('a concurrent server write is merged and retried without acknowledging an unaccepted edit', async () => {
  let row: RemoteRow = { id: base.id, data: base, updated_at: 1, deleted: false, server_updated_at: '2026-01-01T00:00:00Z' };
  const remote: SyncRemote = {
    pull: async () => [row],
    upsert: async () => {},
    markDeleted: async () => {},
    exchange: async (writes) =>
      writes.map((w) => {
        if (w.expected !== row.server_updated_at) return { accepted: false, row };
        row = { ...row, data: w.flight!, updated_at: w.flight!.updatedAt, server_updated_at: '2026-01-03T00:00:00Z' };
        return { accepted: true, row };
      }),
  };
  await syncOnce(remote, 'owner');
  await updateFlight(base.id, { seatNumber: '14F' });
  const original = remote.exchange!;
  remote.exchange = async (writes) => {
    row = { ...row, data: { ...row.data, note: 'Other device', updatedAt: 3 }, updated_at: 3, server_updated_at: '2026-01-02T00:00:00Z' };
    remote.exchange = original;
    return writes.map(() => ({ accepted: false, row }));
  };
  await expect(syncOnce(remote, 'owner')).rejects.toThrow('merged');
  expect(await db.flights.get(base.id)).toMatchObject({ seatNumber: '14F', note: 'Other device' });
  await syncOnce(remote, 'owner');
  expect(row.data).toMatchObject({ seatNumber: '14F', note: 'Other device' });
});
it('edits during an upload remain pending', async () => {
  const f = await addFlight(base);
  const remote: SyncRemote = {
    pull: async () => [],
    upsert: async () => {},
    markDeleted: async () => {},
    exchange: async (writes) => {
      await updateFlight(f.id, { note: 'Edited during upload' });
      return writes.map((w) => ({
        accepted: true,
        row: { id: f.id, data: w.flight!, updated_at: w.flight!.updatedAt, deleted: false, server_updated_at: '2026-01-01T00:00:00Z' },
      }));
    },
  };
  await syncOnce(remote, 'owner');
  const current = await db.flights.get(f.id);
  expect(current?.note).toBe('Edited during upload');
  expect((await db.syncMeta.get(f.id))?.updatedAt).not.toBe(current?.updatedAt);
});

it('a same-field conflict preserves the losing version for recovery', async () => {
  const row: RemoteRow = { id: base.id, data: base, updated_at: 1, deleted: false, server_updated_at: '2026-01-01T00:00:00Z' };
  let current = row;
  const remote: SyncRemote = { pull: async () => [current], upsert: async () => {}, markDeleted: async () => {} };
  await syncOnce(remote, 'owner');
  await updateFlight(base.id, { note: 'Local note' });
  current = { ...row, data: { ...base, note: 'Remote note' }, updated_at: Date.now() + 10000, server_updated_at: '2026-01-02T00:00:00Z' };
  await syncOnce(remote, 'owner');
  expect((await db.flights.get(base.id))?.note).toBe('Remote note');
  const conflicts = await db.history.filter((c) => !!c.conflict).toArray();
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].before[0].note).toBe('Local note');
});
