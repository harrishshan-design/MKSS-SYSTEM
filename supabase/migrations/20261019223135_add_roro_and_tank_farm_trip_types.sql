alter table public.driver_registration_requests
  drop constraint driver_registration_requests_trip_type_check,
  add constraint driver_registration_requests_trip_type_check
    check (trip_type in ('Hantar Barang', 'Ambil Barang', 'Manual', 'Tank Farm', 'RORO Biru', 'RORO Oren'));

alter table public.drivers
  drop constraint drivers_default_trip_type_check,
  add constraint drivers_default_trip_type_check
    check (default_trip_type in ('Hantar Barang', 'Ambil Barang', 'Manual', 'Tank Farm', 'RORO Biru', 'RORO Oren'));

create or replace function public.set_visit_auto_timeout() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.company_time_in is null or new.auto_timeout_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.company_time_in is not null then return new; end if;
  end if;
  if new.purpose is null then
    select default_trip_type into new.purpose from public.drivers where id = new.driver_id;
  end if;
  if new.purpose in ('Hantar Barang', 'Ambil Barang', 'RORO Biru', 'RORO Oren') then
    new.auto_timeout_at := new.company_time_in + interval '30 minutes';
  elsif new.purpose in ('Manual', 'Tank Farm') then
    new.auto_timeout_at := new.company_time_in + interval '2 hours';
  end if;
  return new;
end;
$$;

create or replace function public.dashboard_metrics(p_date date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total_today', count(*) filter (where visit_date = p_date),
    'inside', count(*) filter (where company_time_in is not null and company_time_out is null
      and status not in ('LEAVING','COMPLETED','CANCELLED')),
    'waiting', count(*) filter (where visit_date = p_date and status in ('REGISTERED','WAITING')),
    'loading', count(*) filter (where status = 'LOADING_UNLOADING'),
    'loading_trips', count(*) filter (where visit_date = p_date and purpose = 'Ambil Barang' and status <> 'CANCELLED'),
    'unloading_trips', count(*) filter (where visit_date = p_date and purpose = 'Hantar Barang' and status <> 'CANCELLED'),
    'manual_loading_trips', count(*) filter (where visit_date = p_date and purpose = 'Manual' and status <> 'CANCELLED'),
    'tank_farm_trips', count(*) filter (where visit_date = p_date and purpose = 'Tank Farm' and status <> 'CANCELLED'),
    'roro_biru_trips', count(*) filter (where visit_date = p_date and purpose = 'RORO Biru' and status <> 'CANCELLED'),
    'roro_oren_trips', count(*) filter (where visit_date = p_date and purpose = 'RORO Oren' and status <> 'CANCELLED'),
    'completed', count(*) filter (where visit_date = p_date and status = 'COMPLETED'),
    'delayed', count(*) filter (where status = 'DELAYED'),
    'average_turnaround_seconds', coalesce(avg(total_duration_seconds) filter
      (where visit_date = p_date and status = 'COMPLETED'),0)
  ) from public.visits;
$$;
