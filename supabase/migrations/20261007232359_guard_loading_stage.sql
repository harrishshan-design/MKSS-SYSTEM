create function public.confirm_guard_loading_stage(p_actor_id uuid, p_visit_id uuid, p_stage text)
returns public.visits language plpgsql security invoker set search_path = '' as $$
declare
  old_visit public.visits;
  updated_visit public.visits;
  recorded_at timestamptz;
begin
  if not exists (
    select 1 from public.users u join public.security_guards g on g.id = u.guard_id
    where u.id = p_actor_id and u.role = 'guard' and u.active and g.active
  ) then raise exception 'Active guard required'; end if;
  select * into old_visit from public.visits where id = p_visit_id for update;
  if not found or old_visit.status in ('COMPLETED','CANCELLED') then
    raise exception 'Visit is no longer active';
  end if;
  if old_visit.status = 'LEAVING' then raise exception 'Vehicle is already leaving the site'; end if;
  if old_visit.company_time_in is null then raise exception 'Record gate entry before loading'; end if;
  recorded_at := clock_timestamp();
  if p_stage = 'start' then
    if old_visit.loading_area_in is not null then raise exception 'Loading has already started'; end if;
    update public.visits set loading_area_in = recorded_at, status = 'LOADING_UNLOADING'
      where id = p_visit_id returning * into updated_visit;
  elsif p_stage = 'finish' then
    if old_visit.loading_area_in is null or old_visit.loading_area_out is not null then
      raise exception 'Start loading before recording its completion';
    end if;
    update public.visits set loading_area_out = recorded_at,
      loading_duration_seconds = greatest(0,extract(epoch from recorded_at - old_visit.loading_area_in)::integer),
      status = 'ON_SITE' where id = p_visit_id returning * into updated_visit;
  else raise exception 'Unknown loading stage'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
    values(p_actor_id,case when p_stage='start' then 'LOADING_STARTED_AT_GATE' else 'LOADING_FINISHED_AT_GATE' end,
      'visits',p_visit_id::text,
      jsonb_build_object('loading_area_in',old_visit.loading_area_in,'loading_area_out',old_visit.loading_area_out),
      jsonb_build_object('loading_area_in',updated_visit.loading_area_in,'loading_area_out',updated_visit.loading_area_out),
      'Guard confirmed loading stage');
  return updated_visit;
end;
$$;
revoke execute on function public.confirm_guard_loading_stage(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_guard_loading_stage(uuid,uuid,text) to service_role;

-- Old static pass secrets may have appeared in earlier reports or screenshots.
-- Replace them before short-lived driver passes go live.
update public.drivers set qr_token = gen_random_uuid();
