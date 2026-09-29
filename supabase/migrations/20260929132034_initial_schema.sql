create extension if not exists pgcrypto;

create type app_role as enum ('admin','guard','driver');
create type visit_status as enum ('REGISTERED','ENTERING','ON_SITE','WAITING','LOADING_UNLOADING','LEAVING','COMPLETED','CANCELLED','DELAYED');
create type sync_status as enum ('pending','processing','synced','failed');
create sequence company_code_seq;
create sequence driver_code_seq;
create sequence lorry_code_seq;
create sequence guard_code_seq;

create table companies (
  id uuid primary key default gen_random_uuid(), company_code text unique not null default ('COM-' || lpad(nextval('company_code_seq')::text,6,'0')),
  name text not null unique, contact_person text, phone text, email text,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table drivers (
  id uuid primary key default gen_random_uuid(), driver_code text unique not null default ('DRV-' || lpad(nextval('driver_code_seq')::text,6,'0')), full_name text not null,
  identity_reference text, phone text not null, licence_number text,
  company_id uuid not null references companies(id), active boolean not null default true,
  qr_token uuid not null unique default gen_random_uuid(), qr_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table lorries (
  id uuid primary key default gen_random_uuid(), lorry_code text unique not null default ('LRY-' || lpad(nextval('lorry_code_seq')::text,6,'0')),
  registration_number text not null unique, company_id uuid not null references companies(id),
  vehicle_type text not null, assigned_driver_id uuid references drivers(id), active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table security_guards (
  id uuid primary key default gen_random_uuid(), guard_code text unique not null default ('GRD-' || lpad(nextval('guard_code_seq')::text,6,'0')), full_name text not null,
  phone text, shift text, site text, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null, role app_role not null, guard_id uuid unique references security_guards(id),
  driver_id uuid unique references drivers(id), active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint role_link check ((role = 'guard' and guard_id is not null and driver_id is null)
    or (role = 'driver' and driver_id is not null and guard_id is null)
    or (role = 'admin' and guard_id is null and driver_id is null))
);
create sequence visit_number_seq;
create table visits (
  id uuid primary key default gen_random_uuid(),
  visit_code text not null unique default ('VIS-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYYMMDD') || '-' || lpad(nextval('visit_number_seq')::text, 5, '0')),
  driver_id uuid not null references drivers(id), lorry_id uuid not null references lorries(id),
  company_id uuid not null references companies(id), guard_id uuid not null references security_guards(id),
  visit_date date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date), purpose text,
  security_registered_at timestamptz not null default now(), company_time_in timestamptz,
  loading_area_in timestamptz, loading_area_out timestamptz, company_time_out timestamptz,
  loading_duration_seconds integer, total_duration_seconds integer,
  status visit_status not null default 'REGISTERED', exit_pending_at timestamptz,
  latitude_last double precision, longitude_last double precision, last_location_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_visit_per_lorry on visits(lorry_id) where status not in ('COMPLETED','CANCELLED');
create index visits_date_idx on visits(visit_date desc);
create index visits_status_idx on visits(status);
create table geofences (
  id uuid primary key default gen_random_uuid(), kind text not null unique check (kind in ('company','loading')),
  name text not null, latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null check (radius_meters between 10 and 10000),
  enabled boolean not null default true, updated_at timestamptz not null default now()
);
create table geofence_events (
  id uuid primary key default gen_random_uuid(), visit_id uuid not null references visits(id),
  event_type text not null check (event_type in ('COMPANY_ENTER','COMPANY_EXIT_PENDING','COMPANY_EXIT_CONFIRMED','COMPANY_EXIT_CANCELLED','LOADING_ZONE_ENTER','LOADING_ZONE_EXIT')),
  latitude double precision not null, longitude double precision not null, accuracy double precision not null,
  device_id text, occurred_at timestamptz not null default now()
);
create index geofence_events_visit_idx on geofence_events(visit_id, occurred_at desc);
create table attendance_qr (
  date date primary key, token uuid not null unique default gen_random_uuid(),
  site text not null, created_by uuid not null references users(id), created_at timestamptz not null default now()
);
create table security_attendance (
  id uuid primary key default gen_random_uuid(), date date not null, guard_id uuid not null references security_guards(id),
  site text not null, shift text, device_id text, time_in timestamptz not null default now(),
  time_out timestamptz, status text not null default 'ON_DUTY' check (status in ('ON_DUTY','OFF_DUTY')),
  created_at timestamptz not null default now(), unique (date, guard_id)
);
create table excel_sync_queue (
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null,
  sync_status sync_status not null default 'pending', sync_attempts integer not null default 0,
  last_sync_error text, last_sync_time timestamptz, next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index excel_sync_due_idx on excel_sync_queue(sync_status, next_attempt_at);
create table excel_row_map (
  entity_type text not null, entity_id uuid not null, worksheet text not null,
  row_number integer not null, primary key(entity_type,entity_id)
);
create table microsoft_connections (
  id integer primary key default 1 check (id = 1),
  encrypted_refresh_token text not null, connected_by uuid not null references users(id),
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table settings (
  id integer primary key default 1 check (id = 1),
  exit_confirmation_seconds integer not null default 120 check (exit_confirmation_seconds between 30 and 900),
  delay_threshold_minutes integer not null default 120 check (delay_threshold_minutes between 15 and 1440),
  updated_at timestamptz not null default now()
);
insert into settings(id) values(1);
create table audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references users(id),
  action text not null, entity_type text not null, entity_id text not null,
  old_value jsonb, new_value jsonb, reason text, created_at timestamptz not null default now()
);
create index audit_logs_created_idx on audit_logs(created_at desc);

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger companies_touch before update on companies for each row execute function touch_updated_at();
create trigger drivers_touch before update on drivers for each row execute function touch_updated_at();
create trigger lorries_touch before update on lorries for each row execute function touch_updated_at();
create trigger guards_touch before update on security_guards for each row execute function touch_updated_at();
create trigger visits_touch before update on visits for each row execute function touch_updated_at();
create trigger geofences_touch before update on geofences for each row execute function touch_updated_at();
create trigger settings_touch before update on settings for each row execute function touch_updated_at();

create function queue_excel_sync() returns trigger language plpgsql as $$
begin
  if TG_TABLE_NAME = 'visits' and TG_OP = 'UPDATE' and
    row(old.status, old.company_time_in, old.loading_area_in, old.loading_area_out, old.company_time_out)
      is not distinct from
    row(new.status, new.company_time_in, new.loading_area_in, new.loading_area_out, new.company_time_out) then
    return new;
  end if;
  insert into excel_sync_queue(entity_type,entity_id) values(TG_TABLE_NAME,new.id);
  return new;
end $$;
create trigger companies_sync after insert or update on companies for each row execute function queue_excel_sync();
create trigger drivers_sync after insert or update on drivers for each row execute function queue_excel_sync();
create trigger lorries_sync after insert or update on lorries for each row execute function queue_excel_sync();
create trigger visits_sync after insert or update on visits for each row execute function queue_excel_sync();
create trigger attendance_sync after insert or update on security_attendance for each row execute function queue_excel_sync();
create trigger events_sync after insert on geofence_events for each row execute function queue_excel_sync();

-- One transaction applies a GPS transition and writes its event history.
create function apply_location_transition(
  p_visit_id uuid, p_expected_updated_at timestamptz, p_patch jsonb,
  p_events text[], p_latitude double precision, p_longitude double precision,
  p_accuracy double precision, p_device_id text, p_occurred_at timestamptz
) returns visits language plpgsql security invoker as $$
declare current_visit visits; updated_visit visits; event_name text;
begin
  select * into current_visit from visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if current_visit.updated_at is distinct from p_expected_updated_at then
    raise exception 'Concurrent location update' using errcode = '40001';
  end if;
  update visits set
    latitude_last = (p_patch->>'latitude_last')::double precision,
    longitude_last = (p_patch->>'longitude_last')::double precision,
    last_location_at = (p_patch->>'last_location_at')::timestamptz,
    status = case when p_patch ? 'status' then (p_patch->>'status')::visit_status else status end,
    company_time_in = case when p_patch ? 'company_time_in' then (p_patch->>'company_time_in')::timestamptz else company_time_in end,
    loading_area_in = case when p_patch ? 'loading_area_in' then (p_patch->>'loading_area_in')::timestamptz else loading_area_in end,
    loading_area_out = case when p_patch ? 'loading_area_out' then (p_patch->>'loading_area_out')::timestamptz else loading_area_out end,
    company_time_out = case when p_patch ? 'company_time_out' then (p_patch->>'company_time_out')::timestamptz else company_time_out end,
    loading_duration_seconds = case when p_patch ? 'loading_duration_seconds' then (p_patch->>'loading_duration_seconds')::integer else loading_duration_seconds end,
    total_duration_seconds = case when p_patch ? 'total_duration_seconds' then (p_patch->>'total_duration_seconds')::integer else total_duration_seconds end,
    exit_pending_at = case when p_patch ? 'exit_pending_at' then (p_patch->>'exit_pending_at')::timestamptz else exit_pending_at end
  where id = p_visit_id returning * into updated_visit;
  foreach event_name in array p_events loop
    insert into geofence_events(visit_id,event_type,latitude,longitude,accuracy,device_id,occurred_at)
    values(p_visit_id,event_name,p_latitude,p_longitude,p_accuracy,p_device_id,p_occurred_at);
  end loop;
  return updated_visit;
end $$;
revoke execute on function apply_location_transition(uuid,timestamptz,jsonb,text[],double precision,double precision,double precision,text,timestamptz) from public, anon, authenticated;
grant execute on function apply_location_transition(uuid,timestamptz,jsonb,text[],double precision,double precision,double precision,text,timestamptz) to service_role;

create function dashboard_metrics(p_date date) returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'total_today', count(*) filter (where visit_date = p_date),
    'inside', count(*) filter (where company_time_in is not null and company_time_out is null and status not in ('COMPLETED','CANCELLED')),
    'waiting', count(*) filter (where visit_date = p_date and status in ('REGISTERED','WAITING')),
    'loading', count(*) filter (where status = 'LOADING_UNLOADING'),
    'completed', count(*) filter (where visit_date = p_date and status = 'COMPLETED'),
    'delayed', count(*) filter (where status = 'DELAYED'),
    'average_turnaround_seconds', coalesce(avg(total_duration_seconds) filter (where visit_date = p_date and status = 'COMPLETED'),0)
  ) from visits;
$$;
revoke execute on function dashboard_metrics(date) from public, anon, authenticated;
grant execute on function dashboard_metrics(date) to service_role;

create function apply_manual_correction(
  p_visit_id uuid, p_action text, p_time timestamptz, p_reason text, p_actor_id uuid
) returns visits language plpgsql security invoker as $$
declare old_visit visits; updated_visit visits; seconds_inside integer;
begin
  if length(trim(p_reason)) < 8 then raise exception 'A correction reason is required'; end if;
  if not exists (select 1 from users where id = p_actor_id and role = 'admin' and active) then raise exception 'Active admin required'; end if;
  select * into old_visit from visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if p_action = 'cancel' then
    if old_visit.status = 'COMPLETED' then raise exception 'Completed visits cannot be cancelled'; end if;
    update visits set status = 'CANCELLED', exit_pending_at = null where id = p_visit_id returning * into updated_visit;
  elsif p_action in ('checkout','correct_exit') then
    if old_visit.company_time_in is null then raise exception 'Set company entry before exit'; end if;
    if p_time < old_visit.company_time_in then raise exception 'Exit is before entry'; end if;
    seconds_inside = extract(epoch from p_time - old_visit.company_time_in)::integer;
    update visits set company_time_out = p_time, status = 'COMPLETED', exit_pending_at = null,
      total_duration_seconds = seconds_inside where id = p_visit_id returning * into updated_visit;
  elsif p_action = 'correct_entry' then
    if old_visit.company_time_out is not null and p_time > old_visit.company_time_out then raise exception 'Entry is after exit'; end if;
    update visits set company_time_in = p_time,
      status = case when old_visit.status = 'REGISTERED' then 'ON_SITE'::visit_status else old_visit.status end,
      total_duration_seconds = case when old_visit.company_time_out is not null
        then extract(epoch from old_visit.company_time_out - p_time)::integer else null end
      where id = p_visit_id returning * into updated_visit;
  else raise exception 'Unknown correction action';
  end if;
  insert into audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
  values(p_actor_id,'MANUAL_CORRECTION','visits',p_visit_id::text,to_jsonb(old_visit),to_jsonb(updated_visit),trim(p_reason));
  return updated_visit;
end $$;
revoke execute on function apply_manual_correction(uuid,text,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function apply_manual_correction(uuid,text,timestamptz,text,uuid) to service_role;

-- The Data API can be enabled without exposing business records to browser clients.
alter table companies enable row level security;
alter table drivers enable row level security;
alter table lorries enable row level security;
alter table security_guards enable row level security;
alter table users enable row level security;
alter table visits enable row level security;
alter table geofences enable row level security;
alter table geofence_events enable row level security;
alter table attendance_qr enable row level security;
alter table security_attendance enable row level security;
alter table excel_sync_queue enable row level security;
alter table excel_row_map enable row level security;
alter table microsoft_connections enable row level security;
alter table settings enable row level security;
alter table audit_logs enable row level security;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
