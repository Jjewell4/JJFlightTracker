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
   if k not in ('date','datePrecision','from','to','airlineIcao','airlineIata','aircraftType','tripId','tripName') then return false; end if;
   if jsonb_typeof(f->k)<>'string' or length(f->>k)>(case k when 'tripName' then 80 when 'tripId' then 40 else 32 end) then return false; end if;
  end loop;
  if not (f ?& array['date','datePrecision','from','to']) then return false; end if;
  if (f->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (f->>'datePrecision') not in ('day','month','year') then return false; end if;
  begin
   if to_char((f->>'date')::date,'YYYY-MM-DD') <> f->>'date' then return false; end if;
  exception when others then return false; end;
  if (f->>'from') !~ '^[A-Za-z0-9-]{2,12}$' or (f->>'to') !~ '^[A-Za-z0-9-]{2,12}$' then return false; end if;
  if f ? 'tripId' and (f->>'tripId') !~ '^[A-Za-z0-9-]{1,40}$' then return false; end if;
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
create or replace function public.project_public_flight(data jsonb, exact_dates boolean)
returns jsonb language plpgsql immutable set search_path=public as $$
declare result jsonb; precision text := coalesce(data->>'datePrecision','day');
begin
 result=jsonb_strip_nulls(jsonb_build_object(
  'date',case when precision='year' then left(data->>'date',4)||'-01-01' when exact_dates then data->>'date' else left(data->>'date',7)||'-01' end,
  'datePrecision',case when precision='year' then 'year' when exact_dates then precision else 'month' end,
  'from',data->>'from','to',data->>'to','airlineIcao',data->>'airlineIcao','airlineIata',data->>'airlineIata','aircraftType',data->>'aircraftType',
  -- Saved trips (never suggestions): the grouping id and the name the owner gave it.
  'tripId',case when data->>'tripId' ~ '^[A-Za-z0-9-]{1,40}$' then data->>'tripId' end,
  'tripName',case when data->>'tripId' ~ '^[A-Za-z0-9-]{1,40}$' then nullif(left(trim(data->>'tripName'),80),'') end
 ));
 if not public.valid_public_flights(jsonb_build_array(result)) then return null; end if;
 return result;
end $$;
drop function if exists public.get_public_profile(text);
create function public.get_public_profile(handle text)
returns table(slug text,display_name text,flights jsonb,published_at timestamptz,exact_dates boolean)
language sql stable security definer set search_path=public as $$
 select p.slug,p.display_name,coalesce(live.flights,'[]'::jsonb),greatest(p.published_at,live.changed_at),p.exact_dates
 from public.public_profiles p
 left join lateral (
  select jsonb_agg(public.project_public_flight(f.data,p.exact_dates) order by f.data->>'date' desc,f.id) filter (where not f.deleted and public.project_public_flight(f.data,p.exact_dates) is not null and
   case coalesce(f.data->>'datePrecision','day')
    when 'year' then left(f.data->>'date',4)<to_char(current_date,'YYYY')
    when 'month' then left(f.data->>'date',7)<to_char(current_date,'YYYY-MM')
    else f.data->>'date'<to_char(current_date,'YYYY-MM-DD') end
  ) as flights,
  -- "Updated" only reflects published flights (not private, future or deleted edits).
  max(f.server_updated_at) filter (where not f.deleted and public.project_public_flight(f.data,p.exact_dates) is not null and
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
