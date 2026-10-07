-- The public daily QR is derived from this server-only secret. The historical
-- token column remains for old rows but is no longer accepted by scanners.
alter table public.attendance_qr
  add column challenge_secret uuid not null default gen_random_uuid();

create function public.confirm_guard_exit(p_actor_id uuid, p_driver_id uuid)
returns public.visits language plpgsql security invoker set search_path = '' as $$
declare
  old_visit public.visits;
  updated_visit public.visits;
  exit_at timestamptz;
begin
  if not exists (
    select 1 from public.users u join public.security_guards g on g.id = u.guard_id
    where u.id = p_actor_id and u.role = 'guard' and u.active and g.active
  ) then
    raise exception 'Active guard required';
  end if;
  select * into old_visit from public.visits
    where driver_id = p_driver_id and status not in ('COMPLETED','CANCELLED')
    order by created_at desc limit 1 for update;
  if not found then raise exception 'No active visit for this driver'; end if;
  if old_visit.company_time_in is null then raise exception 'Site entry must be recorded before exit'; end if;
  exit_at := clock_timestamp();
  update public.visits set
    company_time_out = exit_at,
    status = 'COMPLETED',
    exit_pending_at = null,
    total_duration_seconds = greatest(0,extract(epoch from exit_at - old_visit.company_time_in)::integer),
    loading_area_out = case when old_visit.loading_area_in is not null and old_visit.loading_area_out is null
      then exit_at else loading_area_out end,
    loading_duration_seconds = case when old_visit.loading_area_in is not null and old_visit.loading_area_out is null
      then greatest(0,extract(epoch from exit_at - old_visit.loading_area_in)::integer) else loading_duration_seconds end
    where id = old_visit.id returning * into updated_visit;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
    values(p_actor_id,'GUARD_EXIT_CONFIRMED','visits',old_visit.id::text,
      jsonb_build_object('status',old_visit.status,'company_time_out',old_visit.company_time_out),
      jsonb_build_object('status',updated_visit.status,'company_time_out',updated_visit.company_time_out),
      'Driver QR scanned at the exit gate');
  return updated_visit;
end;
$$;
revoke execute on function public.confirm_guard_exit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.confirm_guard_exit(uuid,uuid) to service_role;
