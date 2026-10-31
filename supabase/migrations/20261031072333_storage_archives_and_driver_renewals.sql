-- Server-only archive manifests. Payloads are compressed in private Storage,
-- never duplicated in the database that is approaching its quota.
create table public.database_health (
 id integer primary key check(id=1), limit_bytes bigint not null default 524288000 check(limit_bytes>0),
 measured_bytes bigint not null default 0, measured_at timestamptz,
 snoozed_until timestamptz, snoozed_band integer, snoozed_by uuid references public.users(id)
);
insert into public.database_health(id) values(1);
create table public.archive_batches (
 id uuid primary key default gen_random_uuid(), archive_number text not null unique,
 status text not null default 'EXPORTING' check(status in ('EXPORTING','READY','CLEANING','COMPLETED','CANCELLED')),
 cutoff timestamptz not null, started_at timestamptz not null default clock_timestamp(), started_by uuid not null references public.users(id),
 exported_at timestamptz, downloaded_at timestamptz, confirmed_at timestamptz, confirmed_by uuid references public.users(id), deleted_at timestamptz,
 period_start timestamptz, period_end timestamptz, record_count bigint not null default 0, deleted_count bigint not null default 0,
 retained_count bigint not null default 0, stored_bytes bigint not null default 0,
 table_index integer not null default 0, last_id uuid, lease_token uuid, lease_until timestamptz,
 bytes_before bigint not null, bytes_after bigint, error text
);
create unique index archive_one_open_batch on public.archive_batches((true)) where status in ('EXPORTING','READY','CLEANING');
create table public.archive_chunks (
 id bigint generated always as identity primary key, batch_id uuid not null references public.archive_batches(id),
 resource text not null, object_path text not null unique, sha256 text not null, row_count integer not null check(row_count between 1 and 500),
 first_at timestamptz, last_at timestamptz, stored_bytes bigint not null,
 cleaned_at timestamptz, deleted_count integer, retained_count integer
);
create index archive_chunks_batch on public.archive_chunks(batch_id,id);
alter table public.database_health enable row level security;
alter table public.archive_batches enable row level security;
alter table public.archive_chunks enable row level security;
revoke all on public.database_health,public.archive_batches,public.archive_chunks from anon,authenticated;
grant all on public.database_health,public.archive_batches,public.archive_chunks to service_role;
grant usage,select on sequence public.archive_chunks_id_seq to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mkss-archives','mkss-archives',false,10485760,array['application/gzip']) on conflict(id) do nothing;

create function public.refresh_database_health() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 update public.database_health set measured_bytes=pg_database_size(current_database()),measured_at=clock_timestamp() where id=1;
 select to_jsonb(h)||jsonb_build_object('visits',(select count(*) from public.visits),
 'drivers',(select count(*) from public.drivers),'vehicles',(select count(*) from public.lorries),
 'oldest_record',(select min(created_at) from public.visits),
 'archive_bytes',(select coalesce(sum(stored_bytes),0) from public.archive_batches where status<>'CANCELLED')) into result
 from public.database_health h where id=1;
 return result;
end; $$;

