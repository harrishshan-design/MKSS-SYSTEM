alter table public.settings drop constraint settings_exit_radius_meters_check;
alter table public.settings add constraint settings_exit_radius_meters_check
  check (exit_radius_meters between 100 and 50000);

update public.geofences set radius_meters = 200 where kind = 'company';
update public.settings set exit_radius_meters = 200, exit_confirmation_seconds = 30 where id = 1;
