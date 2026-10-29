-- Contractors self-register; admin blocks and edits remain effective.
alter table public.contractors alter column status set default 'APPROVED';
update public.contractors set status='APPROVED',updated_at=clock_timestamp() where status='PENDING';

create or replace function public.register_contractor(p_user uuid,p_name text,p_ic text,p_company text,p_work text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.contractors(auth_user_id,full_name,identity_reference,company_name,work_type,status)
 values(p_user,p_name,p_ic,p_company,p_work,'APPROVED') returning id into result;
 insert into public.users(id,name,role,contractor_id) values(p_user,p_name,'contractor',result);
 return result;
end; $$;

create or replace function public.scan_contractor_attendance(p_actor uuid,p_site text,p_action text)
returns public.contractor_attendance language plpgsql security invoker set search_path='' as $$
declare person public.contractors; result public.contractor_attendance; today date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 select c.* into person from public.contractors c join public.users u on u.contractor_id=c.id
 where u.id=p_actor and u.active and u.role='contractor' for update of c;
 if not found or person.status<>'APPROVED' then raise exception 'Contractor account is not active. Contact the site administrator'; end if;
 select * into result from public.contractor_attendance where contractor_id=person.id and date=today for update;
 if p_action='in' then
   if found then return result; end if;
   insert into public.contractor_attendance(contractor_id,date,site) values(person.id,today,p_site) returning * into result;
 elsif p_action='out' then
   if not found then raise exception 'Clock in first'; end if;
   if result.time_out is not null then return result; end if;
   if clock_timestamp()-result.time_in<interval '1 minute' then raise exception 'Already clocked in. Wait one minute before clocking out'; end if;
   update public.contractor_attendance set time_out=clock_timestamp() where id=result.id returning * into result;
 else raise exception 'Invalid attendance action'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor,case when p_action='in' then 'CONTRACTOR_CLOCK_IN' else 'CONTRACTOR_CLOCK_OUT' end,'contractor_attendance',result.id::text,
 jsonb_build_object('contractor_id',person.id,'date',today,'time_in',result.time_in,'time_out',result.time_out));
 return result;
end; $$;

