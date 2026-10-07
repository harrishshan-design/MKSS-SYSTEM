alter table public.users drop constraint role_link;
alter table public.users add constraint role_link check (
  (role = 'guard' and guard_id is not null and driver_id is null)
  or (role = 'driver' and driver_id is not null and guard_id is null)
  or (role in ('admin', 'monitor') and guard_id is null and driver_id is null)
);
