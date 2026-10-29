-- Run after schema.sql. Public journal settings are separate from private flight records.
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
   if k not in ('date','datePrecision','from','to','airlineIcao','airlineIata','aircraftType','tripId','tripName',
    -- Optional, owner-controlled categories (public_profiles.share): never notes or anything else.
    'depTime','arrTime','arrDayOffset','durationMin','cabinClass','seatNumber','seatType','reason','flightNumber','registration') then return false; end if;
   if k in ('arrDayOffset','durationMin') then
    if jsonb_typeof(f->k)<>'number' then return false; end if;
   elsif jsonb_typeof(f->k)<>'string' or length(f->>k)>(case k when 'tripName' then 80 when 'tripId' then 40 else 32 end) then return false; end if;
  end loop;
  if not (f ?& array['date','datePrecision','from','to']) then return false; end if;
  if (f->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (f->>'datePrecision') not in ('day','month','year') then return false; end if;
  begin
   if to_char((f->>'date')::date,'YYYY-MM-DD') <> f->>'date' then return false; end if;
  exception when others then return false; end;
  if (f->>'from') !~ '^[A-Za-z0-9-]{2,12}$' or (f->>'to') !~ '^[A-Za-z0-9-]{2,12}$' then return false; end if;
  if f ? 'tripId' and (f->>'tripId') !~ '^[A-Za-z0-9-]{1,40}$' then return false; end if;
  if f ? 'depTime' and (f->>'depTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if f ? 'arrTime' and (f->>'arrTime') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return false; end if;
  if f ? 'arrDayOffset' and (f->>'arrDayOffset') not in ('-1','0','1','2') then return false; end if;
  if f ? 'durationMin' and ((f->>'durationMin') !~ '^[1-9][0-9]{0,3}$' or (f->>'durationMin')::numeric>1500) then return false; end if;
  if f ? 'cabinClass' and (f->>'cabinClass') not in ('economy','premium','business','first','private') then return false; end if;
  if f ? 'seatType' and (f->>'seatType') not in ('window','middle','aisle') then return false; end if;
  if f ? 'seatNumber' and (f->>'seatNumber') !~ '^[0-9]{1,3}[A-Z]$' then return false; end if;
  if f ? 'reason' and (f->>'reason') not in ('leisure','business','crew','other') then return false; end if;
  if f ? 'flightNumber' and (f->>'flightNumber') !~ '^[A-Z0-9]{2,10}$' then return false; end if;
  if f ? 'registration' and (f->>'registration') !~ '^[A-Z0-9-]{2,10}$' then return false; end if;
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
-- Live journals: safe projection of the owner's cloud flights on every read.
-- Re-run this whole file for existing snapshot deployments. URLs remain unchanged.
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='public_profiles' and column_name='exact_dates') then
  alter table public.public_profiles add column exact_dates boolean not null default false;
  update public.public_profiles p set exact_dates=exists(select 1 from jsonb_array_elements(p.flights) f where f->>'datePrecision'='day');
 end if;
end $$;
-- Optional categories the owner chose to share; everything defaults to private.
create or replace function public.valid_public_share(s jsonb)
returns boolean language sql immutable set search_path=public as $$
 select jsonb_typeof(s)='object' and not exists(
  select 1 from jsonb_each(s) e
  where e.key not in ('times','cabin','seat','reason','flightNumber','registration') or jsonb_typeof(e.value)<>'boolean')
$$;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='public_profiles' and column_name='share') then
  alter table public.public_profiles add column share jsonb not null default '{}'::jsonb constraint public_profiles_share_check check (public.valid_public_share(share));
 end if;
