-- The administrator can approve the driver's submitted company and lorry
-- in one step. Existing active records are reused; missing ones are created
-- in the same transaction as the driver account.
create function public.approve_driver_registration_auto(
  p_request_id uuid, p_actor_id uuid
) returns uuid language plpgsql security invoker as $$
declare
  registration public.driver_registration_requests;
  selected_company public.companies;
  selected_lorry public.lorries;
  new_driver_id uuid;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;

  select * into registration from public.driver_registration_requests
    where id = p_request_id for update;
  if not found or registration.status <> 'PENDING' then
    raise exception 'Registration is not pending';
  end if;

  -- Serialize approvals for the same company so two requests do not create
  -- duplicate company or lorry records at the same time.
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(registration.requested_company)), 0));
  select * into selected_company from public.companies
    where lower(name) = lower(trim(registration.requested_company))
    order by created_at limit 1 for update;
  if not found then
    insert into public.companies(name) values (trim(registration.requested_company))
      returning * into selected_company;
  elsif not selected_company.active then
    raise exception 'Requested company is inactive. Review it before approving';
  end if;

  select * into selected_lorry from public.lorries
    where upper(registration_number) = upper(trim(registration.requested_lorry))
    order by created_at limit 1 for update;
  if not found then
    insert into public.lorries(registration_number, company_id, vehicle_type)
      values (upper(trim(registration.requested_lorry)), selected_company.id, 'Unspecified')
      returning * into selected_lorry;
  elsif not selected_lorry.active or selected_lorry.company_id <> selected_company.id
      or selected_lorry.assigned_driver_id is not null then
    raise exception 'Requested lorry is inactive, assigned, or belongs to another company';
  end if;

  new_driver_id := public.approve_driver_registration(
    p_request_id, selected_company.id, selected_lorry.id, p_actor_id
  );
  return new_driver_id;
end;
$$;

revoke execute on function public.approve_driver_registration_auto(uuid,uuid) from public, anon, authenticated;
grant execute on function public.approve_driver_registration_auto(uuid,uuid) to service_role;
