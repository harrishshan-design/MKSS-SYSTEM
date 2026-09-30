create type driver_registration_status as enum ('PENDING', 'APPROVED', 'REJECTED');

create table driver_registration_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  phone text not null,
  licence_number text,
  requested_company text not null,
  requested_lorry text not null,
  status driver_registration_status not null default 'PENDING',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index driver_registration_requests_status_idx on driver_registration_requests(status, created_at);
create trigger driver_registration_requests_touch before update on driver_registration_requests
  for each row execute function touch_updated_at();
alter table driver_registration_requests enable row level security;
grant all on driver_registration_requests to service_role;

create function approve_driver_registration(
  p_request_id uuid, p_company_id uuid, p_lorry_id uuid, p_actor_id uuid
) returns uuid language plpgsql security invoker as $$
declare
  registration driver_registration_requests;
  selected_company companies;
  selected_lorry lorries;
  new_driver_id uuid;
begin
  if not exists (select 1 from users where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;
  select * into registration from driver_registration_requests where id = p_request_id for update;
  if not found or registration.status <> 'PENDING' then
    raise exception 'Registration is not pending';
  end if;
  if exists (select 1 from users where id = registration.auth_user_id) then
    raise exception 'This account already has a role';
  end if;
  select * into selected_company from companies where id = p_company_id and active for update;
  if not found then raise exception 'Choose an active company'; end if;
  select * into selected_lorry from lorries where id = p_lorry_id for update;
  if not found or not selected_lorry.active or selected_lorry.company_id <> p_company_id or selected_lorry.assigned_driver_id is not null then
    raise exception 'Choose an active, unassigned lorry in this company';
  end if;

  insert into drivers (full_name, phone, licence_number, company_id)
  values (registration.full_name, registration.phone, registration.licence_number, p_company_id)
  returning id into new_driver_id;
  update lorries set assigned_driver_id = new_driver_id where id = p_lorry_id;
  insert into users (id, name, role, driver_id)
  values (registration.auth_user_id, registration.full_name, 'driver', new_driver_id);
  update driver_registration_requests
    set status = 'APPROVED', reviewed_by = p_actor_id, reviewed_at = now()
    where id = p_request_id;
  insert into audit_logs (actor_id, action, entity_type, entity_id, new_value)
  values (p_actor_id, 'DRIVER_REGISTRATION_APPROVED', 'driver_registration_requests', p_request_id::text,
    jsonb_build_object('driver_id', new_driver_id, 'company_id', p_company_id, 'lorry_id', p_lorry_id));
  return new_driver_id;
end $$;

revoke execute on function approve_driver_registration(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function approve_driver_registration(uuid,uuid,uuid,uuid) to service_role;