end $$;
drop function if exists public.get_public_profile(text);
drop function if exists public.project_public_flight(jsonb, boolean);
-- Mirrored exactly by publicFlights() in src/features/public/profile.ts (the owner's preview).
create or replace function public.project_public_flight(data jsonb, exact_dates boolean, share jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb; precision text := coalesce(data->>'datePrecision','day');
 times boolean := coalesce(share->'times'='true'::jsonb,false);
 cabin boolean := coalesce(share->'cabin'='true'::jsonb,false);
 seat boolean := coalesce(share->'seat'='true'::jsonb,false);
 reason boolean := coalesce(share->'reason'='true'::jsonb,false);
 fnum boolean := coalesce(share->'flightNumber'='true'::jsonb,false);
 reg boolean := coalesce(share->'registration'='true'::jsonb,false);
 hhmm constant text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
 result=jsonb_strip_nulls(jsonb_build_object(
  'date',case when precision='year' then left(data->>'date',4)||'-01-01' when exact_dates then data->>'date' else left(data->>'date',7)||'-01' end,
  'datePrecision',case when precision='year' then 'year' when exact_dates then precision else 'month' end,
  'from',data->>'from','to',data->>'to','airlineIcao',data->>'airlineIcao','airlineIata',data->>'airlineIata','aircraftType',data->>'aircraftType',
  -- Saved trips (never suggestions): the grouping id and the name the owner gave it.
  'tripId',case when data->>'tripId' ~ '^[A-Za-z0-9-]{1,40}$' then data->>'tripId' end,
  'tripName',case when data->>'tripId' ~ '^[A-Za-z0-9-]{1,40}$' then nullif(left(trim(data->>'tripName'),80),'') end,
  -- Always shared, so time in the air matches the owner's (it reveals nothing a route doesn't).
  'durationMin',case when jsonb_typeof(data->'durationMin')='number' then
    case when (data->>'durationMin')::numeric between 1 and 1500 then round((data->>'durationMin')::numeric)::int end end
 ) || jsonb_build_object(
  -- Each category only when the owner opted in; malformed values are dropped, not the flight.
  'depTime',case when times and jsonb_typeof(data->'depTime')='string' and data->>'depTime' ~ hhmm then data->>'depTime' end,
  'arrTime',case when times and jsonb_typeof(data->'arrTime')='string' and data->>'arrTime' ~ hhmm then data->>'arrTime' end,
  'arrDayOffset',case when times and jsonb_typeof(data->'arrDayOffset')='number' then
    case when (data->>'arrDayOffset')::numeric in (-1,0,1,2) then (data->>'arrDayOffset')::numeric::int end end,
  'cabinClass',case when cabin and jsonb_typeof(data->'cabinClass')='string' and data->>'cabinClass' in ('economy','premium','business','first','private') then data->>'cabinClass' end,
  'seatType',case when seat and jsonb_typeof(data->'seatType')='string' and data->>'seatType' in ('window','middle','aisle') then data->>'seatType' end,
  'seatNumber',case when seat and jsonb_typeof(data->'seatNumber')='string' and upper(data->>'seatNumber') ~ '^[0-9]{1,3}[A-Z]$' then upper(data->>'seatNumber') end,
  'reason',case when reason and jsonb_typeof(data->'reason')='string' and data->>'reason' in ('leisure','business','crew','other') then data->>'reason' end,
  'flightNumber',case when fnum and jsonb_typeof(data->'flightNumber')='string' and upper(data->>'flightNumber') ~ '^[A-Z0-9]{2,10}$' then upper(data->>'flightNumber') end,
  'registration',case when reg and jsonb_typeof(data->'registration')='string' and upper(data->>'registration') ~ '^[A-Z0-9-]{2,10}$' then upper(data->>'registration') end
 ));
 if not public.valid_public_flights(jsonb_build_array(result)) then return null; end if;
 return result;
end $$;
create function public.get_public_profile(handle text)
returns table(slug text,display_name text,flights jsonb,published_at timestamptz,exact_dates boolean)
language sql stable security definer set search_path=public as $$
 select p.slug,p.display_name,coalesce(live.flights,'[]'::jsonb),greatest(p.published_at,live.changed_at),p.exact_dates
 from public.public_profiles p
 left join lateral (
  select jsonb_agg(public.project_public_flight(f.data,p.exact_dates,p.share) order by f.data->>'date' desc,coalesce(f.data->>'depTime','') desc,case when jsonb_typeof(f.data->'createdAt')='number' then (f.data->>'createdAt')::numeric end desc nulls last,f.id) filter (where not f.deleted and public.project_public_flight(f.data,p.exact_dates,p.share) is not null and
   case coalesce(f.data->>'datePrecision','day')
    when 'year' then left(f.data->>'date',4)<to_char(current_date,'YYYY')
    when 'month' then left(f.data->>'date',7)<to_char(current_date,'YYYY-MM')
    else f.data->>'date'<to_char(current_date,'YYYY-MM-DD') end
  ) as flights,
  -- "Updated" only reflects published flights (not private, future or deleted edits).
  max(f.server_updated_at) filter (where not f.deleted and public.project_public_flight(f.data,p.exact_dates,p.share) is not null and
   case coalesce(f.data->>'datePrecision','day')
    when 'year' then left(f.data->>'date',4)<to_char(current_date,'YYYY')
    when 'month' then left(f.data->>'date',7)<to_char(current_date,'YYYY-MM')
    else f.data->>'date'<to_char(current_date,'YYYY-MM-DD') end
  ) as changed_at
  from public.flights f where f.user_id=p.user_id
 ) live on true
 where p.slug=handle limit 1;
$$;
revoke all on function public.get_public_profile(text) from public;
grant execute on function public.get_public_profile(text) to anon,authenticated;
commit;
