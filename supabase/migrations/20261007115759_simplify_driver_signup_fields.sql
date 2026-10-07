alter table public.driver_registration_requests
  alter column requested_lorry drop not null,
  add column has_driving_licence boolean,
  add column trip_type text check (trip_type in ('Hantar Barang', 'Ambil Barang'));

alter table public.drivers
  add column has_driving_licence boolean,
  add column default_trip_type text check (default_trip_type in ('Hantar Barang', 'Ambil Barang'));

update public.driver_registration_requests
set has_driving_licence = licence_number is not null
where has_driving_licence is null;

update public.drivers
set has_driving_licence = licence_number is not null
where has_driving_licence is null;

create or replace function public.approve_driver_registration_auto(
  p_request_id uuid, p_actor_id uuid
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  registration public.driver_registration_requests;
  selected_company public.companies;
  selected_lorry public.lorries;
  v_lorry_id uuid;
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
  if registration.has_driving_licence is null or registration.trip_type is null then
    raise exception 'Driving licence answer and delivery type are required';
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
  if nullif(trim(registration.requested_lorry), '') is not null then
    select * into selected_lorry from public.lorries
      where upper(registration_number) = upper(trim(registration.requested_lorry))
      order by created_at limit 1 for update;
    if not found then
      insert into public.lorries(registration_number, company_id, vehicle_type)
        values(upper(trim(registration.requested_lorry)), selected_company.id,
          coalesce(nullif(trim(registration.requested_vehicle_type), ''), 'Unspecified'))
        returning * into selected_lorry;
    elsif not selected_lorry.active or selected_lorry.company_id <> selected_company.id
        or selected_lorry.assigned_driver_id is not null then
      raise exception 'Requested lorry is inactive, assigned, or belongs to another company';
    end if;
    v_lorry_id := selected_lorry.id;
  end if;
  insert into public.drivers(full_name, phone, licence_number, identity_reference,
    company_id, has_driving_licence, default_trip_type)
    values(registration.full_name, registration.phone, registration.licence_number,
      registration.identity_reference, selected_company.id,
      coalesce(registration.has_driving_licence, registration.licence_number is not null),
      registration.trip_type)
    returning id into new_driver_id;
  if v_lorry_id is not null then
    update public.lorries set assigned_driver_id = new_driver_id where id = v_lorry_id;
  end if;
  insert into public.users(id, name, role, driver_id)
    values(registration.auth_user_id, registration.full_name, 'driver', new_driver_id);
  update public.driver_registration_requests
    set status = 'APPROVED', reviewed_by = p_actor_id, reviewed_at = now()
    where id = p_request_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, new_value)
    values(p_actor_id, 'DRIVER_REGISTRATION_APPROVED', 'driver_registration_requests', p_request_id::text,
      jsonb_build_object('driver_id', new_driver_id, 'company_id', selected_company.id,
        'lorry_id', v_lorry_id, 'has_driving_licence', registration.has_driving_licence,
        'trip_type', registration.trip_type));
  return new_driver_id;
end;
$$;

create function public.set_driver_qr_visit_type() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.registration_source = 'DRIVER_DAILY_QR' and new.purpose is null then
    select default_trip_type into new.purpose from public.drivers where id = new.driver_id;
  end if;
  return new;
end;
$$;
create trigger set_driver_qr_visit_type before insert on public.visits
  for each row execute function public.set_driver_qr_visit_type();
revoke execute on function public.set_driver_qr_visit_type() from public, anon, authenticated;
grant execute on function public.set_driver_qr_visit_type() to service_role;
