-- CP-13: stable Circle Gateway subscription desired-state lifecycle.
--
-- Requirements are append-only unions. A revision lease serializes remote provider writes across
-- replicas while still allowing replica B to append revision N+1 while replica A owns revision N.

create table public.circle_gateway_subscriptions (
  subscription_id uuid primary key,
  desired_addresses text[] not null default '{}'::text[]
    check (cardinality(desired_addresses) <= 50),
  desired_domains smallint[] not null default '{}'::smallint[]
    check (desired_domains <@ array[0,3,6,26]::smallint[]),
  desired_revision bigint not null default 0 check (desired_revision >= 0),
  applied_revision bigint not null default 0
    check (applied_revision >= 0 and applied_revision <= desired_revision),
  sync_status text not null default 'pending'
    check (sync_status in ('pending','syncing','ready','failed')),
  sync_lease_id uuid,
  sync_lease_expires_at timestamp with time zone,
  last_attempted_revision bigint
    check (last_attempted_revision is null or last_attempted_revision >= 0),
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  last_error_retryable boolean,
  last_remote_addresses text[] not null default '{}'::text[]
    check (cardinality(last_remote_addresses) <= 50),
  last_remote_domains smallint[] not null default '{}'::smallint[]
    check (last_remote_domains <@ array[0,3,6,26]::smallint[]),
  last_remote_verified_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (
    (sync_lease_id is null and sync_lease_expires_at is null)
    or (sync_lease_id is not null and sync_lease_expires_at is not null)
  ),
  check (
    (last_error_code is null and last_error_retryable is null)
    or (last_error_code is not null and last_error_retryable is not null)
  )
);

