-- Capture human report identities at export time; original cleanup hashes remain unchanged.
create or replace function public.archive_page(p_batch uuid,p_resource text,p_after uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.archive_batches; result jsonb; condition text; context_sql text := '''{}''::jsonb';
begin
 select * into b from public.archive_batches where id=p_batch;
 if not found or b.status<>'EXPORTING' then raise exception 'Archive is not exporting'; end if;
 condition:=mkss_private.archive_condition(p_resource,b.cutoff);
 if p_resource='visits' then
 context_sql:='jsonb_build_object(''identity_reference'',(select identity_reference from public.drivers where id=t.driver_id),''driver'',(select full_name from public.drivers where id=t.driver_id),''company'',(select name from public.companies where id=t.company_id),''vehicle'',(select registration_number from public.lorries where id=t.lorry_id))';
 elsif p_resource='contractor_attendance' then context_sql:='(select jsonb_build_object(''name'',full_name,''identity_reference'',identity_reference,''company'',company_name,''work_type'',work_type) from public.contractors where id=t.contractor_id)';
 elsif p_resource='security_attendance' then context_sql:='(select jsonb_build_object(''name'',full_name) from public.security_guards where id=t.guard_id)'; end if;
 execute format('select coalesce(jsonb_agg(x),''[]''::jsonb) from (select to_jsonb(t) as record,md5(to_jsonb(t)::text) as hash,%s as context from public.%I t where %s and ($1 is null or t.id>$1) order by t.id limit 500)x',context_sql,p_resource,condition)
 into result using p_after;
 return result;
end; $$;

