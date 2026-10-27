// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
it('enforces durable per-user quotas, isolates users, and rolls over UTC days/months', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');`);
    const sql = await readFile(new URL('../../../supabase/screenshot-import.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const asUser = async (n: number) => db.exec(`reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000${n}',false); set role authenticated;`);
    const consume = async () => (await db.query<{ allowed: boolean }>('select public.consume_screenshot_import() as allowed')).rows[0].allowed;
    await asUser(1);
    for (let i=0;i<10;i++) expect(await consume()).toBe(true);
    expect(await consume()).toBe(false);
    await expect(db.query('select * from public.screenshot_import_usage')).rejects.toThrow();
    await asUser(2); expect(await consume()).toBe(true);
    await db.exec("reset role; update public.screenshot_import_usage set day=day-1,month_count=99 where user_id='00000000-0000-0000-0000-000000000001';");
    await asUser(1); expect(await consume()).toBe(true); expect(await consume()).toBe(false);
    await db.exec("reset role; update public.screenshot_import_usage set month=month-32, day=day-32;");
    await asUser(1); expect(await consume()).toBe(true);
    await db.exec('reset role; set role anon;');
    await expect(consume()).rejects.toThrow();
  } finally { await db.close(); }
}, 20_000);