create table public.circle_gateway_registrations (
  funding_intent_id uuid primary key references public.funding_intents(id) on delete restrict,
  subscription_id uuid not null
    references public.circle_gateway_subscriptions(subscription_id) on delete restrict,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  domains smallint[] not null check (
    cardinality(domains) between 2 and 4
    and domains <@ array[0,3,6,26]::smallint[]
  ),
  required_revision bigint not null check (required_revision > 0),
  readiness_status text not null default 'pending'
    check (readiness_status in ('pending','ready','failed')),
  last_error_code text
    check (last_error_code is null or last_error_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  ready_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (
    (readiness_status = 'ready' and ready_at is not null and last_error_code is null)
    or (readiness_status <> 'ready' and ready_at is null)
  ),
  unique (subscription_id, funding_intent_id)
);

create table public.circle_gateway_webhook_tests (
  notification_id uuid primary key,
  subscription_id uuid not null
    references public.circle_gateway_subscriptions(subscription_id) on delete restrict,
  received_at timestamp with time zone not null default clock_timestamp()
);

create index circle_gateway_subscriptions_repair_idx
  on public.circle_gateway_subscriptions (
    sync_status, sync_lease_expires_at, desired_revision, applied_revision
  );
create index circle_gateway_registrations_subscription_status_idx
  on public.circle_gateway_registrations (subscription_id, readiness_status);
create index circle_gateway_webhook_tests_subscription_received_idx
  on public.circle_gateway_webhook_tests (subscription_id, received_at desc);

create trigger circle_gateway_subscriptions_set_updated_at
before update on public.circle_gateway_subscriptions
for each row execute function public.set_updated_at();
create trigger circle_gateway_registrations_set_updated_at
before update on public.circle_gateway_registrations
for each row execute function public.set_updated_at();

alter table public.circle_gateway_subscriptions enable row level security;
alter table public.circle_gateway_registrations enable row level security;
alter table public.circle_gateway_webhook_tests enable row level security;
revoke all on
  public.circle_gateway_subscriptions,
  public.circle_gateway_registrations,
  public.circle_gateway_webhook_tests
from anon, authenticated, service_role;
grant select on
  public.circle_gateway_subscriptions,
  public.circle_gateway_registrations,
  public.circle_gateway_webhook_tests
to service_role;

create or replace function public.list_active_unified_balance_gateway_intent_ids()
returns table (intent_id uuid)
language sql
security definer
set search_path = pg_catalog, public
as $$
  select intent.id
  from public.funding_intents intent
  where intent.route_mode = 'unified_balance'
    and intent.status in (
      'ready_to_sign','awaiting_signature','source_submitted','destination_submitted',
      'delivery_pending','verifying_destination','syncing_pool','sync_failed'
    )
  order by intent.created_at, intent.id
$$;

create or replace function public.prepare_gateway_subscription_registration_atomic(
  target_intent_id uuid,
  target_subscription_id uuid,
  requested_lease_id uuid,
  requested_lease_expires_at timestamp with time zone
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  subscription_row public.circle_gateway_subscriptions%rowtype;
  registration_row public.circle_gateway_registrations%rowtype;
  intended_domains smallint[];
  next_addresses text[];
  next_domains smallint[];
  next_revision bigint;
  desired_changed boolean;
begin
  if target_intent_id is null
     or target_subscription_id is null
     or requested_lease_id is null
     or requested_lease_expires_at is null
     or requested_lease_expires_at <= now()
     or requested_lease_expires_at > now() + interval '15 minutes'
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_lease_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('circle-gateway-subscription:' || target_subscription_id::text, 0)
  );
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.route_mode <> 'unified_balance'
     or intent_row.status not in (
       'ready_to_sign','awaiting_signature','source_submitted','destination_submitted',
       'delivery_pending','verifying_destination','syncing_pool','sync_failed'
     )
  then
    raise exception using errcode = '23514',
      detail = 'gateway_subscription_intent_not_active';
  end if;

  select array_agg(domain order by domain)
  into intended_domains
  from (
    select distinct case source->>'network'
      when 'Ethereum_Sepolia' then 0::smallint
      when 'Arbitrum_Sepolia' then 3::smallint
      when 'Base_Sepolia' then 6::smallint
      when 'Arc_Testnet' then 26::smallint
      else null
    end as domain
    from jsonb_array_elements(intent_row.sources) source
  ) mapped
  where domain is not null;
  if intended_domains is null
     or cardinality(intended_domains) < 2
     or cardinality(intended_domains) <> jsonb_array_length(intent_row.sources)
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_domains_invalid';
  end if;

  insert into public.circle_gateway_subscriptions (subscription_id)
  values (target_subscription_id)
  on conflict (subscription_id) do nothing;
  select * into subscription_row
  from public.circle_gateway_subscriptions
  where subscription_id = target_subscription_id
  for update;

  select * into registration_row
  from public.circle_gateway_registrations
  where funding_intent_id = target_intent_id;
  if found and (
    registration_row.subscription_id <> target_subscription_id
    or registration_row.wallet_address <> intent_row.wallet_address
    or registration_row.domains <> intended_domains
  ) then
    raise exception using errcode = '23514',
      detail = 'gateway_intent_subscription_locked';
  end if;

  select array_agg(address order by address)
  into next_addresses
  from (
    select distinct lower(address) address
    from unnest(subscription_row.desired_addresses || array[intent_row.wallet_address]) address
  ) normalized;
  select array_agg(domain order by domain)
  into next_domains
  from (
    select distinct domain
    from unnest(subscription_row.desired_domains || intended_domains) domain
  ) normalized;
  if cardinality(next_addresses) > 50 then
    raise exception using errcode = '54000',
      detail = 'gateway_subscription_address_capacity_exceeded';
  end if;

  desired_changed :=
    next_addresses is distinct from subscription_row.desired_addresses
    or next_domains is distinct from subscription_row.desired_domains;
  next_revision := subscription_row.desired_revision
    + case when desired_changed then 1 else 0 end;

  if desired_changed then
    update public.circle_gateway_subscriptions
    set
      desired_addresses = next_addresses,
      desired_domains = next_domains,
      desired_revision = next_revision,
      sync_status = case
        when sync_lease_id is null then 'pending'
        else sync_status
      end,
      last_error_code = null,
      last_error_retryable = null
    where subscription_id = target_subscription_id
    returning * into subscription_row;
  end if;

  insert into public.circle_gateway_registrations (
    funding_intent_id, subscription_id, wallet_address, domains, required_revision
  ) values (
    target_intent_id, target_subscription_id, intent_row.wallet_address,
    intended_domains, next_revision
  )
  on conflict (funding_intent_id) do nothing;

  select * into subscription_row
  from public.circle_gateway_subscriptions
  where subscription_id = target_subscription_id
  for update;
  if subscription_row.sync_lease_id is not null
     and subscription_row.sync_lease_expires_at > now()
     and subscription_row.sync_lease_id <> requested_lease_id
  then
    return jsonb_build_object(
      'claimed', false,
      'revision', subscription_row.desired_revision,
      'addresses', to_jsonb(subscription_row.desired_addresses),
      'domains', to_jsonb(subscription_row.desired_domains)
    );
  end if;

  update public.circle_gateway_subscriptions
  set
    sync_status = 'syncing',
    sync_lease_id = requested_lease_id,
    sync_lease_expires_at = requested_lease_expires_at,
    last_attempted_revision = desired_revision
  where subscription_id = target_subscription_id
  returning * into subscription_row;
  update public.circle_gateway_registrations
  set readiness_status = 'pending', ready_at = null, last_error_code = null
  where subscription_id = target_subscription_id;

  return jsonb_build_object(
    'claimed', true,
    'revision', subscription_row.desired_revision,
    'addresses', to_jsonb(subscription_row.desired_addresses),
    'domains', to_jsonb(subscription_row.desired_domains)
  );
end
$$;

create or replace function public.complete_gateway_subscription_sync_atomic(
  subscription_id uuid,
  lease_id uuid,
  synced_revision bigint,
  remote_addresses jsonb,
  remote_domains jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  subscription_row public.circle_gateway_subscriptions%rowtype;
  normalized_addresses text[];
  normalized_domains smallint[];
  expected_addresses text[];
  expected_domains smallint[];
  all_desired_applied boolean;
begin
  if jsonb_typeof(remote_addresses) <> 'array'
     or jsonb_typeof(remote_domains) <> 'array'
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_remote_state_invalid';
  end if;
  select array_agg(distinct lower(value) order by lower(value))
  into normalized_addresses
  from jsonb_array_elements_text(remote_addresses);
  begin
    select array_agg(distinct value::smallint order by value::smallint)
    into normalized_domains
    from jsonb_array_elements_text(remote_domains);
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023',
        detail = 'gateway_subscription_remote_state_invalid';
  end;
  normalized_addresses := coalesce(normalized_addresses, '{}'::text[]);
  normalized_domains := coalesce(normalized_domains, '{}'::smallint[]);
  if cardinality(normalized_addresses) <> jsonb_array_length(remote_addresses)
     or cardinality(normalized_addresses) > 50
     or cardinality(normalized_domains) <> jsonb_array_length(remote_domains)
     or exists (
       select 1 from unnest(normalized_addresses) address
       where address !~ '^0x[0-9a-f]{40}$'
     )
     or not normalized_domains <@ array[0,3,6,26]::smallint[]
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_remote_state_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('circle-gateway-subscription:' || subscription_id::text, 0)
  );
  select * into subscription_row
  from public.circle_gateway_subscriptions subscription
  where subscription.subscription_id = $1
  for update;
  if not found
     or subscription_row.sync_lease_id is distinct from $2
     or subscription_row.sync_lease_expires_at <= now()
     or subscription_row.last_attempted_revision is distinct from $3
  then
    return false;
  end if;

  select
    coalesce(array_agg(distinct registration.wallet_address), '{}'::text[]),
    coalesce(array_agg(distinct domain), '{}'::smallint[])
  into expected_addresses, expected_domains
  from public.circle_gateway_registrations registration
  cross join unnest(registration.domains) domain
  where registration.subscription_id = $1
    and registration.required_revision <= $3;
  if not expected_addresses <@ normalized_addresses
     or not expected_domains <@ normalized_domains
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_remote_state_incomplete';
  end if;

  all_desired_applied :=
    subscription_row.desired_addresses <@ normalized_addresses
    and subscription_row.desired_domains <@ normalized_domains;
  update public.circle_gateway_subscriptions
  set
    applied_revision = case
      when all_desired_applied then desired_revision
      else greatest(applied_revision, $3)
    end,
    sync_status = case when all_desired_applied then 'ready' else 'pending' end,
    sync_lease_id = null,
    sync_lease_expires_at = null,
    last_remote_addresses = normalized_addresses,
    last_remote_domains = normalized_domains,
    last_remote_verified_at = clock_timestamp(),
    last_error_code = null,
    last_error_retryable = null
  where circle_gateway_subscriptions.subscription_id = $1;
  update public.circle_gateway_registrations registration
  set
    readiness_status = case
      when registration.wallet_address = any(normalized_addresses)
       and registration.domains <@ normalized_domains then 'ready'
      else 'pending'
    end,
    ready_at = case
      when registration.wallet_address = any(normalized_addresses)
       and registration.domains <@ normalized_domains
        then coalesce(registration.ready_at, clock_timestamp())
      else null
    end,
    last_error_code = null
  where registration.subscription_id = $1;
  return true;
end
$$;

create or replace function public.fail_gateway_subscription_sync_atomic(
  subscription_id uuid,
  lease_id uuid,
  error_code text,
  retryable boolean
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  subscription_row public.circle_gateway_subscriptions%rowtype;
begin
  if error_code is null or error_code !~ '^[a-z][a-z0-9._-]{0,127}$'
     or retryable is null
  then
    raise exception using errcode = '22023',
      detail = 'gateway_subscription_failure_invalid';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('circle-gateway-subscription:' || subscription_id::text, 0)
  );
  select * into subscription_row
  from public.circle_gateway_subscriptions subscription
  where subscription.subscription_id = $1
  for update;
  if not found
     or subscription_row.sync_lease_id is distinct from $2
     or subscription_row.sync_lease_expires_at <= now()
  then
    return false;
  end if;
  update public.circle_gateway_subscriptions
  set
    sync_status = case when $4 then 'pending' else 'failed' end,
    sync_lease_id = null,
    sync_lease_expires_at = null,
    last_error_code = $3,
    last_error_retryable = $4
  where circle_gateway_subscriptions.subscription_id = $1;
  update public.circle_gateway_registrations
  set
    readiness_status = case when $4 then 'pending' else 'failed' end,
    ready_at = null,
    last_error_code = $3
  where circle_gateway_registrations.subscription_id = $1
    and readiness_status <> 'ready';
  return true;
end
$$;

create or replace function public.gateway_subscription_intent_ready(
  intent_id uuid,
  subscription_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.circle_gateway_registrations registration
    join public.circle_gateway_subscriptions subscription
      on subscription.subscription_id = registration.subscription_id
    where registration.funding_intent_id = $1
      and registration.subscription_id = $2
      and registration.readiness_status = 'ready'
      and registration.required_revision <= subscription.applied_revision
      and registration.wallet_address = any(subscription.last_remote_addresses)
      and registration.domains <@ subscription.last_remote_domains
      and subscription.last_remote_verified_at is not null
      and exists (
        select 1 from public.circle_gateway_webhook_tests test
        where test.subscription_id = registration.subscription_id
          and test.received_at >= clock_timestamp() - interval '10 minutes'
      )
  )
$$;

create or replace function public.record_gateway_webhook_test_atomic(
  subscription_id uuid,
  notification_id uuid,
  received_at timestamp with time zone
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  existing_subscription_id uuid;
begin
  if $1 is null or $2 is null or $3 is null
     or $3 > clock_timestamp() + interval '5 minutes'
  then
    raise exception using errcode = '22023',
      detail = 'gateway_webhook_test_receipt_invalid';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('circle-gateway-test-receipt:' || subscription_id::text, 0)
  );
  insert into public.circle_gateway_subscriptions (subscription_id)
  values ($1) on conflict (subscription_id) do nothing;
  select test.subscription_id into existing_subscription_id
  from public.circle_gateway_webhook_tests test
  where test.notification_id = $2;
  if found then
    if existing_subscription_id <> $1 then
      raise exception using errcode = '22023',
        detail = 'gateway_webhook_test_replay_mismatch';
    end if;
    return false;
  end if;
  insert into public.circle_gateway_webhook_tests (
    notification_id, subscription_id, received_at
  ) values ($2, $1, $3);
  return true;
end
$$;

create or replace function public.gateway_webhook_test_received_after(
  subscription_id uuid,
  received_after timestamp with time zone
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.circle_gateway_webhook_tests test
    where test.subscription_id = $1 and test.received_at >= $2
  )
$$;

revoke all on function public.list_active_unified_balance_gateway_intent_ids()
  from public, anon, authenticated;
revoke all on function public.prepare_gateway_subscription_registration_atomic(
  uuid,uuid,uuid,timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.complete_gateway_subscription_sync_atomic(
  uuid,uuid,bigint,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.fail_gateway_subscription_sync_atomic(
  uuid,uuid,text,boolean
) from public, anon, authenticated;
revoke all on function public.gateway_subscription_intent_ready(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.record_gateway_webhook_test_atomic(
  uuid,uuid,timestamp with time zone
)
  from public, anon, authenticated;
revoke all on function public.gateway_webhook_test_received_after(
  uuid,timestamp with time zone
) from public, anon, authenticated;
grant execute on function public.list_active_unified_balance_gateway_intent_ids()
  to service_role;
grant execute on function public.prepare_gateway_subscription_registration_atomic(
  uuid,uuid,uuid,timestamp with time zone
) to service_role;
grant execute on function public.complete_gateway_subscription_sync_atomic(
  uuid,uuid,bigint,jsonb,jsonb
) to service_role;
grant execute on function public.fail_gateway_subscription_sync_atomic(
  uuid,uuid,text,boolean
) to service_role;
grant execute on function public.gateway_subscription_intent_ready(uuid,uuid)
  to service_role;
grant execute on function public.record_gateway_webhook_test_atomic(
  uuid,uuid,timestamp with time zone
)
  to service_role;
grant execute on function public.gateway_webhook_test_received_after(
  uuid,timestamp with time zone
) to service_role;
