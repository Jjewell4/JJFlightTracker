// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
it('atomic sync rejects stale revisions and enforces account boundaries in PostgreSQL', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`,
    );
    await db.exec(await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8'));
    const migration = await readFile(new URL('../../../supabase/sync-revisions.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      `grant select,insert,update on public.flights to authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);set role authenticated;`,
    );
    const send = async (changes: unknown[]) =>
      (
        await db.query<{ result: { accepted: boolean; row: { server_updated_at: string; data: { note: string } } }[] }>(
          'select public.sync_flight_changes($1::jsonb) as result',
          [JSON.stringify(changes)],
        )
      ).rows[0].result[0];
    const first = await send([{ id: 'f', expected: null, deleted: false, flight: { id: 'f', updatedAt: 1, note: 'first' } }]);
    expect(first.accepted).toBe(true);
    const second = await send([
      { id: 'f', expected: first.row.server_updated_at, deleted: false, flight: { id: 'f', updatedAt: 2, note: 'second' } },
    ]);
    expect(second.accepted).toBe(true);
    const stale = await send([
      { id: 'f', expected: first.row.server_updated_at, deleted: false, flight: { id: 'f', updatedAt: 9999999999999, note: 'stale' } },
    ]);
    expect(stale.accepted).toBe(false);
    expect(stale.row.data.note).toBe('second');
    await db.exec(
      `reset role;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);set role authenticated;`,
    );
    expect((await db.query('select * from public.flights')).rows).toHaveLength(0);
    await expect(send([{ id: 'f', expected: second.row.server_updated_at, deleted: true }])).rejects.toThrow('revision no longer exists');
  } finally {
    await db.close();
  }
}, 20000);
