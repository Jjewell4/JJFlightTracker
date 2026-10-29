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
      new URL('../../../supabase/schema.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    'grant select,insert,update on public.flights to authenticated',
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
  await db.exec(
    `insert into public.flights(id,data,updated_at) values ('first','{"date":"2024-01-14","datePrecision":"day","from":"KSAN","to":"KLAX","note":"secret","seatNumber":"12A"}',1)`,
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
    await db.query<Record<string, unknown>>(
      "select * from public.get_public_profile('jordan')",
    )
  ).rows;
  assert.equal(shared.length, 1);
  assert(!('user_id' in shared[0]));
  assert.deepEqual(shared[0].flights, [
    { date: '2024-01-01', datePrecision: 'month', from: 'KSAN', to: 'KLAX' },
  ]);
  await assert.rejects(() => db.query('select * from public.flights'));
  await as('00000000-0000-0000-0000-000000000001');
  await db.exec(
    `update public.flights set data=jsonb_set(data,'{to}','"KSFO"') where id='first'; insert into public.flights(id,data,updated_at) values ('second','{"date":"2024-02-01","from":"KLAX","to":"KSAN"}',2),('future','{"date":"2999-01-01","from":"KLAX","to":"KSAN"}',3);`,
  );
  await as('', 'anon');
  const latest = (
    await db.query<{ flights: Array<{ to: string }> }>(
      "select flights from public.get_public_profile('jordan')",
    )
  ).rows[0].flights;
  assert.equal(latest.length, 2);
  assert(latest.some((f) => f.to === 'KSFO'));
  await as('00000000-0000-0000-0000-000000000001');
  await db.exec(
    "update public.flights set deleted=true where id='first'; update public.public_profiles set exact_dates=true where slug='jordan'",
  );
  await as('', 'anon');
  const afterDelete = (
    await db.query<{ flights: Array<{ datePrecision: string }> }>(
      "select flights from public.get_public_profile('jordan')",
    )
  ).rows[0].flights;
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].datePrecision, 'day');
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
    (
      await db.query<Record<string, unknown>>(
        "select * from public.get_public_profile('jordan')",
      )
    ).rows.length,
    0,
  );
  await db.close();
}, 30000);

it('upgrades existing snapshot journals without changing URLs or exact-date preferences, and can be rerun', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$; insert into auth.users values ('00000000-0000-0000-0000-000000000001');`);
    await db.exec(await readFile(new URL('../../../supabase/schema.sql', import.meta.url),'utf8'));
    const sql=await readFile(new URL('../../../supabase/public-profiles.sql', import.meta.url),'utf8');
    await db.exec(sql.split('-- Live journals:')[0]+'commit;');
    await db.exec(`insert into public.public_profiles(user_id,slug,display_name,flights) values ('00000000-0000-0000-0000-000000000001','jordan','Jordan','[{"date":"2024-01-14","datePrecision":"day","from":"KSFO","to":"KJFK"}]'); insert into public.flights(user_id,id,data,updated_at) values ('00000000-0000-0000-0000-000000000001','current','{"date":"2024-02-15","datePrecision":"day","from":"KSAN","to":"KLAX"}',1);`);
    await db.exec(sql);
    await db.exec(sql);
    const row=(await db.query<{slug:string;exact_dates:boolean;flights:Array<{from:string;date:string}>}>("select * from public.get_public_profile('jordan')")).rows[0];
    assert.equal(row.slug,'jordan');assert.equal(row.exact_dates,true);
    assert.equal(row.flights[0].from,'KSAN');assert.equal(row.flights[0].date,'2024-02-15');
  } finally {await db.close();}
},30000);

it('shares saved trip ids and names, and nothing else new', async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values ('00000000-0000-0000-0000-000000000001');`,
  );
  await db.exec(await readFile(new URL('../../../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../../supabase/public-profiles.sql', import.meta.url), 'utf8'));
  await db.exec(
    `insert into public.public_profiles(user_id,slug,display_name) values ('00000000-0000-0000-0000-000000000001','jordan','Jordan'); insert into public.flights(user_id,id,data,updated_at) values ('00000000-0000-0000-0000-000000000001','a','{"date":"2024-01-14","datePrecision":"day","from":"KSAN","to":"KLAX","tripId":"t-1","tripName":"Weekend in LA","note":"secret"}',1),('00000000-0000-0000-0000-000000000001','b','{"date":"2024-01-16","datePrecision":"day","from":"KLAX","to":"KSAN","tripId":"bad id!","tripName":"x"}',2);`,
  );
  const flights = (await db.query<{ flights: Record<string, string>[] }>("select flights from public.get_public_profile('jordan')")).rows[0].flights;
  const byFrom = Object.fromEntries(flights.map((f) => [f.from, f]));
  assert.equal(byFrom.KSAN.tripId, 't-1');
  assert.equal(byFrom.KSAN.tripName, 'Weekend in LA');
  assert.equal(byFrom.KSAN.note, undefined);
  assert.equal(byFrom.KLAX.tripId, undefined);
  assert.equal(byFrom.KLAX.tripName, undefined);
  await db.close();
}, 30000);
