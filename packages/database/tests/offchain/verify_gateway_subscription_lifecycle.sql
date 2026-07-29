begin;

create function pg_temp.funding_fee_allocations(allocations jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_agg(
    allocation || jsonb_build_object(
      'components',
      jsonb_build_array(
        jsonb_build_object('network', allocation->>'network', 'type', 'provider', 'token', 'USDC', 'amountBaseUnits', allocation->>'amountBaseUnits'),
        jsonb_build_object('network', allocation->>'network', 'type', 'gas', 'token', 'USDC', 'amountBaseUnits', '0'),
        jsonb_build_object('network', allocation->>'network', 'type', 'kit', 'token', 'USDC', 'amountBaseUnits', '0'),
        jsonb_build_object('network', allocation->>'network', 'type', 'forwarder', 'token', 'USDC', 'amountBaseUnits', '0')
      )
    )
    order by ordinal
  )
  from jsonb_array_elements(allocations) with ordinality entry(allocation, ordinal)
$$;

-- Five independent active UB intents exercise a shared stable subscription. Separate escrows are
-- intentional: the production schema permits only one active funding intent per escrow.
insert into public.programs (
  id, owner_id, name, slug, short_summary, description, deadline
)
select
  ('3a000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  'Gateway lifecycle ' || series,
  'gateway-lifecycle-' || series,
  'Gateway subscription lifecycle regression',
  'Gateway subscription lifecycle regression fixture',
  now() + interval '30 days'
from generate_series(1, 5) series;

insert into public.escrow_contracts (
  id, program_id, chain_id, contract_address, deployment_transaction_hash,
  deployment_status, token_address, token_decimals, deployed_at
)
select
  ('3b000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('3a000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  5042002,
  '0x' || lpad(to_hex(60000 + series), 40, '0'),
  '0x' || lpad(to_hex(61000 + series), 64, '0'),
  'confirmed',
  '0x3600000000000000000000000000000000000000',
  6,
  now()
from generate_series(1, 5) series;

insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key,
  wallet_address, route_mode, gross_amount_base_units,
  estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units,
  expires_at
)
select
  ('3c000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('3a000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  ('3b000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '30000000-0000-4000-8000-000000000001',
  ('3d000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  '0x' || lpad(to_hex(62000 + series), 40, '0'),
  'unified_balance',
  2000000,
  0,
  case series
    when 1 then
      pg_temp.funding_fee_allocations(
        '[{"network":"Base_Sepolia","amountBaseUnits":"0"},{"network":"Arbitrum_Sepolia","amountBaseUnits":"0"}]'::jsonb
      )
    when 2 then
      pg_temp.funding_fee_allocations(
        '[{"network":"Ethereum_Sepolia","amountBaseUnits":"0"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
      )
    else
      pg_temp.funding_fee_allocations(
        '[{"network":"Base_Sepolia","amountBaseUnits":"0"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
      )
  end,
  case series
    when 1 then
      '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"},{"network":"Arbitrum_Sepolia","amountBaseUnits":"1000000"}]'::jsonb
    when 2 then
      '[{"network":"Ethereum_Sepolia","amountBaseUnits":"1000000"},{"network":"Arc_Testnet","amountBaseUnits":"1000000"}]'::jsonb
    else
      '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"},{"network":"Arc_Testnet","amountBaseUnits":"1000000"}]'::jsonb
  end,
  '0x' || lpad(to_hex(60000 + series), 40, '0'),
  0,
  0,
  now() + interval '30 minutes'
from generate_series(1, 5) series;

do $gateway_subscription_active_intents$
declare
  active_ids uuid[];
begin
  select array_agg(intent_id order by intent_id)
  into active_ids
  from public.list_active_unified_balance_gateway_intent_ids();
  if active_ids <> array[
    '3c000000-0000-4000-8000-000000000001'::uuid,
    '3c000000-0000-4000-8000-000000000002'::uuid,
    '3c000000-0000-4000-8000-000000000003'::uuid,
    '3c000000-0000-4000-8000-000000000004'::uuid,
    '3c000000-0000-4000-8000-000000000005'::uuid
  ] then
    raise exception 'active Unified Balance intent enumeration was incomplete: %', active_ids;
  end if;
end
$gateway_subscription_active_intents$;

-- A signed Circle test can arrive before the first owner opens a Unified Balance intent. The
-- verified callback must bootstrap the durable subscription row and retain its exact receipt time.
do $gateway_subscription_signed_test_bootstrap$
declare
  bootstrap_subscription constant uuid := '3e000000-0000-4000-8000-000000000010';
  bootstrap_notification constant uuid := '3f000000-0000-4000-8000-000000000011';
  bootstrap_received_at timestamp with time zone := clock_timestamp();
begin
  if exists (
    select 1 from public.circle_gateway_subscriptions
    where subscription_id = bootstrap_subscription
  ) then
    raise exception 'signed-test bootstrap fixture unexpectedly existed';
  end if;
  if not public.record_gateway_webhook_test_atomic(
    bootstrap_subscription, bootstrap_notification, bootstrap_received_at
  ) then
    raise exception 'fresh signed Gateway webhook test was not recorded';
  end if;
  if not exists (
    select 1
    from public.circle_gateway_subscriptions subscription
    join public.circle_gateway_webhook_tests test
      on test.subscription_id = subscription.subscription_id
    where subscription.subscription_id = bootstrap_subscription
      and test.notification_id = bootstrap_notification
      and test.received_at = bootstrap_received_at
  ) then
    raise exception 'signed Gateway webhook test did not bootstrap row and receipt';
  end if;
  if public.record_gateway_webhook_test_atomic(
    bootstrap_subscription, bootstrap_notification, bootstrap_received_at
  ) then
    raise exception 'bootstrap signed Gateway webhook test replay was not idempotent';
  end if;
end
$gateway_subscription_signed_test_bootstrap$;

do $gateway_subscription_lifecycle$
declare
  stable_subscription constant uuid := '3e000000-0000-4000-8000-000000000001';
  intent_a constant uuid := '3c000000-0000-4000-8000-000000000001';
  intent_b constant uuid := '3c000000-0000-4000-8000-000000000002';
  intent_c constant uuid := '3c000000-0000-4000-8000-000000000003';
  lease_a constant uuid := '3f000000-0000-4000-8000-000000000001';
  lease_b constant uuid := '3f000000-0000-4000-8000-000000000002';
  lease_c constant uuid := '3f000000-0000-4000-8000-000000000003';
  lease_c_retry constant uuid := '3f000000-0000-4000-8000-000000000004';
  lease_same_a constant uuid := '3f000000-0000-4000-8000-000000000005';
  lease_same_b constant uuid := '3f000000-0000-4000-8000-000000000006';
  test_notification constant uuid := '3f000000-0000-4000-8000-000000000010';
  fresh_test_notification constant uuid := '3f000000-0000-4000-8000-000000000012';
  prepared_a jsonb;
  prepared_b jsonb;
  prepared_c jsonb;
  prepared_c_retry jsonb;
  prepared_same_a jsonb;
  prepared_same_b jsonb;
  test_started_at timestamp with time zone;
  caught_detail text;
begin
  prepared_a := public.prepare_gateway_subscription_registration_atomic(
    intent_a, stable_subscription, lease_a, now() + interval '10 minutes'
  );
  if prepared_a->>'claimed' <> 'true'
     or (prepared_a->>'revision')::bigint <> 1
     or prepared_a->'addresses' <> '["0x000000000000000000000000000000000000f231"]'::jsonb
     or prepared_a->'domains' <> '[3,6]'::jsonb
  then
    raise exception 'first Gateway subscription lease was not deterministic: %', prepared_a;
  end if;

  -- Replica B can durably append revision 2 while replica A owns revision 1, but it cannot
  -- concurrently claim the provider-write lease.
  prepared_b := public.prepare_gateway_subscription_registration_atomic(
    intent_b, stable_subscription, lease_b, now() + interval '10 minutes'
  );
  if prepared_b->>'claimed' <> 'false'
     or (prepared_b->>'revision')::bigint <> 2
     or prepared_b->'addresses' <>
       '["0x000000000000000000000000000000000000f231","0x000000000000000000000000000000000000f232"]'::jsonb
     or prepared_b->'domains' <> '[0,3,6,26]'::jsonb
  then
    raise exception 'concurrent Gateway revision was not durably queued: %', prepared_b;
  end if;
  if not exists (
    select 1
    from public.circle_gateway_subscriptions
    where subscription_id = stable_subscription
      and desired_revision = 2
      and applied_revision = 0
      and sync_lease_id = lease_a
      and last_attempted_revision = 1
  ) then
    raise exception 'replica B overwrote replica A lease or lost its desired revision';
  end if;

  test_started_at := clock_timestamp();
  if not public.record_gateway_webhook_test_atomic(
    stable_subscription, test_notification, clock_timestamp()
  ) then
    raise exception 'first signed Gateway webhook test was not recorded';
  end if;
  if public.record_gateway_webhook_test_atomic(
    stable_subscription, test_notification, clock_timestamp()
  ) then
    raise exception 'signed Gateway webhook test replay was not idempotent';
  end if;
  if not public.gateway_webhook_test_received_after(
    stable_subscription, test_started_at
  ) then
    raise exception 'signed Gateway webhook test was not queryable by receipt time';
  end if;

  if not public.complete_gateway_subscription_sync_atomic(
    stable_subscription,
    lease_a,
    1,
    '["0x000000000000000000000000000000000000f231"]'::jsonb,
    '[3,6]'::jsonb
  ) then
    raise exception 'replica A could not complete its owned revision';
  end if;
  if not public.gateway_subscription_intent_ready(intent_a, stable_subscription) then
    raise exception 'intent A was not ready after its own requirement revision synced';
  end if;
  if public.gateway_subscription_intent_ready(intent_b, stable_subscription) then
    raise exception 'intent B became ready before revision 2 synced';
  end if;
  if not exists (
    select 1
    from public.circle_gateway_subscriptions
    where subscription_id = stable_subscription
      and applied_revision = 1
      and desired_revision = 2
      and sync_status = 'pending'
      and sync_lease_id is null
  ) then
    raise exception 'completing revision 1 hid queued revision 2 from startup repair';
  end if;

  prepared_b := public.prepare_gateway_subscription_registration_atomic(
    intent_b, stable_subscription, lease_b, now() + interval '10 minutes'
  );
  if prepared_b->>'claimed' <> 'true'
     or (prepared_b->>'revision')::bigint <> 2
  then
    raise exception 'replica B did not claim queued revision 2: %', prepared_b;
  end if;

  -- A remote result that drops any historical requirement is rejected and leaves the lease
  -- available for a correct retry.
  begin
    perform public.complete_gateway_subscription_sync_atomic(
      stable_subscription,
      lease_b,
      2,
      '["0x000000000000000000000000000000000000f232"]'::jsonb,
      '[0,26]'::jsonb
    );
    raise exception 'Gateway sync accepted removal of revision 1 requirements';
  exception
    when invalid_parameter_value then
      get stacked diagnostics caught_detail = pg_exception_detail;
      if caught_detail <> 'gateway_subscription_remote_state_incomplete' then
        raise exception 'unexpected missing-requirement error: %', caught_detail;
      end if;
  end;
  if not public.complete_gateway_subscription_sync_atomic(
    stable_subscription,
    lease_b,
    2,
    '[
      "0x000000000000000000000000000000000000f231",
      "0x000000000000000000000000000000000000f232"
    ]'::jsonb,
    '[0,3,6,26]'::jsonb
  ) then
    raise exception 'replica B could not complete revision 2';
  end if;
  if not public.gateway_subscription_intent_ready(intent_a, stable_subscription)
     or not public.gateway_subscription_intent_ready(intent_b, stable_subscription)
  then
    raise exception 'synced stable subscription did not retain both intent requirements';
  end if;

  prepared_c := public.prepare_gateway_subscription_registration_atomic(
    intent_c, stable_subscription, lease_c, now() + interval '10 minutes'
  );
  if prepared_c->>'claimed' <> 'true'
     or (prepared_c->>'revision')::bigint <> 3
  then
    raise exception 'revision 3 was not claimed: %', prepared_c;
  end if;
  if not public.fail_gateway_subscription_sync_atomic(
    stable_subscription, lease_c, 'gateway_subscription_request_failed', true
  ) then
    raise exception 'owned Gateway lease failure was not persisted';
  end if;
  if public.complete_gateway_subscription_sync_atomic(
    stable_subscription,
    lease_c,
    3,
    prepared_c->'addresses',
    prepared_c->'domains'
  ) then
    raise exception 'stale Gateway lease completed after failure';
  end if;
  if not exists (
    select 1
    from public.circle_gateway_subscriptions
    where subscription_id = stable_subscription
      and sync_status = 'pending'
      and desired_revision = 3
      and applied_revision = 2
      and sync_lease_id is null
      and last_error_retryable
  ) then
    raise exception 'retryable subscription is not queryable for startup repair';
  end if;

  prepared_c_retry := public.prepare_gateway_subscription_registration_atomic(
    intent_c, stable_subscription, lease_c_retry, now() + interval '10 minutes'
  );
  if prepared_c_retry->>'claimed' <> 'true'
     or (prepared_c_retry->>'revision')::bigint <> 3
     or not public.complete_gateway_subscription_sync_atomic(
       stable_subscription,
       lease_c_retry,
       3,
       prepared_c_retry->'addresses',
       prepared_c_retry->'domains'
     )
  then
    raise exception 'startup repair could not reclaim and complete revision 3';
  end if;
  if not public.gateway_subscription_intent_ready(intent_c, stable_subscription) then
    raise exception 'intent C did not become ready after repaired revision';
  end if;

  -- Readiness never shortcuts request-time remote verification. Even when the desired revision is
  -- already applied, a fresh durable lease serializes verification across API replicas.
  prepared_same_a := public.prepare_gateway_subscription_registration_atomic(
    intent_a, stable_subscription, lease_same_a, now() + interval '10 minutes'
  );
  prepared_same_b := public.prepare_gateway_subscription_registration_atomic(
    intent_a, stable_subscription, lease_same_b, now() + interval '10 minutes'
  );
  if prepared_same_a->>'claimed' <> 'true'
     or (prepared_same_a->>'revision')::bigint <> 3
     or prepared_same_b->>'claimed' <> 'false'
  then
    raise exception 'same-revision request verification was not durably serialized: %, %',
      prepared_same_a, prepared_same_b;
  end if;
  if not public.complete_gateway_subscription_sync_atomic(
    stable_subscription,
    lease_same_a,
    3,
    prepared_same_a->'addresses',
    prepared_same_a->'domains'
  ) then
    raise exception 'same-revision lease owner could not persist remote verification';
  end if;
  prepared_same_b := public.prepare_gateway_subscription_registration_atomic(
    intent_a, stable_subscription, lease_same_b, now() + interval '10 minutes'
  );
  if prepared_same_b->>'claimed' <> 'true'
     or (prepared_same_b->>'revision')::bigint <> 3
     or not public.complete_gateway_subscription_sync_atomic(
       stable_subscription,
       lease_same_b,
       3,
       prepared_same_b->'addresses',
       prepared_same_b->'domains'
     )
  then
    raise exception 'same-revision waiter did not claim after the durable lease released';
  end if;

  if not exists (
    select 1
    from public.circle_gateway_registrations
    where funding_intent_id = intent_a
      and wallet_address = '0x000000000000000000000000000000000000f231'
      and domains = array[3,6]::smallint[]
  ) then
    raise exception 'historical per-intent wallet/domain requirement was not retained';
  end if;

  update public.circle_gateway_webhook_tests
  set received_at = clock_timestamp() - interval '11 minutes'
  where notification_id = test_notification;
  if public.gateway_subscription_intent_ready(intent_a, stable_subscription) then
    raise exception 'historical signed Gateway webhook test kept intent ready forever';
  end if;
  if not public.record_gateway_webhook_test_atomic(
    stable_subscription, fresh_test_notification, clock_timestamp()
  ) then
    raise exception 'fresh signed Gateway webhook test was not recorded';
  end if;
  if not public.gateway_subscription_intent_ready(intent_a, stable_subscription) then
    raise exception 'fresh signed Gateway webhook test did not restore readiness';
  end if;
end
$gateway_subscription_lifecycle$;

-- Circle accepts at most 50 distinct wallet addresses on one subscription. Exercise the exact
-- 49 -> 50 boundary first, then prove that the 51st distinct wallet fails atomically.
insert into public.circle_gateway_subscriptions (
  subscription_id, desired_addresses, desired_domains, desired_revision,
  applied_revision, sync_status
) values (
  '3e000000-0000-4000-8000-000000000002',
  array(
    select '0x' || lpad(to_hex(70000 + series), 40, '0')
    from generate_series(1, 49) series
    order by series
  ),
  array[6]::smallint[],
  1,
  0,
  'pending'
);

do $gateway_subscription_capacity$
declare
  prepared_fiftieth jsonb;
  caught_detail text;
begin
  prepared_fiftieth := public.prepare_gateway_subscription_registration_atomic(
    '3c000000-0000-4000-8000-000000000004',
    '3e000000-0000-4000-8000-000000000002',
    '3f000000-0000-4000-8000-000000000020',
    now() + interval '10 minutes'
  );
  if prepared_fiftieth->>'claimed' <> 'true'
     or jsonb_array_length(prepared_fiftieth->'addresses') <> 50
     or not public.complete_gateway_subscription_sync_atomic(
       '3e000000-0000-4000-8000-000000000002',
       '3f000000-0000-4000-8000-000000000020',
       (prepared_fiftieth->>'revision')::bigint,
       prepared_fiftieth->'addresses',
       prepared_fiftieth->'domains'
     )
  then
    raise exception 'Gateway subscription did not retain the exact 50th wallet';
  end if;
  begin
    perform public.prepare_gateway_subscription_registration_atomic(
      '3c000000-0000-4000-8000-000000000005',
      '3e000000-0000-4000-8000-000000000002',
      '3f000000-0000-4000-8000-000000000021',
      now() + interval '10 minutes'
    );
    raise exception 'Gateway subscription accepted a 51st wallet';
  exception
    when program_limit_exceeded then
      get stacked diagnostics caught_detail = pg_exception_detail;
      if caught_detail <> 'gateway_subscription_address_capacity_exceeded' then
        raise exception 'unexpected Gateway capacity error: %', caught_detail;
      end if;
  end;
  if exists (
    select 1
    from public.circle_gateway_registrations
    where funding_intent_id = '3c000000-0000-4000-8000-000000000005'
  ) then
    raise exception 'capacity failure partially registered an intent';
  end if;
  if (
    select cardinality(desired_addresses)
    from public.circle_gateway_subscriptions
    where subscription_id = '3e000000-0000-4000-8000-000000000002'
  ) <> 50
     or not exists (
       select 1 from public.circle_gateway_registrations
       where funding_intent_id = '3c000000-0000-4000-8000-000000000004'
     )
  then
    raise exception 'capacity failure changed durable requirements';
  end if;
end
$gateway_subscription_capacity$;

set local role service_role;
do $gateway_subscription_service_role_boundary$
begin
  if not public.gateway_subscription_intent_ready(
    '3c000000-0000-4000-8000-000000000001',
    '3e000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'service_role could not execute Gateway readiness RPC';
  end if;
  begin
    insert into public.circle_gateway_subscriptions (subscription_id)
    values ('3e000000-0000-4000-8000-000000000099');
    raise exception 'service_role retained direct Gateway lifecycle writes';
  exception
    when insufficient_privilege then null;
  end;
end
$gateway_subscription_service_role_boundary$;
reset role;

rollback;
