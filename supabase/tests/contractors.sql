-- Transactional fixtures only; no test accounts or attendance are retained.
begin isolation level repeatable read;
do $$
declare test_user uuid:=gen_random_uuid(); person uuid; admin_id uuid; first_scan public.contractor_attendance; second_scan public.contractor_attendance; trips_before bigint;
begin
 select count(*) into trips_before from public.visits;
 insert into auth.users(id) values(test_user);
 person:=public.register_contractor(test_user,'Rollback contractor fixture','000000000000','Temporary verification','IT');
 if (select role::text from public.users where id=test_user)<>'contractor' then raise exception 'Contractor role missing'; end if;
 if (select status from public.contractors where id=person)<>'APPROVED' then raise exception 'Self registration is not immediately active'; end if;
 begin
  perform public.scan_contractor_attendance(test_user,'Test gate','in');
  raise exception 'Missing Pass ID was accepted';
 exception when others then
  if sqlerrm <> 'Enter a Pass ID of 1 to 80 characters before clocking in' then raise; end if;
 end;
 first_scan:=public.scan_contractor_attendance(test_user,'Test gate','in','  PASS-001  ');
 if first_scan.pass_id<>'PASS-001' then raise exception 'Pass ID was not saved'; end if;
 second_scan:=public.scan_contractor_attendance(test_user,'Test gate','in','PASS-CHANGED');
 if second_scan.pass_id<>'PASS-001' then raise exception 'Retry changed original Pass ID'; end if;
 if first_scan.id<>second_scan.id then raise exception 'Duplicate attendance created'; end if;
 if first_scan.time_in<clock_timestamp()-interval '5 seconds' then raise exception 'Attendance did not use actual database time'; end if;
 begin
  perform public.scan_contractor_attendance(test_user,'Test gate','out');
  raise exception 'Accidental immediate checkout was accepted';
 exception when others then
  if sqlerrm <> 'Already clocked in. Wait one minute before clocking out' then raise; end if;
 end;
 update public.contractor_attendance set time_in=clock_timestamp()-interval '2 minutes' where id=first_scan.id;
 second_scan:=public.scan_contractor_attendance(test_user,'Test gate','out');
 if second_scan.pass_id<>'PASS-001' then raise exception 'Checkout lost Pass ID'; end if;
 if not exists(select 1 from jsonb_array_elements(public.contractor_snapshot(first_scan.date,true)->'attendance') a where a->>'id'=first_scan.id::text and a->>'pass_id'='PASS-001') then raise exception 'Dashboard/export snapshot lost Pass ID'; end if;
 if second_scan.time_out is null then raise exception 'Checkout not saved'; end if;
 if (public.scan_contractor_attendance(test_user,'Test gate','out')).time_out<>second_scan.time_out then raise exception 'Repeated checkout changed timestamp'; end if;
 select id into admin_id from public.users where role='admin' and active limit 1;
 if admin_id is null then raise exception 'No active administrator for test'; end if;
 perform public.review_contractor(admin_id,person,'Edited contractor fixture','Updated company','Safety','INACTIVE');
 begin
  perform public.scan_contractor_attendance(test_user,'Test gate','in');
  raise exception 'Inactive contractor was allowed to scan';
 exception when others then
  if sqlerrm <> 'Contractor account is not active. Contact the site administrator' then raise; end if;
 end;
 if (select name from public.users where id=test_user)<>'Edited contractor fixture' then raise exception 'Admin edit did not synchronize'; end if;
 perform set_config('request.jwt.claim.sub',test_user::text,true);
 if not mkss_private.can_receive_changes('mkss:contractor:'||person::text)
  or mkss_private.can_receive_changes('mkss:operations') or mkss_private.can_receive_changes('mkss:driver:'||person::text) then raise exception 'Contractor channel isolation failed'; end if;
 if (select count(*) from public.visits)<>trips_before then raise exception 'Contractor scan changed lorry visits'; end if;
 if has_table_privilege('anon','public.contractors','select') or has_table_privilege('authenticated','public.contractors','insert')
 or has_function_privilege('authenticated','public.scan_contractor_attendance(uuid,text,text,text)','execute') then raise exception 'Contractor data is directly exposed'; end if;
end; $$;
rollback;
select 'PASS: immediate contractor registration, Pass ID validation and retention, admin deactivation, actual timestamps, duplicate scans, isolated channels and no lorry trips' as verification;
