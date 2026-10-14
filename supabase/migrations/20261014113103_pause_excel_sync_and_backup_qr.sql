-- Keep historical Excel connection and queue data, but stop creating jobs.
-- This lets CSV exports use Supabase directly while Microsoft sync is paused.
create or replace function public.queue_excel_sync() returns trigger
language plpgsql as $$
begin
  return new;
end;
$$;

-- A printable fallback QR is generated once and kept server-side. The server
-- still records attendance against its current Malaysia date and real time.
create table public.site_backup_qr (
  id integer primary key default 1 check (id = 1),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
insert into public.site_backup_qr (id) values (1);
alter table public.site_backup_qr enable row level security;
revoke all on public.site_backup_qr from public, anon, authenticated;
grant select on public.site_backup_qr to service_role;
