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
    'completed', count(*) filter (where visit_date = p_date and status = 'COMPLETED'),
    'delayed', count(*) filter (where status = 'DELAYED'),
    'average_turnaround_seconds', coalesce(avg(total_duration_seconds) filter
      (where visit_date = p_date and status = 'COMPLETED'),0)
  ) from public.visits;
$$;