-- Whitelisted SQL fragments only. No table, column, or condition comes from clients.
create function mkss_private.archive_condition(p_resource text,p_cutoff timestamptz) returns text
language plpgsql stable security invoker set search_path='' as $$
declare completed text := format('v.created_at < %L::timestamptz and v.updated_at < %L::timestamptz and v.status in (''COMPLETED'',''CANCELLED'') and (v.checkout_method is distinct from ''TIME_LIMIT'')',p_cutoff,p_cutoff);
begin
 case p_resource
 when 'geofence_events' then return format('t.occurred_at < %L::timestamptz and exists(select 1 from public.visits v where v.id=t.visit_id and %s)',p_cutoff,completed);
 when 'visits' then return replace(completed,'v.','t.');
 when 'security_attendance' then return format('t.time_out is not null and t.time_out < %L::timestamptz',p_cutoff);
 when 'contractor_attendance' then return format('t.time_out is not null and t.time_out < %L::timestamptz',p_cutoff);
 when 'audit_logs' then return format('t.created_at < %L::timestamptz and (t.entity_type in (''visits'',''security_attendance'',''contractor_attendance'',''geofence_events'') or t.action=''DRIVER_DAILY_CHECKIN'') and not exists(select 1 from public.visits v where v.id::text=t.entity_id and not (%s))',p_cutoff,completed);
 when 'admin_push_deliveries' then return format('t.updated_at < %L::timestamptz and t.status in (''sent'',''failed'') and exists(select 1 from public.driver_registration_requests r where r.id=t.request_id and r.status<>''PENDING'')',p_cutoff);
 when 'excel_sync_queue' then return format('t.created_at < %L::timestamptz and t.sync_status=''synced''',p_cutoff);
 else raise exception 'Resource is not archivable'; end case;
end; $$;
revoke all on function mkss_private.archive_condition(text,timestamptz) from public,anon,authenticated;
grant usage on schema mkss_private to service_role;
grant execute on function mkss_private.archive_condition(text,timestamptz) to service_role;

