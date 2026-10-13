alter table public.driver_registration_requests
  drop constraint driver_registration_requests_trip_type_check,
  add constraint driver_registration_requests_trip_type_check
    check (trip_type in ('Hantar Barang', 'Ambil Barang', 'Manual'));

alter table public.drivers
  drop constraint drivers_default_trip_type_check,
  add constraint drivers_default_trip_type_check
    check (default_trip_type in ('Hantar Barang', 'Ambil Barang', 'Manual'));

alter table public.visits
  add column auto_timeout_at timestamptz,
  add column checkout_method text
    check (checkout_method in ('TIME_LIMIT', 'GATE', 'ADMIN'));

create index visits_auto_timeout_due_idx on public.visits(auto_timeout_at)
  where auto_timeout_at is not null and company_time_out is null;

-- A visit's deadline is fixed when its actual site entry is recorded. Existing
-- open visits are intentionally left without a deadline for admin review.
create function public.set_visit_auto_timeout() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.company_time_in is null or new.auto_timeout_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.company_time_in is not null then return new; end if;
  end if;
  if new.purpose is null then
    select default_trip_type into new.purpose from public.drivers where id = new.driver_id;
  end if;
  if new.purpose in ('Hantar Barang', 'Ambil Barang') then
    new.auto_timeout_at := new.company_time_in + interval '30 minutes';
  elsif new.purpose = 'Manual' then
    new.auto_timeout_at := new.company_time_in + interval '2 hours';
  end if;
  return new;
end;
$$;
create trigger set_visit_auto_timeout before insert or update of company_time_in on public.visits
  for each row execute function public.set_visit_auto_timeout();
revoke execute on function public.set_visit_auto_timeout() from public, anon, authenticated;
grant execute on function public.set_visit_auto_timeout() to service_role;

-- Only the database clock supplies the recorded time. The deadline is never
-- presented as proof that a vehicle physically crossed the gate.
create function public.run_visit_auto_timeouts() returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  previous_visit public.visits;
  updated_visit public.visits;
  recorded_at timestamptz;
  processed integer := 0;
begin
  for previous_visit in
    select * from public.visits
    where auto_timeout_at <= clock_timestamp()
      and company_time_out is null
      and status not in ('COMPLETED', 'CANCELLED')
    order by auto_timeout_at limit 500 for update skip locked
  loop
    recorded_at := clock_timestamp();
    update public.visits set
      company_time_out = recorded_at,
      status = 'COMPLETED',
      checkout_method = 'TIME_LIMIT',
      exit_pending_at = null,
      total_duration_seconds = greatest(0, extract(epoch from recorded_at - previous_visit.company_time_in)::integer)
    where id = previous_visit.id and company_time_out is null
    returning * into updated_visit;
    if found then
      insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_value, new_value, reason)
      values(null, 'AUTO_TIME_LIMIT_CHECKOUT', 'visits', previous_visit.id::text,
        jsonb_build_object('status', previous_visit.status, 'company_time_out', previous_visit.company_time_out),
        jsonb_build_object('status', updated_visit.status, 'company_time_out', recorded_at,
          'checkout_method', 'TIME_LIMIT', 'auto_timeout_at', previous_visit.auto_timeout_at),
        'Configured trip time limit reached; physical gate exit has not been verified');
      processed := processed + 1;
    end if;
  end loop;
  return processed;
end;
$$;
revoke execute on function public.run_visit_auto_timeouts() from public, anon, authenticated;
grant execute on function public.run_visit_auto_timeouts() to service_role;

-- An admin correction of a timed-out record is no longer an unverified timer.
create function public.mark_timed_out_correction() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.checkout_method = 'TIME_LIMIT' and new.checkout_method = 'TIME_LIMIT'
    and new.company_time_out is distinct from old.company_time_out then
    new.checkout_method := 'ADMIN';
  end if;
  return new;
end;
$$;
create trigger mark_timed_out_correction before update of company_time_out on public.visits
  for each row execute function public.mark_timed_out_correction();
revoke execute on function public.mark_timed_out_correction() from public, anon, authenticated;
grant execute on function public.mark_timed_out_correction() to service_role;

-- A guard may replace a time-limit checkout with the observed gate time.
create or replace function public.confirm_guard_exit(p_actor_id uuid, p_driver_id uuid)
returns public.visits language plpgsql security invoker set search_path = '' as $$
declare
  old_visit public.visits;
  updated_visit public.visits;
  exit_at timestamptz;
begin
  if not exists (
    select 1 from public.users u join public.security_guards g on g.id = u.guard_id
    where u.id = p_actor_id and u.role = 'guard' and u.active and g.active
  ) then raise exception 'Active guard required'; end if;
  select * into old_visit from public.visits
    where driver_id = p_driver_id
      and (status not in ('COMPLETED','CANCELLED')
        or (status = 'COMPLETED' and checkout_method = 'TIME_LIMIT'
          and company_time_out >= clock_timestamp() - interval '1 day'))
    order by case when status not in ('COMPLETED','CANCELLED') then 0 else 1 end, created_at desc
    limit 1 for update;
  if not found then raise exception 'No open or unverified timed-out visit for this driver'; end if;
  if old_visit.company_time_in is null then raise exception 'Site entry must be recorded before exit'; end if;
  exit_at := clock_timestamp();
  update public.visits set
    company_time_out = exit_at,
    status = 'COMPLETED',
    checkout_method = 'GATE',
    exit_pending_at = null,
    total_duration_seconds = greatest(0,extract(epoch from exit_at - old_visit.company_time_in)::integer),
    loading_area_out = case when old_visit.loading_area_in is not null and old_visit.loading_area_out is null
      then exit_at else loading_area_out end,
    loading_duration_seconds = case when old_visit.loading_area_in is not null and old_visit.loading_area_out is null
      then greatest(0,extract(epoch from exit_at - old_visit.loading_area_in)::integer) else loading_duration_seconds end
    where id = old_visit.id returning * into updated_visit;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value,reason)
    values(p_actor_id,'GUARD_EXIT_CONFIRMED','visits',old_visit.id::text,
      jsonb_build_object('status',old_visit.status,'company_time_out',old_visit.company_time_out,
        'checkout_method',old_visit.checkout_method),
      jsonb_build_object('status',updated_visit.status,'company_time_out',updated_visit.company_time_out,
        'checkout_method',updated_visit.checkout_method),
      'Driver QR scanned at the physical exit gate');
  return updated_visit;
end;
$$;

select cron.schedule('mkss-visit-auto-timeout', '* * * * *',
  'select public.run_visit_auto_timeouts();');
