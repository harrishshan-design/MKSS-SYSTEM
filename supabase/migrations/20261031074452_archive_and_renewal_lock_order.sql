create or replace function public.archive_clean_chunk(p_chunk bigint,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.archive_chunks; b public.archive_batches; deleted integer; condition text;
begin
 select * into c from public.archive_chunks where id=p_chunk for update;
 if not found then raise exception 'Archive chunk missing'; end if;
 select * into b from public.archive_batches where id=c.batch_id for update;
 if b.status<>'CLEANING' or b.confirmed_at is null or b.downloaded_at is null then raise exception 'Downloaded archive and saved-file confirmation required'; end if;
 if c.cleaned_at is not null then return jsonb_build_object('deleted',c.deleted_count,'retained',c.retained_count); end if;
 if jsonb_array_length(p_rows)<>c.row_count then raise exception 'Archive manifest count mismatch'; end if;
 condition:=mkss_private.archive_condition(c.resource,b.cutoff);
 if c.resource='visits' then
   -- Lock referenced parent rows before the DELETE's fresh Read Committed snapshot.
   -- Concurrent FK inserts must finish first or wait; none can cascade out unseen.
   perform 1 from public.visits t join jsonb_array_elements(p_rows) r on t.id=(r->'record'->>'id')::uuid order by t.id for update of t;
   condition:=condition||' and not exists(select 1 from public.geofence_events g where g.visit_id=t.id)';
 end if;
 -- Compare exact exported IDs AND row fingerprints. Changed/new rows survive.
 execute format('delete from public.%I t using jsonb_array_elements($1) r where t.id=(r->''record''->>''id'')::uuid and md5(to_jsonb(t)::text)=r->>''hash'' and %s',c.resource,condition) using p_rows;
 get diagnostics deleted=row_count;
 update public.archive_chunks set cleaned_at=clock_timestamp(),deleted_count=deleted,retained_count=c.row_count-deleted where id=c.id;
 update public.archive_batches set deleted_count=deleted_count+deleted,retained_count=retained_count+c.row_count-deleted where id=b.id;
 return jsonb_build_object('deleted',deleted,'retained',c.row_count-deleted);
end; $$;

create or replace function public.request_driver_renewal(p_actor uuid,p_details jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare person public.drivers; result uuid; account_email text;
begin
 perform 1 from public.driver_registration_requests where auth_user_id=p_actor for update;
 select d.* into person from public.drivers d join public.users u on u.driver_id=d.id where u.id=p_actor and u.active and u.role='driver' for update of d;
 if not found or person.registration_status<>'EXPIRED' then raise exception 'Only an expired driver can request re-registration'; end if;
 select email into account_email from auth.users where id=p_actor;
 insert into public.driver_registration_requests(auth_user_id,email,full_name,phone,identity_reference,requested_company,requested_lorry,has_driving_licence,trip_type,status,renewal_driver_id)
 values(p_actor,account_email,p_details->>'full_name',p_details->>'phone',person.identity_reference,p_details->>'requested_company',p_details->>'requested_lorry',(p_details->>'has_driving_licence')::boolean,p_details->>'trip_type','PENDING',person.id)
 on conflict(auth_user_id) do update set full_name=excluded.full_name,phone=excluded.phone,identity_reference=excluded.identity_reference,
 requested_company=excluded.requested_company,requested_lorry=excluded.requested_lorry,has_driving_licence=excluded.has_driving_licence,
 trip_type=excluded.trip_type,status='PENDING',renewal_driver_id=person.id,reviewed_by=null,reviewed_at=null,updated_at=clock_timestamp()
 returning id into result;
 insert into public.driver_registration_history(driver_id,registration_version,status,details)
 values(person.id,person.registration_version+1,'PENDING',p_details)
 on conflict(driver_id,registration_version) do update set details=excluded.details,status='PENDING';
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor,'DRIVER_RENEWAL_REQUESTED','drivers',person.id::text,jsonb_build_object('request_id',result,'version',person.registration_version+1));
 return result;
end; $$;

