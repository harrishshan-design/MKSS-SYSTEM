create table public.contractors (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid not null unique references auth.users(id) on delete cascade,
 full_name text not null check(length(trim(full_name)) between 2 and 120),
 identity_reference text not null unique check(identity_reference ~ '^[0-9]{12}$'),
 company_name text not null check(length(trim(company_name)) between 2 and 120),
 work_type text not null check(work_type in ('IT','Warehouse','Maintenance','Safety')),
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','INACTIVE')),
 reviewed_by uuid references public.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
alter table public.users add column contractor_id uuid unique references public.contractors(id);
alter table public.users drop constraint role_link;
alter table public.users add constraint role_link check (
 (role='contractor' and contractor_id is not null and driver_id is null and guard_id is null)
 or (contractor_id is null and ((role='guard' and guard_id is not null and driver_id is null)
 or (role='driver' and driver_id is not null and guard_id is null)
 or (role in ('admin','monitor') and guard_id is null and driver_id is null))));
create table public.contractor_attendance (
 id uuid primary key default gen_random_uuid(), contractor_id uuid not null references public.contractors(id),
 date date not null, site text not null, time_in timestamptz not null default clock_timestamp(), time_out timestamptz,
 unique(contractor_id,date), check(time_out is null or time_out>=time_in)
);
create index contractor_attendance_date_idx on public.contractor_attendance(date);
alter table public.contractors enable row level security;
alter table public.contractor_attendance enable row level security;
revoke all on public.contractors,public.contractor_attendance from anon,authenticated;
grant all on public.contractors,public.contractor_attendance to service_role;

create function public.register_contractor(p_user uuid,p_name text,p_ic text,p_company text,p_work text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.contractors(auth_user_id,full_name,identity_reference,company_name,work_type)
 values(p_user,p_name,p_ic,p_company,p_work) returning id into result;
 insert into public.users(id,name,role,contractor_id) values(p_user,p_name,'contractor',result);
 return result;
end; $$;

create function public.review_contractor(p_actor uuid,p_id uuid,p_name text,p_company text,p_work text,p_status text)
returns void language plpgsql security invoker set search_path='' as $$
declare previous public.contractors;
begin
 if not exists(select 1 from public.users where id=p_actor and active and role='admin') then raise exception 'Active admin required'; end if;
 select * into previous from public.contractors where id=p_id for update;
 if not found then raise exception 'Contractor not found'; end if;
 update public.contractors set full_name=p_name,company_name=p_company,work_type=p_work,status=p_status,
 reviewed_by=p_actor,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
 update public.users set name=p_name where contractor_id=p_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,old_value,new_value)
 values(p_actor,'CONTRACTOR_REVIEWED','contractors',p_id::text,
 jsonb_build_object('name',previous.full_name,'company',previous.company_name,'work_type',previous.work_type,'status',previous.status),
 jsonb_build_object('name',p_name,'company',p_company,'work_type',p_work,'status',p_status));
end; $$;

create function public.scan_contractor_attendance(p_actor uuid,p_site text,p_action text)
returns public.contractor_attendance language plpgsql security invoker set search_path='' as $$
declare person public.contractors; result public.contractor_attendance; today date := (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 select c.* into person from public.contractors c join public.users u on u.contractor_id=c.id
 where u.id=p_actor and u.active and u.role='contractor' for update of c;
 if not found or person.status<>'APPROVED' then raise exception 'Admin approval is required before attendance'; end if;
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

create function public.contractor_snapshot(p_date date,p_details boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('metrics',jsonb_build_object(
 'total',(select count(*) from public.contractors),
 'pending',(select count(*) from public.contractors where status='PENDING'),
 'approved',(select count(*) from public.contractors where status='APPROVED'),
 'inside',(select count(*) from public.contractor_attendance where date=p_date and time_out is null),
 'attendance_today',(select count(*) from public.contractor_attendance where date=p_date)),
 'contractors',case when p_details then coalesce((select jsonb_agg(to_jsonb(c)) from (select * from public.contractors order by created_at desc limit 1000)c),'[]'::jsonb) else '[]'::jsonb end,
 'attendance',case when p_details then coalesce((select jsonb_agg(to_jsonb(a)) from (
 select a.*,c.full_name,c.company_name,c.work_type from public.contractor_attendance a join public.contractors c on c.id=a.contractor_id
 where date=p_date order by time_in desc limit 1000)a),'[]'::jsonb) else '[]'::jsonb end);
$$;
revoke all on function public.register_contractor(uuid,text,text,text,text),public.review_contractor(uuid,uuid,text,text,text,text),
 public.scan_contractor_attendance(uuid,text,text),public.contractor_snapshot(date,boolean) from public,anon,authenticated;
grant execute on function public.register_contractor(uuid,text,text,text,text),public.review_contractor(uuid,uuid,text,text,text,text),
 public.scan_contractor_attendance(uuid,text,text),public.contractor_snapshot(date,boolean) to service_role;

create or replace function mkss_private.can_receive_changes(p_topic text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.users u where u.id=(select auth.uid()) and u.active and (
 (p_topic='mkss:operations' and u.role in ('admin','monitor','guard'))
 or (u.role='driver' and p_topic='mkss:driver:'||u.driver_id::text)
 or (u.role='contractor' and p_topic='mkss:contractor:'||u.contractor_id::text)));
$$;
create function mkss_private.notify_contractor_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare subject uuid;
begin
 subject := case when tg_table_name='contractors' then new.id else new.contractor_id end;
 perform realtime.send(jsonb_build_object('resource','contractors'),'changed','mkss:operations',true);
 perform realtime.send(jsonb_build_object('resource','contractors'),'changed','mkss:contractor:'||subject::text,true);
 return new;
exception when others then return new;
end; $$;
revoke all on function mkss_private.notify_contractor_change() from public,anon,authenticated;
create trigger contractor_changes after insert or update on public.contractors for each row execute function mkss_private.notify_contractor_change();
create trigger contractor_attendance_changes after insert or update on public.contractor_attendance for each row execute function mkss_private.notify_contractor_change();
