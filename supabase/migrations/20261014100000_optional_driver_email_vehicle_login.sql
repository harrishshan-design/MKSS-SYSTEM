alter table public.driver_registration_requests alter column email drop not null;

-- Only the server service role can resolve a vehicle to an Auth account.
-- Return every match so ambiguous plates never silently sign in the wrong driver.
create function public.driver_vehicle_login_candidates(p_vehicle text)
returns table(auth_user_id uuid)
language sql stable security invoker set search_path = '' as $$
  select distinct candidate.auth_user_id from (
    select r.auth_user_id
      from public.driver_registration_requests r
      where r.status = 'PENDING'
        and regexp_replace(upper(r.requested_lorry), '[^A-Z0-9]', '', 'g') = p_vehicle
    union all
    select u.id
      from public.lorries l
      join public.users u on u.driver_id = l.assigned_driver_id
      where l.active and u.active and u.role = 'driver'
        and regexp_replace(upper(l.registration_number), '[^A-Z0-9]', '', 'g') = p_vehicle
  ) candidate;
$$;

revoke execute on function public.driver_vehicle_login_candidates(text) from public, anon, authenticated;
grant execute on function public.driver_vehicle_login_candidates(text) to service_role;
