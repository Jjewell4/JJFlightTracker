// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { it } from 'vitest';
it('enforces public-profile ownership, privacy, handles and revocation in PostgreSQL', async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`,
  );
  await db.exec(
    await readFile(
      new URL('../../../supabase/public-profiles.sql', import.meta.url),
      'utf8',
    ),
  );
  const as = async (id: string, role = 'authenticated') =>
    db.exec(
      `reset role; select set_config('request.jwt.claim.sub','${id}',false); set role ${role};`,
    );
  await as('00000000-0000-0000-0000-000000000001');
  await db.exec(
    `insert into public.public_profiles(slug,display_name,flights) values ('jordan','Jordan','[{"date":"2024-01-01","datePrecision":"month","from":"KSAN","to":"KLAX"}]');`,
  );
  await as('00000000-0000-0000-0000-000000000002');
  assert.equal(
    (await db.query('select * from public.public_profiles')).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "update public.public_profiles set display_name='stolen' where slug='jordan' returning *",
      )
    ).rows.length,
    0,
  );
  await assert.rejects(() =>
    db.exec(
      "insert into public.public_profiles(slug,display_name) values('jordan','Taken')",
    ),
  );
  await as('', 'anon');
  await assert.rejects(() => db.query('select * from public.public_profiles'));
  const shared = (
    await db.query<Record<string, unknown>>("select * from public.get_public_profile('jordan')")
  ).rows;
  assert.equal(shared.length, 1);
  assert(!('user_id' in shared[0]));
  assert.equal(
    (await db.query("select * from public.get_public_profile('missing')")).rows
      .length,
    0,
  );
  await as('00000000-0000-0000-0000-000000000001');
  await assert.rejects(() =>
    db.exec(
      `update public.public_profiles set flights='[{"date":"2024-01-01","datePrecision":"day","from":"KSAN","to":"KLAX","note":"secret"}]'`,
    ),
  );
  await assert.rejects(() =>
    db.exec(
      `update public.public_profiles set flights='[{"date":"2024-02-31","datePrecision":"day","from":"KSAN","to":"KLAX"}]'`,
    ),
  );
  await db.exec("delete from public.public_profiles where slug='jordan'");
  await as('', 'anon');
  assert.equal(
    (await db.query<Record<string, unknown>>("select * from public.get_public_profile('jordan')")).rows
      .length,
    0,
  );
  await db.close();
}, 30000);
