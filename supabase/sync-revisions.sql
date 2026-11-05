-- Safe to re-run after schema.sql. Atomic revision checks for multi-device edits.
-- server_updated_at is an opaque revision token, not a client clock.
create or replace function public.sync_flight_changes(changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  item jsonb; previous public.flights; result public.flights;
  output jsonb := '[]'::jsonb; owner uuid := auth.uid(); stamp bigint;
begin
  if owner is null then raise exception 'Sign in required'; end if;
  if jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) > 200 then raise exception 'Invalid sync batch'; end if;
  for item in select value from jsonb_array_elements(changes) loop
    if coalesce(item->>'id','') = '' then raise exception 'Flight ID required'; end if;
    -- Also serialize concurrent inserts of an id that does not exist yet.
    perform pg_advisory_xact_lock(hashtextextended(owner::text || ':' || (item->>'id'), 0));
    select * into previous from public.flights where user_id = owner and id = item->>'id' for update;
    if (previous.id is not null and (item->>'expected' is null or previous.server_updated_at <> (item->>'expected')::timestamptz)) then
      output := output || jsonb_build_array(jsonb_build_object('accepted', false, 'row', to_jsonb(previous)));
      continue;
    end if;
    if previous.id is null and item->>'expected' is not null then raise exception 'Flight revision no longer exists'; end if;
    stamp := greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(previous.updated_at,0) + 1, coalesce((item->'flight'->>'updatedAt')::bigint,0));
    if coalesce((item->>'deleted')::boolean,false) then
      if previous.id is null then raise exception 'Cannot delete unknown flight'; end if;
      update public.flights set deleted = true, updated_at = stamp where user_id = owner and id = previous.id returning * into result;
    else
      if jsonb_typeof(item->'flight') <> 'object' then raise exception 'Flight data required'; end if;
      insert into public.flights(user_id,id,data,updated_at,deleted)
      values(owner,item->>'id',jsonb_set(jsonb_set(item->'flight','{id}',item->'id'),'{updatedAt}',to_jsonb(stamp)),stamp,false)
      on conflict(user_id,id) do update set data=excluded.data,updated_at=excluded.updated_at,deleted=false
      returning * into result;
    end if;
    output := output || jsonb_build_array(jsonb_build_object('accepted',true,'row',to_jsonb(result)));
  end loop;
  return output;
end $$;
revoke all on function public.sync_flight_changes(jsonb) from public, anon;
grant execute on function public.sync_flight_changes(jsonb) to authenticated;
