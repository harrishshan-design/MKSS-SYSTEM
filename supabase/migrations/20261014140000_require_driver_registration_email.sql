-- New driver registrations always include a real contact email. Drivers may
-- still use their vehicle number instead of email at sign-in.
alter table public.driver_registration_requests
  alter column email set not null;
