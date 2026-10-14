create table public.admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index admin_push_subscriptions_admin_idx on public.admin_push_subscriptions(admin_id);
alter table public.admin_push_subscriptions enable row level security;
revoke all on public.admin_push_subscriptions from public, anon, authenticated;
grant all on public.admin_push_subscriptions to service_role;

create table public.admin_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.driver_registration_requests(id) on delete cascade,
  subscription_id uuid not null references public.admin_push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (request_id, subscription_id)
);
create index admin_push_deliveries_due_idx on public.admin_push_deliveries(status,next_attempt_at);
alter table public.admin_push_deliveries enable row level security;
revoke all on public.admin_push_deliveries from public, anon, authenticated;
grant all on public.admin_push_deliveries to service_role;

create function public.claim_admin_push_deliveries(p_limit integer default 50)
returns setof public.admin_push_deliveries
language sql security invoker set search_path = '' as $$
  update public.admin_push_deliveries as delivery
  set status = 'processing', updated_at = now()
  where delivery.id in (
    select id from public.admin_push_deliveries
    where (status in ('pending','failed') and next_attempt_at <= now() and attempts < 5)
       or (status = 'processing' and updated_at < now() - interval '2 minutes' and attempts < 5)
    order by created_at
    limit least(greatest(p_limit,1),100)
    for update skip locked
  )
  returning delivery.*;
$$;
revoke execute on function public.claim_admin_push_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_admin_push_deliveries(integer) to service_role;
