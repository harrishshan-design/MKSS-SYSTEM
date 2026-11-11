-- Server-only duplicate lookup and atomic admin registration/approval.
create function public.driver_account_conflicts(p_actor uuid,p_email text,p_vehicle text,p_identity text,p_exclude uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare flags jsonb:='[]';
begin
 if not exists(select 1 from public.users where id=p_actor and role='admin' and active) then raise exception 'Active administrator required'; end if;
 if exists(select 1 from auth.users where lower(email)=lower(trim(p_email)) and id is distinct from p_exclude)
 or exists(select 1 from public.driver_registration_requests where lower(email)=lower(trim(p_email)) and status='PENDING' and auth_user_id is distinct from p_exclude)
 then flags:=flags||jsonb_build_array('Email already registered. Find the existing account under User accounts, or review its pending registration.'); end if;
 if exists(select 1 from public.lorries where regexp_replace(upper(registration_number),'[^A-Z0-9]','','g')=regexp_replace(upper(p_vehicle),'[^A-Z0-9]','','g'))
 or exists(select 1 from public.driver_registration_requests where status='PENDING' and auth_user_id is distinct from p_exclude and regexp_replace(upper(requested_lorry),'[^A-Z0-9]','','g')=regexp_replace(upper(p_vehicle),'[^A-Z0-9]','','g'))
 then flags:=flags||jsonb_build_array('Lorry number already exists or has a pending registration. Review the existing lorry/driver instead of creating a duplicate.'); end if;
 if exists(select 1 from public.drivers where regexp_replace(upper(identity_reference),'[^A-Z0-9]','','g')=regexp_replace(upper(p_identity),'[^A-Z0-9]','','g'))
 or exists(select 1 from public.driver_registration_requests where status='PENDING' and auth_user_id is distinct from p_exclude and regexp_replace(upper(identity_reference),'[^A-Z0-9]','','g')=regexp_replace(upper(p_identity),'[^A-Z0-9]','','g'))
 then flags:=flags||jsonb_build_array('IC / identity number already exists or has a pending registration. Use or recover the existing driver account.'); end if;
 return flags;
end; $$;

create function public.admin_create_driver_account(p_actor uuid,p_user uuid,p_details jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare flags jsonb; request_id uuid; driver_id uuid;
begin
 perform pg_advisory_xact_lock(9111101);
 flags:=public.driver_account_conflicts(p_actor,p_details->>'email',p_details->>'requested_lorry',p_details->>'identity_reference',p_user);
 if jsonb_array_length(flags)>0 then raise exception '%',(select string_agg(value,' ') from jsonb_array_elements_text(flags)); end if;
 if exists(select 1 from public.users where id=p_user) or not exists(select 1 from auth.users where id=p_user and lower(email)=lower(p_details->>'email')) then raise exception 'Login account mismatch'; end if;
 insert into public.driver_registration_requests(auth_user_id,email,full_name,phone,identity_reference,requested_company,requested_lorry,has_driving_licence,trip_type)
 values(p_user,p_details->>'email',p_details->>'full_name',p_details->>'phone',p_details->>'identity_reference',p_details->>'requested_company',p_details->>'requested_lorry',(p_details->>'has_driving_licence')::boolean,p_details->>'trip_type') returning id into request_id;
 driver_id:=public.approve_driver_registration_auto(request_id,p_actor);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor,'ADMIN_DRIVER_ACCOUNT_CREATED','users',p_user::text,jsonb_build_object('request_id',request_id,'driver_id',driver_id));
 return driver_id;
end; $$;
revoke all on function public.driver_account_conflicts(uuid,text,text,text,uuid),public.admin_create_driver_account(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.driver_account_conflicts(uuid,text,text,text,uuid),public.admin_create_driver_account(uuid,uuid,jsonb) to service_role;
