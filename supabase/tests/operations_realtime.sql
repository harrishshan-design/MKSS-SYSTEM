-- Run as postgres in the SQL Editor after the two October 20 rollout migrations.
-- All fixtures are temporary and all messages are rolled back. No real trip,
-- driver, or attendance record is created or modified.
-- First connect a Realtime WebSocket client (the app or Inspector). Supabase
-- initializes its daily message partitions on the first successful connection.
begin;

do $$
declare
  snapshot jsonb := public.operations_snapshot((now() at time zone 'Asia/Kuala_Lumpur')::date);
  expected bigint;
  staff_id uuid;
  driver_user record;
begin
  select count(*) into expected from public.visits
    where visit_date = (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if (snapshot->'metrics'->>'total_today')::bigint <> expected then
    raise exception 'Snapshot total does not match real visits'; end if;
  select count(*) into expected from public.security_attendance
    where date = (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if jsonb_array_length(snapshot->'attendance') <> expected then
    raise exception 'Snapshot attendance does not match real attendance'; end if;
  if not (snapshot->'metrics' ?& array['tank_farm_trips','roro_biru_trips','roro_oren_trips']) then
    raise exception 'Trip category metrics are missing'; end if;
  if has_function_privilege('authenticated','public.operations_snapshot(date)','execute')
    or has_function_privilege('anon','public.operations_snapshot(date)','execute')
    or not has_function_privilege('service_role','public.operations_snapshot(date)','execute') then
    raise exception 'Snapshot RPC is not restricted to the server'; end if;

  select id into staff_id from public.users where active and role in ('admin','monitor','guard') limit 1;
  if staff_id is null then raise exception 'No active staff account for authorization check'; end if;
  perform set_config('request.jwt.claim.sub', staff_id::text, true);
  if not mkss_private.can_receive_changes('mkss:operations') then
    raise exception 'Active staff cannot receive operations notices'; end if;
  select id, driver_id into driver_user from public.users where active and role = 'driver' and driver_id is not null limit 1;
  if not found then raise exception 'No active driver account for authorization check'; end if;
  perform set_config('request.jwt.claim.sub', driver_user.id::text, true);
  if not mkss_private.can_receive_changes('mkss:driver:' || driver_user.driver_id::text)
    or mkss_private.can_receive_changes('mkss:operations')
    or mkss_private.can_receive_changes('mkss:driver:00000000-0000-0000-0000-000000000000') then
    raise exception 'Driver channel isolation failed'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  if mkss_private.can_receive_changes('mkss:operations') then
    raise exception 'Anonymous channel access was allowed'; end if;
end;
$$;

create temp table mkss_timeout_probe(company_time_in timestamptz, purpose text, auto_timeout_at timestamptz, driver_id uuid);
alter table pg_temp.mkss_timeout_probe enable row level security;
create trigger check_timeout before insert on mkss_timeout_probe
  for each row execute function public.set_visit_auto_timeout();
insert into mkss_timeout_probe(company_time_in, purpose)
  select '2026-10-20 01:00:00+00'::timestamptz, unnest(array['Hantar Barang','Ambil Barang','Manual','Tank Farm','RORO Biru','RORO Oren']);
do $$ begin
  if exists(select 1 from mkss_timeout_probe where auto_timeout_at is distinct from
    company_time_in + case when purpose in ('Manual','Tank Farm') then interval '2 hours' else interval '30 minutes' end) then
    raise exception 'Incorrect database trip deadline'; end if;
end; $$;

-- The trigger recognizes the table name "visits". Use a temporary table of that
-- name to verify heartbeat suppression without touching any production visit.
create temp table visits(id uuid, driver_id uuid, status text, last_location_at timestamptz, updated_at timestamptz);
alter table pg_temp.visits enable row level security;
create trigger check_broadcast after insert or update on pg_temp.visits
  for each row execute function mkss_private.notify_change('mkss_probe_20261020');
do $$
declare emitted bigint;
begin
  insert into pg_temp.visits(id,status) values('00000000-0000-0000-0000-000000000000','ON_SITE');
  select count(*) into emitted from realtime.messages
    where payload->>'resource' = 'mkss_probe_20261020' and topic = 'mkss:operations' and event = 'changed';
  if emitted <> 1 then raise exception 'Visit insert did not emit exactly one operations notice'; end if;
  update pg_temp.visits set last_location_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = '00000000-0000-0000-0000-000000000000';
  select count(*) into emitted from realtime.messages
    where payload->>'resource' = 'mkss_probe_20261020' and topic = 'mkss:operations' and event = 'changed';
  if emitted <> 1 then raise exception 'GPS heartbeat emitted an unnecessary notice'; end if;
  update pg_temp.visits set status = 'COMPLETED'
    where id = '00000000-0000-0000-0000-000000000000';
  select count(*) into emitted from realtime.messages
    where payload->>'resource' = 'mkss_probe_20261020' and topic = 'mkss:operations' and event = 'changed';
  if emitted <> 2 then raise exception 'Checkout did not emit a notice'; end if;
end;
$$;
rollback;
select 'PASS: snapshot totals, channel isolation, trip deadlines, and heartbeat suppression' as verification;
