-- A driver scanning the site QR is a server-recorded entry event. This also
-- covers drivers whose phone never provided an on-site GPS reading.
create or replace function public.check_in_driver_and_open_visit(
  p_actor_id uuid, p_driver_id uuid, p_token uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_start timestamptz;
  v_entry_at timestamptz;
  v_qr public.attendance_qr;
  v_driver public.drivers;
  v_lorry public.lorries;
  v_company public.companies;
  v_checkin public.audit_logs;
  v_visit public.visits;
begin
  if not exists (select 1 from public.users
    where id = p_actor_id and role = 'driver' and active and driver_id = p_driver_id) then
    raise exception 'Active driver account required';
  end if;
  select * into v_qr from public.attendance_qr where date = v_date and token = p_token;
  if not found then raise exception 'This is not today''s site QR'; end if;
  select * into v_driver from public.drivers where id = p_driver_id and active for update;
  if not found then raise exception 'Driver account is inactive'; end if;
  select * into v_lorry from public.lorries
    where assigned_driver_id = p_driver_id and active order by created_at limit 1 for update;
  if not found then raise exception 'No active lorry is assigned to this driver'; end if;
  if v_lorry.company_id <> v_driver.company_id then
    raise exception 'Driver and lorry companies do not match';
  end if;
  select * into v_company from public.companies where id = v_driver.company_id;
  v_start := v_date::timestamp at time zone 'Asia/Kuala_Lumpur';
  select * into v_checkin from public.audit_logs
    where action = 'DRIVER_DAILY_CHECKIN' and entity_id = p_driver_id::text
      and created_at >= v_start and created_at < v_start + interval '1 day'
    order by created_at desc limit 1;
  if found then
    return jsonb_build_object('duplicate', true,
      'checkin', jsonb_build_object('id', v_checkin.id, 'created_at', v_checkin.created_at,
        'new_value', v_checkin.new_value));
  end if;
  select * into v_visit from public.visits
    where lorry_id = v_lorry.id and status not in ('COMPLETED','CANCELLED')
    order by created_at desc limit 1 for update;
  v_entry_at := clock_timestamp();
  if v_visit.id is null then
    insert into public.visits(driver_id,lorry_id,company_id,guard_id,visit_date,
      registration_source,status,security_registered_at,company_time_in)
      values(p_driver_id,v_lorry.id,v_driver.company_id,null,v_date,
        'DRIVER_DAILY_QR','ON_SITE',v_entry_at,v_entry_at)
      returning * into v_visit;
  elsif v_visit.visit_date = v_date and v_visit.company_time_in is null then
    update public.visits set company_time_in = v_entry_at, status = 'ON_SITE'
      where id = v_visit.id returning * into v_visit;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
    values(p_actor_id,'DRIVER_DAILY_CHECKIN','drivers',p_driver_id::text,
      jsonb_build_object('date',v_date,'site',v_qr.site,'driver',v_driver.full_name,
        'company',v_company.name,'lorry',v_lorry.registration_number,'visit_id',v_visit.id))
    returning * into v_checkin;
  return jsonb_build_object('duplicate', false, 'visit_id', v_visit.id,
    'checkin', jsonb_build_object('id', v_checkin.id, 'created_at', v_checkin.created_at,
      'new_value', v_checkin.new_value));
end;
$$;

-- Today's already-scanned QR visits retain their real original scan time.
update public.visits v
set company_time_in = v.security_registered_at, status = 'ON_SITE'
where v.registration_source = 'DRIVER_DAILY_QR'
  and v.visit_date = (now() at time zone 'Asia/Kuala_Lumpur')::date
  and v.company_time_in is null and v.status = 'REGISTERED'
  and exists (
    select 1 from public.audit_logs a
    where a.action = 'DRIVER_DAILY_CHECKIN'
      and a.new_value->>'visit_id' = v.id::text
      and a.created_at >= v.security_registered_at
  );
