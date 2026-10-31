alter table public.archive_batches add column resource_counts jsonb not null default '{}'::jsonb;
create or replace function public.archive_commit_chunk(p_batch uuid,p_token uuid,p_chunk jsonb,p_last uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.archive_batches;
begin
 select * into b from public.archive_batches where id=p_batch for update;
 if b.status<>'EXPORTING' or b.lease_token is distinct from p_token or b.lease_until<clock_timestamp() then raise exception 'Export lease expired. Retry'; end if;
 insert into public.archive_chunks(batch_id,resource,object_path,sha256,row_count,first_at,last_at,stored_bytes)
 values(p_batch,p_chunk->>'resource',p_chunk->>'object_path',p_chunk->>'sha256',(p_chunk->>'row_count')::integer,
 (p_chunk->>'first_at')::timestamptz,(p_chunk->>'last_at')::timestamptz,(p_chunk->>'stored_bytes')::bigint);
 update public.archive_batches set resource_counts=jsonb_set(resource_counts,array[p_chunk->>'resource'],to_jsonb(coalesce((resource_counts->>(p_chunk->>'resource'))::bigint,0)+(p_chunk->>'row_count')::integer)),last_id=p_last,record_count=record_count+(p_chunk->>'row_count')::integer,
 stored_bytes=stored_bytes+(p_chunk->>'stored_bytes')::bigint,
 period_start=least(period_start,(p_chunk->>'first_at')::timestamptz),period_end=greatest(period_end,(p_chunk->>'last_at')::timestamptz) where id=p_batch;
end; $$;
