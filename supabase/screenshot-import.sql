-- Run after schema.sql. Durable per-user quotas for authenticated screenshot extraction.
-- Safe to re-run: re-running adds refunds and the status check to older installs.
begin;
create table if not exists public.screenshot_import_usage (
 user_id uuid not null references auth.users(id) on delete cascade,
 month date not null,
 day date not null,
 month_count integer not null default 0,
 day_count integer not null default 0,
 primary key(user_id)
);
alter table public.screenshot_import_usage enable row level security;
revoke all on public.screenshot_import_usage from anon, authenticated;
create or replace function public.consume_screenshot_import()
returns boolean language plpgsql security definer set search_path = public as $$
declare
 owner_id uuid := auth.uid();
 today date := (now() at time zone 'UTC')::date;
 month_start date := date_trunc('month', now() at time zone 'UTC')::date;
 affected integer;
begin
 if owner_id is null then return false; end if;
 insert into public.screenshot_import_usage(user_id,month,day,month_count,day_count)
 values(owner_id,month_start,today,1,1)
 on conflict(user_id) do update set
 month=month_start, day=today,
 month_count=case when screenshot_import_usage.month=month_start then screenshot_import_usage.month_count+1 else 1 end,
 day_count=case when screenshot_import_usage.day=today then screenshot_import_usage.day_count+1 else 1 end
 where (screenshot_import_usage.month<>month_start or screenshot_import_usage.month_count<100)
 and (screenshot_import_usage.day<>today or screenshot_import_usage.day_count<10);
 get diagnostics affected = row_count;
 return affected=1;
end $$;
revoke all on function public.consume_screenshot_import() from public;
grant execute on function public.consume_screenshot_import() to authenticated;
-- Give an attempt back when extraction failed for reasons unrelated to the image
-- (server setup or Gemini outages). Never goes below zero.
create or replace function public.refund_screenshot_import()
returns boolean language plpgsql security definer set search_path = public as $$
declare
 owner_id uuid := auth.uid();
 today date := (now() at time zone 'UTC')::date;
 month_start date := date_trunc('month', now() at time zone 'UTC')::date;
begin
 if owner_id is null then return false; end if;
 update public.screenshot_import_usage set
  day_count = case when day = today then greatest(day_count - 1, 0) else day_count end,
  month_count = case when month = month_start then greatest(month_count - 1, 0) else month_count end
 where user_id = owner_id;
 return found;
end $$;
revoke all on function public.refund_screenshot_import() from public;
grant execute on function public.refund_screenshot_import() to authenticated;

-- Remaining allowance for the signed-in user (read-only; used by the in-app setup check).
create or replace function public.screenshot_import_status()
returns table(day_remaining integer, month_remaining integer)
language sql stable security definer set search_path = public as $$
 select
  10 - coalesce((select u.day_count from public.screenshot_import_usage u where u.user_id = auth.uid() and u.day = (now() at time zone 'UTC')::date), 0),
  100 - coalesce((select u.month_count from public.screenshot_import_usage u where u.user_id = auth.uid() and u.month = date_trunc('month', now() at time zone 'UTC')::date), 0)
 where auth.uid() is not null;
$$;
revoke all on function public.screenshot_import_status() from public;
grant execute on function public.screenshot_import_status() to authenticated;
commit;
