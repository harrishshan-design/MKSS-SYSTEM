-- Retain the automatic timeout timestamp as a timer event. An admin's later
-- physical-exit verification is recorded separately, with its own real time.
alter table public.visits
  add column exit_verified_at timestamptz,
  add column exit_verified_by uuid references public.users(id),
  drop constraint visits_checkout_method_check,
  add constraint visits_checkout_method_check
    check (checkout_method in ('TIME_LIMIT', 'TIME_LIMIT_VERIFIED', 'GATE', 'ADMIN')),
  add constraint visits_exit_verification_complete
    check ((exit_verified_at is null and exit_verified_by is null)
      or (exit_verified_at is not null and exit_verified_by is not null
        and checkout_method = 'TIME_LIMIT_VERIFIED'));

create function public.verify_timed_out_exit(p_visit_id uuid, p_actor_id uuid)
returns public.visits language plpgsql security invoker set search_path = '' as $$
declare
  previous public.visits;
  verified public.visits;
begin
  if not exists (select 1 from public.users
      where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;
  select * into previous from public.visits where id = p_visit_id for update;
  if not found then raise exception 'Visit not found'; end if;
  if previous.status <> 'COMPLETED' or previous.checkout_method <> 'TIME_LIMIT' then
    raise exception 'This trip no longer needs exit verification';
  end if;
  update public.visits set checkout_method = 'TIME_LIMIT_VERIFIED',
    exit_verified_at = clock_timestamp(), exit_verified_by = p_actor_id
    where id = p_visit_id returning * into verified;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id,
      old_value, new_value, reason)
    values (p_actor_id, 'ADMIN_EXIT_VERIFIED', 'visits', p_visit_id::text,
      jsonb_build_object('checkout_method', previous.checkout_method,
        'timer_at', previous.company_time_out),
      jsonb_build_object('checkout_method', verified.checkout_method,
        'timer_at', verified.company_time_out,
        'exit_verified_at', verified.exit_verified_at),
      'Administrator confirmed physical exit; original timer event retained');
  return verified;
end;
$$;
revoke execute on function public.verify_timed_out_exit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.verify_timed_out_exit(uuid,uuid) to service_role;
