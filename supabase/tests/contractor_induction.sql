begin;
do $$
declare uid uuid:=gen_random_uuid(); cid uuid; stamp timestamptz; result public.contractor_attendance; blocked boolean:=false;
begin
 insert into auth.users(id,email) values(uid,uid::text||'@mkss-test.invalid');
 cid:=public.register_contractor(uid,'Induction QA','998877665544','QA company','IT');
 begin perform public.scan_contractor_attendance(uid,'QA','in','QA-1');
 exception when others then if sqlerrm not like '%safety induction%' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Clock-in bypassed induction'; end if;
 blocked:=false;
 begin insert into public.contractor_attendance(contractor_id,date,site,pass_id) values(cid,current_date,'QA','QA-1');
 exception when others then if sqlerrm not like '%safety induction%' then raise; end if; blocked:=true; end;
 if not blocked then raise exception 'Insert bypassed induction'; end if;
 perform public.confirm_contractor_induction(uid);
 select induction_confirmed_at into stamp from public.contractors where id=cid;
 perform public.confirm_contractor_induction(uid);
 if stamp is distinct from (select induction_confirmed_at from public.contractors where id=cid) then raise exception 'Retry replaced confirmation'; end if;
 if (select count(*) from public.audit_logs where actor_id=uid and action='CONTRACTOR_INDUCTION_SELF_DECLARED')<>1 then raise exception 'Confirmation audit duplicated'; end if;
 result:=public.scan_contractor_attendance(uid,'QA','in','QA-1');
 if result.time_in is null or result.pass_id<>'QA-1' then raise exception 'Confirmed time-in failed'; end if;
 update public.contractor_attendance set time_in=clock_timestamp()-interval '2 minutes' where id=result.id;
 update public.contractors set induction_version=null,induction_confirmed_at=null where id=cid;
 result:=public.scan_contractor_attendance(uid,'QA','out',null);
 if result.time_out is null then raise exception 'Existing clock-out blocked'; end if;
 if has_function_privilege('authenticated','public.confirm_contractor_induction(uuid)','execute')
 or has_function_privilege('anon','public.confirm_contractor_induction(uuid)','execute') then raise exception 'Exposed RPC'; end if;
end; $$;
rollback;
select 'induction checks passed; all fixtures rolled back' as result;
