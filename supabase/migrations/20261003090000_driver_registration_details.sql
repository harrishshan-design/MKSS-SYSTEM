alter table public.driver_registration_requests
  add column identity_reference text,
  add column requested_vehicle_type text,
  add column company_contact_person text,
  add column company_phone text,
  add column company_email text;

create or replace function public.approve_driver_registration(
  p_request_id uuid, p_company_id uuid, p_lorry_id uuid, p_actor_id uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  registration public.driver_registration_requests;
  selected_company public.companies;
  selected_lorry public.lorries;
  new_driver_id uuid;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;
  select * into registration from public.driver_registration_requests where id = p_request_id for update;
  if not found or registration.status <> 'PENDING' then
    raise exception 'Registration is not pending';
  end if;
  if exists (select 1 from public.users where id = registration.auth_user_id) then
    raise exception 'This account already has a role';
  end if;
  select * into selected_company from public.companies where id = p_company_id and active for update;
  if not found then raise exception 'Choose an active company'; end if;
  select * into selected_lorry from public.lorries where id = p_lorry_id for update;
  if not found or not selected_lorry.active or selected_lorry.company_id <> p_company_id
      or selected_lorry.assigned_driver_id is not null then
    raise exception 'Choose an active, unassigned lorry in this company';
  end if;
  insert into public.drivers(full_name, phone, licence_number, identity_reference, company_id)
    values(registration.full_name, registration.phone, registration.licence_number,
      registration.identity_reference, p_company_id) returning id into new_driver_id;
  update public.lorries set assigned_driver_id = new_driver_id where id = p_lorry_id;
  insert into public.users(id, name, role, driver_id)
    values(registration.auth_user_id, registration.full_name, 'driver', new_driver_id);
  update public.driver_registration_requests
    set status = 'APPROVED', reviewed_by = p_actor_id, reviewed_at = now() where id = p_request_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values(p_actor_id, 'DRIVER_REGISTRATION_APPROVED', 'driver_registration_requests', p_request_id::text,
      jsonb_build_object('driver_id', new_driver_id, 'company_id', p_company_id, 'lorry_id', p_lorry_id));
  return new_driver_id;
end;
$$;

create or replace function public.approve_driver_registration_auto(
  p_request_id uuid, p_actor_id uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  registration public.driver_registration_requests;
  selected_company public.companies;
  selected_lorry public.lorries;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;
  select * into registration from public.driver_registration_requests where id = p_request_id for update;
  if not found or registration.status <> 'PENDING' then
    raise exception 'Registration is not pending';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(registration.requested_company)), 0));
  select * into selected_company from public.companies
    where lower(name) = lower(trim(registration.requested_company))
    order by created_at limit 1 for update;
  if not found then
    insert into public.companies(name, contact_person, phone, email)
      values(trim(registration.requested_company), registration.company_contact_person,
        registration.company_phone, registration.company_email) returning * into selected_company;
  elsif not selected_company.active then
    raise exception 'Requested company is inactive. Review it before approving';
  end if;
  select * into selected_lorry from public.lorries
    where upper(registration_number) = upper(trim(registration.requested_lorry))
    order by created_at limit 1 for update;
  if not found then
    insert into public.lorries(registration_number, company_id, vehicle_type)
      values (upper(trim(registration.requested_lorry)), selected_company.id,
        coalesce(nullif(trim(registration.requested_vehicle_type), ''), 'Unspecified'))
      returning * into selected_lorry;
  elsif not selected_lorry.active or selected_lorry.company_id <> selected_company.id
      or selected_lorry.assigned_driver_id is not null then
    raise exception 'Requested lorry is inactive, assigned, or belongs to another company';
  end if;
  return public.approve_driver_registration(p_request_id, selected_company.id, selected_lorry.id, p_actor_id);
end;
$$;
