create or replace function mkss_private.archive_condition(p_resource text,p_cutoff timestamptz) returns text
language plpgsql stable security invoker set search_path='' as $$
declare completed text := format('v.created_at < %L::timestamptz and v.updated_at < %L::timestamptz and v.visit_date < %L::date and coalesce(v.company_time_out,v.created_at) < %L::timestamptz and v.status in (''COMPLETED'',''CANCELLED'') and (v.checkout_method is distinct from ''TIME_LIMIT'')',p_cutoff,p_cutoff,(p_cutoff at time zone 'Asia/Kuala_Lumpur')::date,p_cutoff);
begin
 case p_resource
 when 'geofence_events' then return format('t.occurred_at < %L::timestamptz and exists(select 1 from public.visits v where v.id=t.visit_id and %s)',p_cutoff,completed);
 when 'visits' then return replace(completed,'v.','t.');
 when 'security_attendance' then return format('t.time_out is not null and t.time_out < %L::timestamptz',p_cutoff);
 when 'contractor_attendance' then return format('t.time_out is not null and t.time_out < %L::timestamptz',p_cutoff);
 when 'audit_logs' then return format('t.created_at < %L::timestamptz and (t.entity_type in (''visits'',''security_attendance'',''contractor_attendance'',''geofence_events'') or t.action=''DRIVER_DAILY_CHECKIN'') and not exists(select 1 from public.visits v where (v.id::text=t.entity_id or v.id::text=t.new_value->>''visit_id'') and not (%s)) and not exists(select 1 from public.contractor_attendance a where a.id::text=t.entity_id and (a.time_out is null or a.time_out >= %L::timestamptz)) and not exists(select 1 from public.security_attendance a where a.id::text=t.entity_id and (a.time_out is null or a.time_out >= %L::timestamptz))',p_cutoff,completed,p_cutoff,p_cutoff);
 when 'admin_push_deliveries' then return format('t.updated_at < %L::timestamptz and t.status in (''sent'',''failed'') and exists(select 1 from public.driver_registration_requests r where r.id=t.request_id and r.status<>''PENDING'')',p_cutoff);
 when 'excel_sync_queue' then return format('t.created_at < %L::timestamptz and t.sync_status=''synced''',p_cutoff);
 else raise exception 'Resource is not archivable'; end case;
end; $$;
