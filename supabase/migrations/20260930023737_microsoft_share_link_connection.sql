alter table microsoft_connections
  add column share_url text,
  add column drive_id text,
  add column workbook_item_id text,
  add column workbook_name text,
  add column workbook_web_url text,
  add column selected_target_kind text check (selected_target_kind in ('worksheet','table')),
  add column selected_target_id text,
  add column selected_target_name text,
  add constraint microsoft_target_complete check (
    (selected_target_kind is null and selected_target_id is null and selected_target_name is null)
    or (selected_target_kind is not null and selected_target_id is not null and selected_target_name is not null)
  );

create table microsoft_oauth_attempts (
  state_hash text primary key,
  actor_id uuid not null references users(id) on delete cascade,
  share_url text not null,
  code_verifier text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index microsoft_oauth_attempts_expires_idx on microsoft_oauth_attempts(expires_at);
alter table microsoft_oauth_attempts enable row level security;
grant all on microsoft_oauth_attempts to service_role;

create function enqueue_full_excel_export() returns integer language plpgsql security invoker as $$
declare queued_count integer;
begin
  insert into excel_sync_queue(entity_type,entity_id)
    select 'companies',id from companies
    union all select 'drivers',id from drivers
    union all select 'lorries',id from lorries
    union all select 'visits',id from visits
    union all select 'security_attendance',id from security_attendance
    union all select 'geofence_events',id from geofence_events;
  get diagnostics queued_count = row_count;
  return queued_count;
end $$;
revoke execute on function enqueue_full_excel_export() from public, anon, authenticated;
grant execute on function enqueue_full_excel_export() to service_role;

create function set_excel_destination(p_actor_id uuid, p_kind text, p_target_id text, p_target_name text)
returns integer language plpgsql security invoker as $$
declare previous microsoft_connections; queued_count integer := 0;
begin
  if not exists (select 1 from users where id = p_actor_id and role = 'admin' and active) then
    raise exception 'Active administrator required';
  end if;
  if p_kind not in ('worksheet','table') or nullif(p_target_id,'') is null or nullif(p_target_name,'') is null then
    raise exception 'Invalid Excel destination';
  end if;
  select * into previous from microsoft_connections where id = 1 for update;
  if not found then raise exception 'Microsoft is not connected'; end if;
  update microsoft_connections set selected_target_kind = p_kind, selected_target_id = p_target_id,
    selected_target_name = p_target_name, updated_at = now() where id = 1;
  if previous.selected_target_kind is distinct from p_kind or previous.selected_target_id is distinct from p_target_id then
    queued_count := enqueue_full_excel_export();
  end if;
  return queued_count;
end $$;
revoke execute on function set_excel_destination(uuid,text,text,text) from public, anon, authenticated;
grant execute on function set_excel_destination(uuid,text,text,text) to service_role;

create table excel_worker_lock (
  id integer primary key default 1 check (id = 1),
  owner_token uuid,
  lease_expires_at timestamptz not null default to_timestamp(0)
);
insert into excel_worker_lock(id) values (1);
alter table excel_worker_lock enable row level security;
grant all on excel_worker_lock to service_role;

create function acquire_excel_worker_lock(p_owner uuid) returns boolean language plpgsql security invoker as $$
declare acquired boolean;
begin
  update excel_worker_lock set owner_token = p_owner, lease_expires_at = now() + interval '10 minutes'
    where id = 1 and lease_expires_at < now()
    returning true into acquired;
  return coalesce(acquired, false);
end $$;
revoke execute on function acquire_excel_worker_lock(uuid) from public, anon, authenticated;
grant execute on function acquire_excel_worker_lock(uuid) to service_role;

create function release_excel_worker_lock(p_owner uuid) returns void language plpgsql security invoker as $$
begin
  update excel_worker_lock set owner_token = null, lease_expires_at = to_timestamp(0)
    where id = 1 and owner_token = p_owner;
end $$;
revoke execute on function release_excel_worker_lock(uuid) from public, anon, authenticated;
grant execute on function release_excel_worker_lock(uuid) to service_role;
