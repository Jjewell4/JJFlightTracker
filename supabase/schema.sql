-- Flight Log cloud sync schema.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- One row per flight per user. The full flight record lives in `data` (jsonb) so the
-- app can add fields without schema migrations. Deletes are soft (`deleted = true`)
-- so they propagate to other devices — and so a deleted flight can still be recovered
-- from the table if something goes wrong.

create table if not exists public.flights (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null,
  data       jsonb   not null,
  -- Client edit time (ms since epoch) used for last-write-wins between devices.
  updated_at bigint  not null,
  deleted    boolean not null default false,
  -- Server time of the last write; devices pull rows changed since their last sync.
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists flights_user_server_updated_idx
  on public.flights (user_id, server_updated_at);

-- Stamp every insert/update with the server clock (clients can't spoof it).
create or replace function public.flights_touch()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists flights_touch on public.flights;
create trigger flights_touch
  before insert or update on public.flights
  for each row execute function public.flights_touch();

-- Row Level Security: each signed-in user can only see and change their own rows.
alter table public.flights enable row level security;

drop policy if exists "flights: select own" on public.flights;
create policy "flights: select own" on public.flights
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "flights: insert own" on public.flights;
create policy "flights: insert own" on public.flights
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "flights: update own" on public.flights;
create policy "flights: update own" on public.flights
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- No delete policy on purpose: the app only soft-deletes, so rows can't be erased
-- from the client even by a bug. (Delete rows yourself in the dashboard if needed.)