create function public.archive_start(p_actor uuid) returns public.archive_batches language plpgsql security invoker set search_path='' as $$
declare result public.archive_batches;
begin
 if not exists(select 1 from public.users where id=p_actor and role='admin' and active) then raise exception 'Active admin required'; end if;
 perform pg_advisory_xact_lock(901310);
 select * into result from public.archive_batches where status in ('EXPORTING','READY','CLEANING');
 if found then return result; end if;
 insert into public.archive_batches(archive_number,cutoff,started_by,bytes_before)
 values('ARCH-'||to_char(clock_timestamp() at time zone 'Asia/Kuala_Lumpur','YYYY')||'-'||(select count(*)+1 from public.archive_batches),
 date_trunc('day',clock_timestamp() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur',p_actor,pg_database_size(current_database())) returning * into result;
 return result;
end; $$;

create function public.archive_page(p_batch uuid,p_resource text,p_after uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.archive_batches; result jsonb; condition text; context_sql text := '''{}''::jsonb';
begin
 select * into b from public.archive_batches where id=p_batch;
 if not found or b.status<>'EXPORTING' then raise exception 'Archive is not exporting'; end if;
 condition:=mkss_private.archive_condition(p_resource,b.cutoff);
 if p_resource='visits' then
 context_sql:='jsonb_build_object(''driver'',(select full_name from public.drivers where id=t.driver_id),''company'',(select name from public.companies where id=t.company_id),''vehicle'',(select registration_number from public.lorries where id=t.lorry_id))';
 elsif p_resource='contractor_attendance' then context_sql:='(select jsonb_build_object(''name'',full_name,''company'',company_name,''work_type'',work_type) from public.contractors where id=t.contractor_id)';
 elsif p_resource='security_attendance' then context_sql:='(select jsonb_build_object(''name'',full_name) from public.security_guards where id=t.guard_id)'; end if;
 execute format('select coalesce(jsonb_agg(x),''[]''::jsonb) from (select to_jsonb(t) as record,md5(to_jsonb(t)::text) as hash,%s as context from public.%I t where %s and ($1 is null or t.id>$1) order by t.id limit 500)x',context_sql,p_resource,condition)
 into result using p_after;
 return result;
end; $$;

create function public.archive_clean_chunk(p_chunk bigint,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.archive_chunks; b public.archive_batches; deleted integer; condition text;
begin
 select * into c from public.archive_chunks where id=p_chunk for update;
 if not found then raise exception 'Archive chunk missing'; end if;
 select * into b from public.archive_batches where id=c.batch_id for update;
 if b.status<>'CLEANING' or b.confirmed_at is null or b.downloaded_at is null then raise exception 'Downloaded archive and saved-file confirmation required'; end if;
 if c.cleaned_at is not null then return jsonb_build_object('deleted',c.deleted_count,'retained',c.retained_count); end if;
 if jsonb_array_length(p_rows)<>c.row_count then raise exception 'Archive manifest count mismatch'; end if;
 condition:=mkss_private.archive_condition(c.resource,b.cutoff);
 if c.resource='visits' then condition:=condition||' and not exists(select 1 from public.geofence_events g where g.visit_id=t.id)'; end if;
 -- Compare exact exported IDs AND row fingerprints. Changed/new rows survive.
 execute format('delete from public.%I t using jsonb_array_elements($1) r where t.id=(r->''record''->>''id'')::uuid and md5(to_jsonb(t)::text)=r->>''hash'' and %s',c.resource,condition) using p_rows;
 get diagnostics deleted=row_count;
 update public.archive_chunks set cleaned_at=clock_timestamp(),deleted_count=deleted,retained_count=c.row_count-deleted where id=c.id;
 update public.archive_batches set deleted_count=deleted_count+deleted,retained_count=retained_count+c.row_count-deleted where id=b.id;
 return jsonb_build_object('deleted',deleted,'retained',c.row_count-deleted);
end; $$;

-- Service-only RPCs; browsers cannot query manifests or run cleanup.
revoke all on function public.refresh_database_health(),public.archive_start(uuid),public.archive_page(uuid,text,uuid),public.archive_clean_chunk(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.refresh_database_health(),public.archive_start(uuid),public.archive_page(uuid,text,uuid),public.archive_clean_chunk(bigint,jsonb) to service_role;

create function public.archive_commit_chunk(p_batch uuid,p_token uuid,p_chunk jsonb,p_last uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare b public.archive_batches;
begin
 select * into b from public.archive_batches where id=p_batch for update;
 if b.status<>'EXPORTING' or b.lease_token is distinct from p_token or b.lease_until<clock_timestamp() then raise exception 'Export lease expired. Retry'; end if;
 insert into public.archive_chunks(batch_id,resource,object_path,sha256,row_count,first_at,last_at,stored_bytes)
 values(p_batch,p_chunk->>'resource',p_chunk->>'object_path',p_chunk->>'sha256',(p_chunk->>'row_count')::integer,
 (p_chunk->>'first_at')::timestamptz,(p_chunk->>'last_at')::timestamptz,(p_chunk->>'stored_bytes')::bigint);
 update public.archive_batches set last_id=p_last,record_count=record_count+(p_chunk->>'row_count')::integer,
 stored_bytes=stored_bytes+(p_chunk->>'stored_bytes')::bigint,
 period_start=least(period_start,(p_chunk->>'first_at')::timestamptz),period_end=greatest(period_end,(p_chunk->>'last_at')::timestamptz) where id=p_batch;
end; $$;
revoke all on function public.archive_commit_chunk(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.archive_commit_chunk(uuid,uuid,jsonb,uuid) to service_role;

alter table public.drivers add column registered_at timestamptz not null default clock_timestamp(),
 add column last_active_at timestamptz, add column inactive_at timestamptz,
 add column registration_version integer not null default 1,
 add column registration_status text not null default 'ACTIVE' check(registration_status in ('ACTIVE','EXPIRED'));
update public.drivers d set registered_at=d.created_at,last_active_at=(select max(greatest(v.company_time_in,
 case when v.checkout_method is distinct from 'TIME_LIMIT' then v.company_time_out end)) from public.visits v where v.driver_id=d.id);
alter table public.driver_registration_requests add column renewal_driver_id uuid references public.drivers(id);
create table public.driver_registration_history (
 id uuid primary key default gen_random_uuid(), driver_id uuid not null references public.drivers(id),
 registration_version integer not null, registered_at timestamptz not null default clock_timestamp(),
 expired_at timestamptz, approved_by uuid references public.users(id),
 status text not null check(status in ('PENDING','ACTIVE','EXPIRED')), details jsonb not null,
 unique(driver_id,registration_version)
);
alter table public.driver_registration_history enable row level security;
revoke all on public.driver_registration_history from anon,authenticated;
grant all on public.driver_registration_history to service_role;
insert into public.driver_registration_history(driver_id,registration_version,registered_at,status,details)
select id,1,registered_at,'ACTIVE',jsonb_build_object('name',full_name,'company_id',company_id,'phone',phone,'trip_type',default_trip_type) from public.drivers;

create function mkss_private.driver_initial_history() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.driver_registration_history(driver_id,registration_version,registered_at,status,details)
 values(new.id,new.registration_version,new.registered_at,'ACTIVE',jsonb_build_object('name',new.full_name,'company_id',new.company_id,'phone',new.phone));
 return new;
end; $$;
revoke all on function mkss_private.driver_initial_history() from public,anon,authenticated;
create trigger driver_initial_history after insert on public.drivers for each row execute function mkss_private.driver_initial_history();

create function public.expire_idle_drivers(p_driver uuid default null) returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;
begin
 with expired as (
 update public.drivers d set registration_status='EXPIRED',active=false,qr_active=false,inactive_at=clock_timestamp()
 where (p_driver is null or id=p_driver) and active and registration_status='ACTIVE'
 and greatest(registered_at,coalesce(last_active_at,registered_at))<clock_timestamp()-interval '6 months'
 and not exists(select 1 from public.visits v where v.driver_id=d.id and (v.status not in ('COMPLETED','CANCELLED') or v.checkout_method='TIME_LIMIT'))
 returning d.id,d.registration_version)
 update public.driver_registration_history h set status='EXPIRED',expired_at=clock_timestamp() from expired e where h.driver_id=e.id and h.registration_version=e.registration_version;
 get diagnostics affected=row_count; return affected;
end; $$;

create function mkss_private.driver_visit_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare person public.drivers;
begin
 if tg_op='INSERT' then
   select * into person from public.drivers where id=new.driver_id for update;
   if person.registration_status='EXPIRED' or greatest(person.registered_at,coalesce(person.last_active_at,person.registered_at))<clock_timestamp()-interval '6 months' then
     raise exception 'Registration expired. Sign in and submit re-registration for admin approval';
   end if;
 end if;
 if new.status='COMPLETED' and new.company_time_out is not null and new.checkout_method is distinct from 'TIME_LIMIT' then
   update public.drivers set last_active_at=greatest(last_active_at,new.company_time_out) where id=new.driver_id;
 end if;
 return new;
end; $$;
revoke all on function mkss_private.driver_visit_activity() from public,anon,authenticated;
create trigger driver_activity_guard before insert or update of status,company_time_out,checkout_method on public.visits for each row execute function mkss_private.driver_visit_activity();

create function public.request_driver_renewal(p_actor uuid,p_details jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare person public.drivers; result uuid; account_email text;
begin
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

alter function public.approve_driver_registration_auto(uuid,uuid) rename to approve_driver_registration_initial;
create function public.approve_driver_registration_auto(p_request_id uuid,p_actor_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.driver_registration_requests; d public.drivers; c public.companies; l public.lorries; result uuid;
begin
 if not exists(select 1 from public.users where id=p_actor_id and role='admin' and active) then raise exception 'Active admin required'; end if;
 select * into r from public.driver_registration_requests where id=p_request_id for update;
 if not found or r.status<>'PENDING' then raise exception 'Registration is not pending'; end if;
 if r.renewal_driver_id is null then
   if exists(select 1 from public.drivers where identity_reference is not null and regexp_replace(identity_reference,'[\s-]','','g')=regexp_replace(r.identity_reference,'[\s-]','','g')) then
     raise exception 'This identity already has a driver record. Renew the existing account instead'; end if;
   result:=public.approve_driver_registration_initial(p_request_id,p_actor_id);
   insert into public.driver_registration_history(driver_id,registration_version,status,approved_by,details)
   values(result,1,'ACTIVE',p_actor_id,jsonb_build_object('name',r.full_name,'company',r.requested_company,'vehicle',r.requested_lorry,'trip_type',r.trip_type))
   on conflict(driver_id,registration_version) do update set approved_by=excluded.approved_by,details=excluded.details;
   return result;
 end if;
 select * into d from public.drivers where id=r.renewal_driver_id for update;
 if not found or d.registration_status<>'EXPIRED' or not exists(select 1 from public.users where id=r.auth_user_id and driver_id=d.id and role='driver' and active) then raise exception 'Renewal account does not match the expired driver'; end if;
 if exists(select 1 from public.drivers where id<>d.id and identity_reference is not null and regexp_replace(identity_reference,'[\s-]','','g')=regexp_replace(r.identity_reference,'[\s-]','','g')) then raise exception 'This identity belongs to another driver record'; end if;
 if r.has_driving_licence is null or r.trip_type is null or nullif(trim(r.requested_lorry),'') is null then raise exception 'Licence answer, type and vehicle are required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(r.requested_company)),0));
 select * into c from public.companies where lower(name)=lower(trim(r.requested_company)) order by created_at limit 1 for update;
 if not found then insert into public.companies(name) values(trim(r.requested_company)) returning * into c;
 elsif not c.active then raise exception 'Company is inactive'; end if;
 select * into l from public.lorries where regexp_replace(upper(registration_number),'[^A-Z0-9]','','g')=regexp_replace(upper(r.requested_lorry),'[^A-Z0-9]','','g') order by created_at limit 1 for update;
 if not found then insert into public.lorries(registration_number,company_id,vehicle_type) values(upper(trim(r.requested_lorry)),c.id,'Unspecified') returning * into l;
 elsif not l.active or (l.assigned_driver_id is not null and l.assigned_driver_id<>d.id) then raise exception 'Vehicle is inactive or assigned to another driver'; end if;
 update public.lorries set assigned_driver_id=null where assigned_driver_id=d.id and id<>l.id;
 update public.lorries set assigned_driver_id=d.id,company_id=c.id where id=l.id;
 update public.drivers set full_name=r.full_name,phone=r.phone,identity_reference=r.identity_reference,company_id=c.id,
 has_driving_licence=r.has_driving_licence,default_trip_type=r.trip_type,registration_status='ACTIVE',active=true,qr_active=true,
 registered_at=clock_timestamp(),inactive_at=null,registration_version=registration_version+1 where id=d.id;
 update public.users set name=r.full_name where id=r.auth_user_id;
 update public.driver_registration_requests set status='APPROVED',reviewed_by=p_actor_id,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
 update public.driver_registration_history set status='ACTIVE',registered_at=clock_timestamp(),approved_by=p_actor_id,
 details=jsonb_build_object('name',r.full_name,'company',r.requested_company,'vehicle',r.requested_lorry,'trip_type',r.trip_type)
 where driver_id=d.id and registration_version=d.registration_version+1;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_value)
 values(p_actor_id,'DRIVER_RENEWAL_APPROVED','drivers',d.id::text,jsonb_build_object('registration_version',d.registration_version+1,'request_id',r.id));
 return d.id;
end; $$;
revoke all on function public.expire_idle_drivers(uuid),public.request_driver_renewal(uuid,jsonb),public.approve_driver_registration_auto(uuid,uuid) from public,anon,authenticated;
grant execute on function public.expire_idle_drivers(uuid),public.request_driver_renewal(uuid,jsonb),public.approve_driver_registration_auto(uuid,uuid) to service_role;
select cron.schedule('mkss-expire-idle-drivers','5 16 * * *','select public.expire_idle_drivers()');
-- Routine VACUUM reuses freed space without an exclusive VACUUM FULL lock.
select cron.schedule('mkss-archive-maintenance','30 16 * * *','vacuum (analyze) public.visits, public.geofence_events, public.audit_logs, public.security_attendance, public.contractor_attendance, public.admin_push_deliveries, public.excel_sync_queue');
