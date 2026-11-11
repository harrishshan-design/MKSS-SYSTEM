begin;
do $$
declare a uuid; u uuid:=gen_random_uuid(); d uuid; details jsonb; flags jsonb;
begin
 select id into a from public.users where role='admin' and active limit 1;
 insert into auth.users(id,email) values(u,u::text||'@qa.invalid');
 details:=jsonb_build_object('email',u::text||'@qa.invalid','full_name','Admin Creation QA','phone','0123456789','identity_reference','qa'||u::text,'requested_company','Admin Creation QA','requested_lorry','QA'||u::text,'has_driving_licence',true,'trip_type','Manual');
 perform set_config('role','service_role',true);
 d:=public.admin_create_driver_account(a,u,details);
 if not exists(select 1 from public.users where id=u and role='driver' and driver_id=d) then raise exception 'Driver login not linked'; end if;
 if not exists(select 1 from public.driver_registration_requests where auth_user_id=u and status='APPROVED') then raise exception 'Registration record missing'; end if;
 flags:=public.driver_account_conflicts(a,upper(details->>'email'),replace(details->>'requested_lorry','-',' '),upper(replace(details->>'identity_reference','-',' ')));
 if jsonb_array_length(flags)<>3 then raise exception 'Duplicate flags missing: %',flags; end if;
 begin perform public.admin_create_driver_account(a,u,details); raise exception 'Duplicate creation accepted'; exception when others then if sqlerrm='Duplicate creation accepted' then raise; end if; end;
 if has_function_privilege('authenticated','public.admin_create_driver_account(uuid,uuid,jsonb)','execute') or has_function_privilege('anon','public.driver_account_conflicts(uuid,text,text,text,uuid)','execute') then raise exception 'RPC is exposed'; end if;
end; $$;
rollback;
select 'Admin creation, approved registration, normalized duplicates and private RPC checks passed; fixtures rolled back' as result;
