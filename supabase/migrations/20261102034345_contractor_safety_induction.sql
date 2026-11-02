-- Self-declared submission, not a verified Google Form result. Existing clock-outs remain available.
alter table public.contractors add column induction_version text,
 add column induction_confirmed_at timestamptz;
create function public.confirm_contractor_induction(p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare person public.contractors;
begin
 select c.* into person from public.contractors c join public.users u on u.id=c.auth_user_id
 where u.id=p_actor and u.role='contractor' and u.active for update of c;
 if not found or person.status<>'APPROVED' then raise exception 'Contractor account is not active'; end if;
 if person.induction_version='pcg-contractor-v1' and person.induction_confirmed_at is not null then
   return jsonb_build_object('induction_version',person.induction_version,'induction_confirmed_at',person.induction_confirmed_at);
 end if;
 update public.contractors set induction_version='pcg-contractor-v1',induction_confirmed_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=person.id returning * into person;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor,'CONTRACTOR_INDUCTION_SELF_DECLARED','contractors',person.id::text,
 jsonb_build_object('version',person.induction_version,'confirmed_at',person.induction_confirmed_at,'method','SELF_DECLARED','url','https://forms.gle/gxBUR5XNPesDPL8CA'));
 return jsonb_build_object('induction_version',person.induction_version,'induction_confirmed_at',person.induction_confirmed_at);
end; $$;
revoke all on function public.confirm_contractor_induction(uuid) from public,anon,authenticated;
grant execute on function public.confirm_contractor_induction(uuid) to service_role;

-- Also protect new attendance inserts from any alternate server path.
create function mkss_private.require_contractor_induction() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.contractors where id=new.contractor_id
 and induction_version='pcg-contractor-v1' and induction_confirmed_at is not null for share;
 if not found then raise exception 'Complete and confirm the safety induction before clocking in'; end if;
 return new;
end; $$;
revoke all on function mkss_private.require_contractor_induction() from public,anon,authenticated;
grant execute on function mkss_private.require_contractor_induction() to service_role;
create trigger contractor_induction_before_attendance before insert on public.contractor_attendance
for each row execute function mkss_private.require_contractor_induction();

create or replace function public.scan_contractor_attendance(p_actor uuid,p_site text,p_action text,p_pass_id text default null)
returns public.contractor_attendance language plpgsql security invoker set search_path='' as $$
declare person public.contractors; result public.contractor_attendance; today date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 select c.* into person from public.contractors c join public.users u on u.contractor_id=c.id
 where u.id=p_actor and u.active and u.role='contractor' for update of c;
 if not found or person.status<>'APPROVED' then raise exception 'Contractor account is not active. Contact the site administrator'; end if;
 select * into result from public.contractor_attendance where contractor_id=person.id and date=today for update;
 if p_action='in' then
   if found then return result; end if;
   if person.induction_version is distinct from 'pcg-contractor-v1' or person.induction_confirmed_at is null then raise exception 'Complete and confirm the safety induction before clocking in'; end if;
   if p_pass_id is null or length(btrim(p_pass_id)) not between 1 and 80 then raise exception 'Enter a Pass ID of 1 to 80 characters before clocking in'; end if;
   insert into public.contractor_attendance(contractor_id,date,site,pass_id) values(person.id,today,p_site,btrim(p_pass_id)) returning * into result;
 elsif p_action='out' then
   if not found then raise exception 'Clock in first'; end if;
   if result.time_out is not null then return result; end if;
   if clock_timestamp()-result.time_in<interval '1 minute' then raise exception 'Already clocked in. Wait one minute before clocking out'; end if;
   update public.contractor_attendance set time_out=clock_timestamp() where id=result.id returning * into result;
 else raise exception 'Invalid attendance action'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor,case when p_action='in' then 'CONTRACTOR_CLOCK_IN' else 'CONTRACTOR_CLOCK_OUT' end,'contractor_attendance',result.id::text,
 jsonb_build_object('contractor_id',person.id,'date',today,'pass_id',result.pass_id,'time_in',result.time_in,'time_out',result.time_out));
 return result;
end; $$;


revoke all on function public.scan_contractor_attendance(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.scan_contractor_attendance(uuid,text,text,text) to service_role;
