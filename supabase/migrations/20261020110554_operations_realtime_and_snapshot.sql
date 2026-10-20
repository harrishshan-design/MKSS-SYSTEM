-- Private change notices only. Business tables keep their existing RLS and API
-- access; no row images, credentials, QR secrets, or personal details are sent.
create schema if not exists mkss_private;
revoke all on schema mkss_private from public, anon, authenticated;
grant usage on schema mkss_private to authenticated;

create or replace function mkss_private.can_receive_changes(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = (select auth.uid()) and u.active
      and ((p_topic = 'mkss:operations' and u.role in ('admin', 'monitor', 'guard'))
        or (u.role = 'driver' and u.driver_id is not null
          and p_topic = 'mkss:driver:' || u.driver_id::text))
  );
$$;
revoke all on function mkss_private.can_receive_changes(text) from public, anon, authenticated;
grant execute on function mkss_private.can_receive_changes(text) to authenticated;

-- Supabase owns this table and already enables RLS. postgres can manage its
-- policies through supautils, but must not ALTER the managed table itself.
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass) then
    raise exception 'Realtime messages must have RLS enabled';
  end if;
end; $$;
create policy mkss_receive_changes on realtime.messages for select to authenticated
  using (extension = 'broadcast'
    and (select mkss_private.can_receive_changes((select realtime.topic()))));

create or replace function mkss_private.notify_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  current_row jsonb;
  previous_row jsonb;
  resource text := tg_argv[0];
  driver_id text;
  previous_driver_id text;
  notice jsonb;
begin
  if tg_op = 'DELETE' then current_row := to_jsonb(old);
  else current_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then previous_row := to_jsonb(old); end if;

  -- GPS heartbeats must not cause dashboard fetches for every location update.
  if tg_table_name = 'visits' and tg_op = 'UPDATE' then
    if (current_row - array['updated_at','latitude_last','longitude_last','last_location_at','last_observed_at','exit_pending_at'])
      is not distinct from
      (previous_row - array['updated_at','latitude_last','longitude_last','last_location_at','last_observed_at','exit_pending_at']) then
      return new;
    end if;
  end if;

  notice := jsonb_build_object('resource', resource);
  perform realtime.send(notice, 'changed', 'mkss:operations', true);
  if tg_table_name = 'drivers' then
    driver_id := current_row->>'id';
  elsif tg_table_name = 'lorries' then
    driver_id := current_row->>'assigned_driver_id';
    previous_driver_id := previous_row->>'assigned_driver_id';
  else
    driver_id := current_row->>'driver_id';
    previous_driver_id := previous_row->>'driver_id';
  end if;
  if driver_id is not null then
    perform realtime.send(notice, 'changed', 'mkss:driver:' || driver_id, true);
  end if;
  if previous_driver_id is not null and previous_driver_id is distinct from driver_id then
    perform realtime.send(notice, 'changed', 'mkss:driver:' || previous_driver_id, true);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
exception when others then
  -- Notification delivery must never prevent a check-in/checkout from saving.
  -- Clients recover through their bounded backup refresh.
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function mkss_private.notify_change() from public, anon, authenticated;

create trigger mkss_visit_change after insert or update or delete on public.visits
  for each row execute function mkss_private.notify_change('visits');
create trigger mkss_attendance_change after insert or update or delete on public.security_attendance
  for each row execute function mkss_private.notify_change('attendance');
create trigger mkss_driver_attendance_change after insert on public.audit_logs
  for each row when (new.action = 'DRIVER_DAILY_CHECKIN')
  execute function mkss_private.notify_change('attendance');
create trigger mkss_registration_change after insert or update or delete on public.driver_registration_requests
  for each row execute function mkss_private.notify_change('registrations');
create trigger mkss_driver_change after insert or update or delete on public.drivers
  for each row execute function mkss_private.notify_change('drivers');
create trigger mkss_lorry_change after insert or update or delete on public.lorries
  for each row execute function mkss_private.notify_change('reference');
create trigger mkss_company_change after insert or update or delete on public.companies
  for each row execute function mkss_private.notify_change('reference');
create trigger mkss_guard_change after insert or update or delete on public.security_guards
  for each row execute function mkss_private.notify_change('reference');
create trigger mkss_geofence_change after insert or update or delete on public.geofences
  for each row execute function mkss_private.notify_change('reference');

-- One consistent overview snapshot replaces seven Data API requests. The
-- service role may execute it only after the API checks the current staff role.
create or replace function public.operations_snapshot(p_date date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with today_ids as (
    select id from public.visits where visit_date = p_date order by created_at desc limit 500
  ), active_ids as (
    select id from public.visits where status not in ('COMPLETED','CANCELLED')
      order by created_at desc limit 500
  ), unverified_ids as (
    select id from public.visits where status = 'COMPLETED' and checkout_method = 'TIME_LIMIT'
      order by created_at desc limit 500
  ), selected_ids as (
    select id from today_ids union select id from active_ids union select id from unverified_ids
  ), visit_rows as (
    select v.created_at, to_jsonb(v) || jsonb_build_object(
      'drivers', case when d.id is not null then jsonb_build_object('full_name', d.full_name) end,
      'lorries', case when l.id is not null then jsonb_build_object('registration_number', l.registration_number, 'vehicle_type', l.vehicle_type) end,
      'companies', case when c.id is not null then jsonb_build_object('name', c.name) end,
      'security_guards', case when g.id is not null then jsonb_build_object('full_name', g.full_name) end
    ) as record
    from selected_ids s join public.visits v on v.id = s.id
      left join public.drivers d on d.id = v.driver_id
      left join public.lorries l on l.id = v.lorry_id
      left join public.companies c on c.id = v.company_id
      left join public.security_guards g on g.id = v.guard_id
  ), attendance_rows as (
    select a.time_in, to_jsonb(a) || jsonb_build_object('security_guards',
      case when g.id is not null then jsonb_build_object('full_name', g.full_name) end) as record
    from public.security_attendance a left join public.security_guards g on g.id = a.guard_id
    where a.date = p_date
  )
  select jsonb_build_object(
    'visits', coalesce((select jsonb_agg(record order by created_at desc) from visit_rows), '[]'::jsonb),
    'attendance', coalesce((select jsonb_agg(record order by time_in desc) from attendance_rows), '[]'::jsonb),
    'metrics', public.dashboard_metrics(p_date),
    'monitoring', jsonb_build_object(
      'companyFenceConfigured', exists(select 1 from public.geofences where kind = 'company' and enabled),
      'activeGuards', (select count(*) from public.security_guards where active)),
    'now', statement_timestamp()
  );
$$;
revoke all on function public.operations_snapshot(date) from public, anon, authenticated;
grant execute on function public.operations_snapshot(date) to service_role;
