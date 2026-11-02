begin;
do $$
declare b public.archive_batches; uid uuid:=gen_random_uuid(); cid uuid; rows jsonb; item jsonb;
begin
 b:=public.archive_start((select id from public.users where role='admin' and active limit 1));
 rows:=public.archive_page(b.id,'visits');
 if jsonb_array_length(rows)=0 then raise exception 'Expected historical visit sample'; end if;
 for item in select value from jsonb_array_elements(rows) loop
   if not exists(select 1 from public.drivers d where d.id=(item->'record'->>'driver_id')::uuid
     and d.identity_reference is not distinct from item->'context'->>'identity_reference'
     and d.full_name is not distinct from item->'context'->>'driver') then raise exception 'Driver context mismatch'; end if;
 end loop;
 insert into auth.users(id,email) values(uid,uid::text||'@mkss-test.invalid');
 cid:=public.register_contractor(uid,'Archive QA','998877665543','Archive QA Services','IT');
 perform public.confirm_contractor_induction(uid);
 insert into public.contractor_attendance(contractor_id,date,site,time_in,time_out,pass_id)
 values(cid,(b.cutoff at time zone 'Asia/Kuala_Lumpur')::date-1,'QA',b.cutoff-interval '3 hours',b.cutoff-interval '2 hours','QA');
 rows:=public.archive_page(b.id,'contractor_attendance');
 if not exists(select 1 from jsonb_array_elements(rows) x where x->'context'->>'identity_reference'='998877665543'
 and x->'context'->>'name'='Archive QA' and x->'context'->>'company'='Archive QA Services') then raise exception 'Contractor context missing'; end if;
 if has_function_privilege('authenticated','public.archive_page(uuid,text,uuid)','execute') then raise exception 'Exposed archive function'; end if;
end; $$;
rollback;
select 'archive identities verified against source records; all fixtures rolled back' as result;
