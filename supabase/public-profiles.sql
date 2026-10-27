-- Run after schema.sql. Public snapshots are separate from private flight records.
-- Anonymous visitors can fetch a known handle, never enumerate owners/private flights.
begin;
create or replace function public.valid_public_flights(items jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare f jsonb; k text;
begin
 if jsonb_typeof(items) <> 'array' or jsonb_array_length(items)>10000 then return false; end if;
 for f in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(f)<>'object' then return false; end if;
  for k in select jsonb_object_keys(f) loop
   if k not in ('date','datePrecision','from','to','airlineIcao','airlineIata','aircraftType') then return false; end if;
   if jsonb_typeof(f->k)<>'string' or length(f->>k)>32 then return false; end if;
  end loop;
  if not (f ?& array['date','datePrecision','from','to']) then return false; end if;
  if (f->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (f->>'datePrecision') not in ('day','month','year') then return false; end if;
  begin
   if to_char((f->>'date')::date,'YYYY-MM-DD') <> f->>'date' then return false; end if;
  exception when others then return false; end;
  if (f->>'from') !~ '^[A-Za-z0-9-]{2,12}$' or (f->>'to') !~ '^[A-Za-z0-9-]{2,12}$' then return false; end if;
 end loop;
 return true;
end $$;
create table if not exists public.public_profiles (
 user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
 slug text unique not null check (slug ~ '^[a-z][a-z0-9-]{1,28}[a-z0-9]$' and slug not in ('account','settings','flights','stats','map','import','welcome','password','assets','data','icons','api','admin','public','www')),
 display_name text not null check (length(trim(display_name)) between 1 and 60),
 flights jsonb not null default '[]' check (public.valid_public_flights(flights)),
 published_at timestamptz not null default now()
);
create or replace function public.public_profiles_touch() returns trigger language plpgsql set search_path=public as $$ begin new.published_at=now(); return new; end $$;
drop trigger if exists public_profiles_touch on public.public_profiles;
create trigger public_profiles_touch before insert or update on public.public_profiles for each row execute function public.public_profiles_touch();
alter table public.public_profiles enable row level security;
revoke all on public.public_profiles from anon;
grant select,insert,update,delete on public.public_profiles to authenticated;
drop policy if exists "profiles: own" on public.public_profiles;
create policy "profiles: own" on public.public_profiles for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create or replace function public.get_public_profile(handle text)
returns table(slug text,display_name text,flights jsonb,published_at timestamptz)
language sql stable security definer set search_path = public as $$
 select p.slug,p.display_name,p.flights,p.published_at from public.public_profiles p where p.slug=handle limit 1;
$$;
revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon,authenticated;
commit;
