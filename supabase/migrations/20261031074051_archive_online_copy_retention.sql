alter table public.archive_batches add column files_removed_at timestamptz;
create or replace function public.refresh_database_health() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 update public.database_health set measured_bytes=pg_database_size(current_database()),measured_at=clock_timestamp() where id=1;
 select to_jsonb(h)||jsonb_build_object('visits',(select count(*) from public.visits),
 'drivers',(select count(*) from public.drivers),'vehicles',(select count(*) from public.lorries),
 'oldest_record',(select min(created_at) from public.visits),
 'archive_bytes',(select coalesce(sum(stored_bytes),0) from public.archive_batches where status<>'CANCELLED' and files_removed_at is null)) into result
 from public.database_health h where id=1;
 return result;
end; $$;

