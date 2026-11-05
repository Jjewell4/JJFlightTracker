import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseRemote } from './supabase';
import type { Flight } from '@/lib/types';
import type { RemoteRow } from './engine';
it('existing schemas use conditional writes and reject an intervening update', async () => {
  const flight: Flight = {
    id: 'a',
    date: '2026-01-01',
    datePrecision: 'day',
    from: 'KSFO',
    to: 'KORD',
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
  };
  let row: RemoteRow = { id: 'a', data: flight, updated_at: 1, deleted: false, server_updated_at: '2026-01-01T00:00:00.000001+00:00' };
  let race = true;
  let conditional = 0;
  const sb = {
    rpc: () => ({ abortSignal: async () => ({ data: null, error: { code: 'PGRST202' } }) }),
    from: () => {
      let patch: Record<string, unknown> | undefined;
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq: (k: string, v: string) => {
          filters[k] = v;
          return query;
        },
        update: (p: Record<string, unknown>) => {
          patch = p;
          return query;
        },
        insert: (p: Record<string, unknown>) => {
          patch = p;
          return query;
        },
        abortSignal: () => query,
        maybeSingle: async () => {
          expect(filters.user_id).toBe('owner');
          if (!patch) return { data: structuredClone(row), error: null };
          expect(filters.server_updated_at).toBeTruthy();
          conditional++;
          if (race) {
            race = false;
            row = { ...row, data: { ...row.data, note: 'Another device' }, server_updated_at: '2026-01-01T00:00:00.000002+00:00' };
          }
          if (filters.server_updated_at !== row.server_updated_at) return { data: null, error: null };
          row = { ...row, ...patch, server_updated_at: '2026-01-02T00:00:00+00:00' } as RemoteRow;
          return { data: row, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const remote = supabaseRemote(sb, 'owner');
  const rejected = await remote.exchange!([
    { id: 'a', flight: { ...flight, seatNumber: '14F' }, deleted: false, expected: row.server_updated_at },
  ]);
  expect(rejected[0].accepted).toBe(false);
  expect(row.data.note).toBe('Another device');
  expect(row.data.seatNumber).toBeUndefined();
  const accepted = await remote.exchange!([
    { id: 'a', flight: { ...row.data, seatNumber: '14F' }, deleted: false, expected: row.server_updated_at },
  ]);
  expect(accepted[0].accepted).toBe(true);
  expect(row.data).toMatchObject({ note: 'Another device', seatNumber: '14F' });
  expect(conditional).toBe(2);
});
