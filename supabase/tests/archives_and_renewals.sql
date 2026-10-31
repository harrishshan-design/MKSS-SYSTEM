-- All fixtures and deletions roll back. No production records are removed.
begin isolation level repeatable read;
do $$
#variable_conflict use_variable
declare admin_id uuid; auth_id uuid:=gen_random_uuid(); driver_id uuid; company_id uuid; vehicle_id uuid; batch public.archive_batches;
 old_visit uuid; changed_visit uuid; open_visit uuid; timeout_visit uuid; today_visit uuid; referenced_visit uuid; new_visit uuid;
 resource text; token uuid:=gen_random_uuid(); chunk bigint; payload jsonb; page jsonb; qr uuid; request_id uuid; before_count bigint;
begin
 select id into admin_id from public.users where role='admin' and active limit 1;
 if admin_id is null then raise exception 'Active admin needed for test'; end if;
 select count(*) into before_count from public.visits;
 insert into auth.users(id,email) values(auth_id,'rollback-'||auth_id::text||'@example.invalid');
 insert into public.companies(name) values('Rollback archive company '||auth_id::text) returning id into company_id;
 insert into public.drivers(full_name,phone,identity_reference,company_id,default_trip_type,has_driving_licence)
 values('Rollback driver','0000000000',auth_id::text,company_id,'Manual',true) returning id,qr_token into driver_id,qr;
 insert into public.users(id,name,role,driver_id) values(auth_id,'Rollback driver','driver',driver_id);
 insert into public.lorries(registration_number,company_id,vehicle_type,assigned_driver_id) values('TEST'||left(auth_id::text,8),company_id,'Test',driver_id) returning id into vehicle_id;
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,company_time_out,checkout_method,visit_date,created_at,updated_at)
 values(driver_id,vehicle_id,company_id,'COMPLETED',now()-interval '3 days',now()-interval '2 days','GATE',(now()-interval '3 days')::date,now()-interval '3 days',now()-interval '2 days') returning id into old_visit;
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,company_time_out,checkout_method,visit_date,created_at,updated_at)
 values(driver_id,vehicle_id,company_id,'COMPLETED',now()-interval '3 days',now()-interval '2 days','GATE',(now()-interval '3 days')::date,now()-interval '3 days',now()-interval '2 days') returning id into changed_visit;
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,company_time_out,checkout_method,visit_date,created_at,updated_at)
 values(driver_id,vehicle_id,company_id,'COMPLETED',now()-interval '3 days',now()-interval '2 days','GATE',(now()-interval '3 days')::date,now()-interval '3 days',now()-interval '2 days') returning id into referenced_visit;
 insert into public.geofence_events(visit_id,event_type,latitude,longitude,accuracy,occurred_at) values(referenced_visit,'COMPANY_ENTER',0,0,10,now()-interval '2 days');
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,created_at,updated_at)
 values(driver_id,vehicle_id,company_id,'ON_SITE',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days') returning id into open_visit;
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,company_time_out,checkout_method,visit_date,created_at,updated_at)
 values(driver_id,vehicle_id,company_id,'COMPLETED',now()-interval '3 days',now()-interval '2 days','TIME_LIMIT',(now()-interval '3 days')::date,now()-interval '3 days',now()-interval '2 days') returning id into timeout_visit;
 insert into public.visits(driver_id,lorry_id,company_id,status,company_time_in,company_time_out,checkout_method)
 values(driver_id,vehicle_id,company_id,'COMPLETED',now()-interval '1 minute',now(),'GATE') returning id into today_visit;
 batch:=public.archive_start(admin_id);
 foreach resource in array array['geofence_events','audit_logs','security_attendance','contractor_attendance','admin_push_deliveries','excel_sync_queue','visits'] loop perform public.archive_page(batch.id,resource); end loop;
 page:=public.archive_page(batch.id,'visits');
 -- Keyset through all pages: selected fixture IDs must be present, protected ones absent.
 payload:='[]'::jsonb;
 loop
  payload:=payload||coalesce((select jsonb_agg(e) from jsonb_array_elements(page)e where (e->'record'->>'id')::uuid in (old_visit,changed_visit,referenced_visit)),'[]'::jsonb);
  if exists(select 1 from jsonb_array_elements(page)e where (e->'record'->>'id')::uuid in(open_visit,timeout_visit,today_visit)) then raise exception 'Protected visits entered archive'; end if;
  exit when jsonb_array_length(page)=0;
  page:=public.archive_page(batch.id,'visits',(page->(jsonb_array_length(page)-1)->'record'->>'id')::uuid);
 end loop;
 if jsonb_array_length(payload)<>3 then raise exception 'Eligible completed visits missing from export'; end if;
 update public.archive_batches set lease_token=token,lease_until=clock_timestamp()+interval '1 minute' where id=batch.id;
 perform public.archive_commit_chunk(batch.id,token,jsonb_build_object('resource','visits','object_path','rollback-only','sha256','checksum','row_count',3,'stored_bytes',100,'first_at',now()-interval '3 days','last_at',now()-interval '2 days'),(payload->0->'record'->>'id')::uuid);
 select id into chunk from public.archive_chunks where batch_id=batch.id and object_path='rollback-only';
 if (select (resource_counts->>'visits')::integer from public.archive_batches where id=batch.id)<>3 then raise exception 'Per-resource archive totals are incorrect'; end if;
 begin perform public.archive_clean_chunk(chunk,payload); raise exception 'Unconfirmed cleanup accepted';
 exception when others then if sqlerrm<>'Downloaded archive and saved-file confirmation required' then raise; end if; end;
 update public.archive_batches set status='CLEANING',downloaded_at=now(),confirmed_at=now(),confirmed_by=admin_id where id=batch.id;
 update public.visits set purpose='Changed after export' where id=changed_visit;
 insert into public.visits(driver_id,lorry_id,company_id,status) values(driver_id,vehicle_id,company_id,'CANCELLED') returning id into new_visit;
 perform public.archive_clean_chunk(chunk,payload);
 perform public.archive_clean_chunk(chunk,payload); -- Idempotent resume.
 if exists(select 1 from public.visits where id=old_visit) then raise exception 'Unchanged exported visit was not removed'; end if;
 if (select count(*) from public.visits where id in(changed_visit,referenced_visit,open_visit,timeout_visit,today_visit,new_visit))<>6 then raise exception 'Changed/new/active/unverified/referenced data lost'; end if;
 if (select deleted_count from public.archive_batches where id=batch.id)<>1 then raise exception 'Cleanup progress is not idempotent'; end if;
 if not exists(select 1 from public.drivers where id=driver_id and qr_token=qr) or not exists(select 1 from public.lorries where id=vehicle_id) then raise exception 'Master data changed'; end if;
 update public.drivers set registered_at=now()-interval '8 months',last_active_at=now()-interval '7 months' where id=driver_id;
 perform public.expire_idle_drivers(driver_id);
 if (select registration_status from public.drivers where id=driver_id)<>'ACTIVE' then raise exception 'Open trip was expired'; end if;
 delete from public.geofence_events where visit_id=referenced_visit;
 delete from public.visits where public.visits.driver_id=driver_id;
 perform public.expire_idle_drivers(driver_id);
 if (select registration_status from public.drivers where id=driver_id)<>'EXPIRED' then raise exception 'Idle driver was not expired'; end if;
 request_id:=public.request_driver_renewal(auth_id,jsonb_build_object('full_name','Returning driver','phone','0000000000','requested_company',(select name from public.companies where id=company_id),'requested_lorry',(select registration_number from public.lorries where id=vehicle_id),'has_driving_licence',true,'trip_type','Manual'));
 if public.approve_driver_registration_auto(request_id,admin_id)<>driver_id then raise exception 'Renewal created duplicate driver'; end if;
 if not exists(select 1 from public.drivers where id=driver_id and qr_token=qr and registration_version=2 and active and registration_status='ACTIVE') then raise exception 'Driver ID/QR/version not retained'; end if;
 if (select count(*) from public.driver_registration_history h where h.driver_id=driver_id)<>2 then raise exception 'Registration history missing'; end if;
 if (select count(*) from public.visits)<>before_count then raise exception 'Existing production visits changed'; end if;
 if has_table_privilege('authenticated','public.archive_chunks','select') or has_function_privilege('authenticated','public.archive_clean_chunk(bigint,jsonb)','execute') then raise exception 'Archive data exposed to browsers'; end if;
end; $$;
rollback;
select 'PASS: exact archived IDs, changed/active/new/referenced records retained, confirmed cleanup, idempotency, master/QR retention, six-month expiry and same-driver renewal' as verification;
