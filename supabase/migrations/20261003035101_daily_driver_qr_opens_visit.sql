alter table public.visits
  alter column guard_id drop not null,
  add column registration_source text not null default 'GUARD_SCAN'
    check (registration_source in ('GUARD_SCAN','DRIVER_DAILY_QR'));

create function public.check_in_driver_and_open_visit(
  p_actor_id uuid, p_driver_id uuid, p_token uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_date date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_start timestamptz;
  v_qr public.attendance_qr;
  v_driver public.drivers;
  v_lorry public.lorries;
  v_company public.companies;
  v_checkin public.audit_logs;
  v_visit_id uuid;
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
  select id into v_visit_id from public.visits
    where lorry_id = v_lorry.id and status not in ('COMPLETED','CANCELLED')
    order by created_at desc limit 1;
  if v_visit_id is null then
    insert into public.visits(driver_id,lorry_id,company_id,guard_id,visit_date,registration_source,status)
      values(p_driver_id,v_lorry.id,v_driver.company_id,null,v_date,'DRIVER_DAILY_QR','REGISTERED')
      returning id into v_visit_id;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
    values(p_actor_id,'DRIVER_DAILY_CHECKIN','drivers',p_driver_id::text,
      jsonb_build_object('date',v_date,'site',v_qr.site,'driver',v_driver.full_name,
        'company',v_company.name,'lorry',v_lorry.registration_number,'visit_id',v_visit_id))
    returning * into v_checkin;
  return jsonb_build_object('duplicate', false, 'visit_id', v_visit_id,
    'checkin', jsonb_build_object('id', v_checkin.id, 'created_at', v_checkin.created_at,
      'new_value', v_checkin.new_value));
end;
$$;

revoke execute on function public.check_in_driver_and_open_visit(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.check_in_driver_and_open_visit(uuid,uuid,uuid) to service_role;
