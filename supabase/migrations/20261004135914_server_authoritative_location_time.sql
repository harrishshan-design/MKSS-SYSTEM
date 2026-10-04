alter table public.visits add column last_observed_at timestamptz;

create or replace function public.apply_location_transition(
  p_visit_id uuid, p_expected_updated_at timestamptz, p_patch jsonb,
  p_events text[], p_latitude double precision, p_longitude double precision,
  p_accuracy double precision, p_device_id text, p_occurred_at timestamptz
) returns public.visits language plpgsql security invoker set search_path = '' as $$
declare
  current_visit public.visits;
  updated_visit public.visits;
  event_name text;
  recorded_at timestamptz;
  observed_at timestamptz;
begin
  select * into current_visit from public.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if current_visit.updated_at is distinct from p_expected_updated_at then
    raise exception 'Concurrent location update' using errcode = '40001';
  end if;
  observed_at := (p_patch->>'last_observed_at')::timestamptz;
  if observed_at is null or (current_visit.last_observed_at is not null and observed_at <= current_visit.last_observed_at) then
    raise exception 'Stale location update' using errcode = '22023';
  end if;
  recorded_at := clock_timestamp();
  update public.visits set
    latitude_last = (p_patch->>'latitude_last')::double precision,
    longitude_last = (p_patch->>'longitude_last')::double precision,
    last_location_at = recorded_at,
    last_observed_at = observed_at,
    status = case when p_patch ? 'status' then (p_patch->>'status')::public.visit_status else status end,
    company_time_in = case when p_patch ? 'company_time_in' then recorded_at else company_time_in end,
    loading_area_in = case when p_patch ? 'loading_area_in' then recorded_at else loading_area_in end,
    loading_area_out = case when p_patch ? 'loading_area_out' then recorded_at else loading_area_out end,
    company_time_out = case when p_patch ? 'company_time_out' then recorded_at else company_time_out end,
    loading_duration_seconds = case when p_patch ? 'loading_duration_seconds' then greatest(0, round(extract(epoch from recorded_at - current_visit.loading_area_in))::integer) else loading_duration_seconds end,
    total_duration_seconds = case when p_patch ? 'total_duration_seconds' then greatest(0, round(extract(epoch from recorded_at - current_visit.company_time_in))::integer) else total_duration_seconds end,
    exit_pending_at = case when p_patch ? 'exit_pending_at' then case when p_patch->>'exit_pending_at' is null then null else recorded_at end else exit_pending_at end
  where id = p_visit_id returning * into updated_visit;
  foreach event_name in array p_events loop
    insert into public.geofence_events(visit_id,event_type,latitude,longitude,accuracy,device_id,occurred_at)
    values(p_visit_id,event_name,p_latitude,p_longitude,p_accuracy,p_device_id,recorded_at);
  end loop;
  return updated_visit;
end $$;
