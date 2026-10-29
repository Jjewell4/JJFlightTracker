-- Email import: forward a booking confirmation to your personal address and its flights land in
-- To review. Safe to re-run. Run in the Supabase SQL editor (same project as cloud sync).
--
-- Tables
--   email_import_addresses  one secret address token per user (flights-<token>@windowseat.me)
--   email_senders           extra addresses allowed to forward (work, personal…); the account's
--                           own email is always allowed
--   email_inbox             what was read from each email (never the email body itself)
-- The inbound function writes with the service-role key (server-side only); users manage their
-- own rows through RLS.

create table if not exists public.email_import_addresses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.email_senders (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  created_at timestamptz not null default now(),
  primary key (user_id, email)
);

create table if not exists public.email_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null,
  received_at timestamptz not null default now(),
  subject text,
  sender text,
  status text not null default 'ready' check (status in ('ready', 'failed', 'done', 'dismissed')),
  result jsonb,
  error text,
  unique (user_id, message_id)
);
create index if not exists email_inbox_user_status on public.email_inbox (user_id, status, received_at desc);

alter table public.email_import_addresses enable row level security;
alter table public.email_senders enable row level security;
alter table public.email_inbox enable row level security;

drop policy if exists "own address" on public.email_import_addresses;
create policy "own address" on public.email_import_addresses for select using (user_id = auth.uid());

drop policy if exists "own senders read" on public.email_senders;
create policy "own senders read" on public.email_senders for select using (user_id = auth.uid());
drop policy if exists "own senders add" on public.email_senders;
create policy "own senders add" on public.email_senders for insert with check (
  user_id = auth.uid() and (select count(*) from public.email_senders s where s.user_id = auth.uid()) < 10
);
drop policy if exists "own senders remove" on public.email_senders;
create policy "own senders remove" on public.email_senders for delete using (user_id = auth.uid());

drop policy if exists "own inbox read" on public.email_inbox;
create policy "own inbox read" on public.email_inbox for select using (user_id = auth.uid());
drop policy if exists "own inbox update" on public.email_inbox;
create policy "own inbox update" on public.email_inbox for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No delete for users: the daily email limit counts these rows (status changes are enough).
drop policy if exists "own inbox delete" on public.email_inbox;

-- Users may only change an item's status (done / dismissed), not what was read.
revoke update on public.email_inbox from authenticated;
grant update (status) on public.email_inbox to authenticated;

-- Your forwarding token, created on first use.
create or replace function public.email_import_address() returns text
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select token into t from email_import_addresses where user_id = auth.uid();
  if t is null then
    -- gen_random_uuid() is built in (pgcrypto's gen_random_bytes lives outside public on Supabase).
    t := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    insert into email_import_addresses (user_id, token) values (auth.uid(), t)
      on conflict (user_id) do update set token = email_import_addresses.token
      returning token into t;
  end if;
  return t;
end $$;

-- A new token; the old address stops working (e.g. if it leaked).
create or replace function public.rotate_email_import_address() returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from email_import_addresses where user_id = auth.uid();
  return email_import_address();
end $$;

revoke all on function public.email_import_address() from public, anon;
revoke all on function public.rotate_email_import_address() from public, anon;
grant execute on function public.email_import_address() to authenticated;
grant execute on function public.rotate_email_import_address() to authenticated;
