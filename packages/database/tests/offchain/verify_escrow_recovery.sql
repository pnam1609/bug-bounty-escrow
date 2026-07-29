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

update public.programs
set deadline = now() + interval '30 days'
where id = '31000000-0000-4000-8000-000000000006';

insert into public.escrow_contracts (
  id, program_id, chain_id, contract_address, deployment_transaction_hash,
  deployment_status, token_address, token_decimals, owner_wallet, withdraw_recipient,
  refund_unlock_at, program_key, contract_version, artifact_checksum,
  runtime_bytecode_checksum, immutable_references, circle_contract_id,
  circle_transaction_id, deploy_idempotency_key, deployment_block_number,
  deployment_block_hash, deployment_wallet_reference, deployed_at
) values (
  '39000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  5042002,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'confirmed',
  '0x3600000000000000000000000000000000000000',
  6,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  (select deadline from public.programs where id = '31000000-0000-4000-8000-000000000006'),
  '0x1111111111111111111111111111111111111111111111111111111111111111',
  '1.1.0',
  '0x2222222222222222222222222222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333333333333333333333333333',
  '{}'::jsonb,
  '39000000-0000-4000-8000-000000000002',
  '39000000-0000-4000-8000-000000000003',
  '39000000-0000-4000-8000-000000000004',
  1,
  '0x4444444444444444444444444444444444444444444444444444444444444444',
  '0xcccccccccccccccccccccccccccccccccccccccc', now()
);

insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, expires_at,
  quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000005',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000006',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bridge', 10000000, 0,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"0"}]'::jsonb
  ),
  '[{"network":"Base_Sepolia","amountBaseUnits":"10000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0,
  now() + interval '30 minutes', now(), now() + interval '10 minutes'
);

-- Any route can refresh a bounded fee quote until destination submission.
select public.refresh_funding_quote_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 100000,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"100000"}]'::jsonb
  ),
  now(), now() + interval '10 minutes'
);

-- A receipt-proven destination revert terminates only that attempt, retains its
-- evidence, and releases the same intent for a linked replacement transaction.
select public.observe_funding_operation_atomic(
  '39000000-0000-4000-8000-000000000005', null,
  '0x1212121212121212121212121212121212121212121212121212121212121212',
  'bridge-transfer-1', '[]'::jsonb, 'error', false, false, '[]'::jsonb
);
select public.fail_funding_destination_reverted_atomic(
  '39000000-0000-4000-8000-000000000005',
  '0x1212121212121212121212121212121212121212121212121212121212121212'
);

do $$
begin
  if not exists (
    select 1 from public.funding_intents
    where id = '39000000-0000-4000-8000-000000000005'
      and status = 'source_submitted' and destination_transaction_hash is null
  ) or not exists (
    select 1 from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and transaction_hash = '0x1212121212121212121212121212121212121212121212121212121212121212'
      and status = 'failed' and failure_code = 'server.funding_destination_reverted'
  ) then raise exception 'destination revert did not release a linked retry boundary'; end if;
end $$;

select public.observe_funding_operation_atomic(
  '39000000-0000-4000-8000-000000000005', null, null, 'bridge-transfer-1',
  '["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]'::jsonb,
  'error', true, false,
  '[{"name":"Burn","state":"success","transactionHash":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},{"name":"Mint","state":"error","errorCode":"failed_offchain"}]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.funding_intents
    where id = '39000000-0000-4000-8000-000000000005'
      and status = 'source_submitted'
      and destination_transaction_hash is null
  ) then raise exception 'bridge burn was not persisted as source_submitted'; end if;
  if not exists (
    select 1 from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and retryable = true
      and steps @> '[{"name":"Burn","state":"success"}]'::jsonb
  ) then raise exception 'bounded bridge recovery evidence was not persisted'; end if;
end $$;

select public.refresh_funding_quote_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 110000,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"110000"}]'::jsonb
  ),
  now(), now() + interval '10 minutes'
);

select public.observe_funding_operation_atomic(
  '39000000-0000-4000-8000-000000000005', null,
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'bridge-transfer-1', '[]'::jsonb, 'success', false, false,
  '[{"name":"Mint","state":"success","transactionHash":"0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.funding_operations replacement
    join public.funding_operations reverted on reverted.id = replacement.replaces_operation_id
    where replacement.funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and replacement.transaction_hash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      and reverted.transaction_hash = '0x1212121212121212121212121212121212121212121212121212121212121212'
      and reverted.failure_code = 'server.funding_destination_reverted'
  ) then raise exception 'destination replacement did not retain attempt linkage'; end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.funding_intents
    where id = '39000000-0000-4000-8000-000000000005'
      and status = 'delivery_pending'
      and destination_transaction_hash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ) then raise exception 'eventual mint was not promoted to delivery_pending'; end if;
  begin
    perform public.refresh_funding_quote_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000005', 120000,
      pg_temp.funding_fee_allocations(
        '[{"network":"Base_Sepolia","amountBaseUnits":"120000"}]'::jsonb
      ),
      now(), now() + interval '10 minutes');
    raise exception 'quote refreshed after destination boundary';
  exception when sqlstate '22023' then null; end;
end $$;

-- Production code cannot mutate the locked funding identity. This fixture intentionally reuses
-- one row for several independent state-machine scenarios after proving the guard once.
do $$
declare caught_detail text;
begin
  begin
    update public.funding_intents
    set gross_amount_base_units = gross_amount_base_units + 1
    where id = '39000000-0000-4000-8000-000000000005';
    raise exception 'locked funding identity mutation was accepted';
  exception when check_violation then
    get stacked diagnostics caught_detail = pg_exception_detail;
    if caught_detail <> 'funding_intent_identity_locked' then raise; end if;
  end;
end $$;
alter table public.funding_intents disable trigger funding_intents_enforce_locked_identity;

-- Unified Balance source deposits are immutable, independently evidenced, and idempotent.
delete from public.funding_operations
where funding_intent_id = '39000000-0000-4000-8000-000000000005';
update public.funding_intents set
  route_mode = 'unified_balance', status = 'ready_to_sign',
  funding_phase = 'collecting_deposits',
  gross_amount_base_units = 10000000,
  estimated_fee_reserve_base_units = 100000,
  fee_allocations = pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"100000"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  sources = '[{"network":"Base_Sepolia","amountBaseUnits":"5000000"},{"network":"Arc_Testnet","amountBaseUnits":"5000000"}]'::jsonb,
  destination_transaction_hash = null, transfer_id = null
where id = '39000000-0000-4000-8000-000000000005';

select public.refresh_funding_quote_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 100000,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"100000"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  now(), now() + interval '10 minutes'
);

-- The first Unified Balance submit remains in the durable collection phase. Destination
-- observation fails closed until the owner explicitly prepares the second-submit handoff.
do $$
declare first_prepare boolean;
declare repeated_prepare boolean;
declare locked_quoted_at timestamp with time zone;
declare locked_fees jsonb;
begin
  begin
    perform public.observe_funding_operation_atomic(
      '39000000-0000-4000-8000-000000000005', 'premature-spend',
      null, null, '[]'::jsonb, 'pending', false, false,
      '[{"name":"buildBurnIntents","state":"pending"}]'::jsonb
    );
    raise exception 'Unified Balance destination started before durable handoff';
  exception when check_violation then null; end;

  select quote_quoted_at, fee_allocations into locked_quoted_at, locked_fees
  from public.funding_intents
  where id = '39000000-0000-4000-8000-000000000005';
  begin
    perform public.prepare_funding_destination_checked_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000005',
      locked_quoted_at - interval '1 second', locked_fees
    );
    raise exception 'stale readiness snapshot crossed the handoff race';
  exception when serialization_failure then null; end;

  select public.prepare_funding_destination_checked_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000005',
    locked_quoted_at, locked_fees
  ) into first_prepare;
  select public.prepare_funding_destination_checked_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000005',
    locked_quoted_at, locked_fees
  ) into repeated_prepare;

  if first_prepare is not true or repeated_prepare is not false or not exists (
    select 1
    from public.funding_intents
    where id = '39000000-0000-4000-8000-000000000005'
      and funding_phase = 'ready_for_destination'
  ) then
    raise exception 'Unified Balance destination handoff was not durable and idempotent';
  end if;

  begin
    perform public.create_source_deposit_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000005', 'Base_Sepolia', 84532,
      '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      '0x0077777d7eba4688bdef3e311b846f25870a19b9',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5100000, 0
    );
    raise exception 'source deposit was created after destination handoff';
  exception when check_violation then null; end;
end $$;

-- The remainder of this fixture exercises the pre-handoff source-deposit state machine.
update public.funding_intents
set funding_phase = 'collecting_deposits'
where id = '39000000-0000-4000-8000-000000000005';

select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Base_Sepolia', 84532,
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5100000, 0
);
-- Concurrent/idempotent create returns the same row and cannot create another network row.
select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Base_Sepolia', 84532,
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5100000, 0
);
do $$
declare deposit_id uuid;
begin
  select id into deposit_id
  from public.funding_operations
  where funding_intent_id = '39000000-0000-4000-8000-000000000005'
    and source_chain = 'Base_Sepolia';
  if not public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000005',
    deposit_id,
    '39000000-0000-4000-8000-000000000206'
  ) then raise exception 'first source wallet boundary was not acquired'; end if;
  if public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000005',
    deposit_id,
    '39000000-0000-4000-8000-000000000207'
  ) then raise exception 'second source wallet boundary was acquired'; end if;
  begin
    perform public.arm_source_deposit_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000005',
      deposit_id,
      null
    );
    raise exception 'null source claim token was accepted';
  exception when invalid_parameter_value or check_violation then null; end;
end $$;

-- Intent TTL only expires an untouched flow. Once one source crossed the wallet
-- boundary, a reload can refresh the quote and claim the remaining source safely.
update public.funding_intents set expires_at = now() - interval '1 minute'
where id = '39000000-0000-4000-8000-000000000005';
select public.refresh_funding_quote_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 100000,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"100000"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  now(), now() + interval '10 minutes'
);
select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Arc_Testnet', 5042002,
  '0x3600000000000000000000000000000000000000',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5000000, 0
);
do $$
begin
  if (select count(*) from public.funding_operations
      where funding_intent_id = '39000000-0000-4000-8000-000000000005'
        and operation_type = 'deposit') <> 2 then
    raise exception 'started Unified Balance intent could not resume after TTL';
  end if;
end $$;
select public.observe_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005',
  (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Base_Sepolia'),
  'submitted', '0xabababababababababababababababababababababababababababababababab', null
);
select public.record_source_deposit_onchain_verified_atomic(
  (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Base_Sepolia'),
  '0xabababababababababababababababababababababababababababababababab', 7, 8, 42,
  '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
);

do $$
begin
  if public.confirm_source_deposit_atomic(
      (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Base_Sepolia'),
      '0xabababababababababababababababababababababababababababababababab', 7, 42,
      '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd') then
    raise exception 'source deposit confirmed without Circle finalization';
  end if;
end $$;

select public.ingest_circle_gateway_deposit_finalized_atomic(
  '39000000-0000-4000-8000-000000000020',
  '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000022', 6,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 5100000::numeric,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xabababababababababababababababababababababababababababababababab', now(), 2::smallint
);
select public.ingest_circle_gateway_deposit_finalized_atomic(
  '39000000-0000-4000-8000-000000000020',
  '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000022', 6,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 5100000::numeric,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xabababababababababababababababababababababababababababababababab', now(), 2::smallint
);
select public.ingest_circle_gateway_deposit_finalized_atomic(
  '39000000-0000-4000-8000-000000000023',
  '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000022', 6,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 5100000::numeric,
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xabababababababababababababababababababababababababababababababab', now(), 2::smallint
);
do $$
begin
  begin
    perform public.ingest_circle_gateway_deposit_finalized_atomic(
      '39000000-0000-4000-8000-000000000024',
      '39000000-0000-4000-8000-000000000021',
      '39000000-0000-4000-8000-000000000022', 6,
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0x036cbd53842c5426634e7929541ec2318f3dcf7e', 4000000::numeric,
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0x0077777d7eba4688bdef3e311b846f25870a19b9',
      '0xabababababababababababababababababababababababababababababababab', now(), 2::smallint);
    raise exception 'conflicting webhook replay was accepted';
  exception when sqlstate '22023' then null; end;
end $$;
select public.confirm_source_deposit_atomic(
  (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Base_Sepolia'),
  '0xabababababababababababababababababababababababababababababababab', 7, 42,
  '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'
);

do $$
begin
  if (select count(*) from public.funding_operations
      where funding_intent_id = '39000000-0000-4000-8000-000000000005'
        and operation_type = 'deposit' and status = 'confirmed'
        and log_index = 7 and transfer_log_index = 8) <> 1 then
    raise exception 'source deposit evidence was not confirmed idempotently';
  end if;
end $$;

-- A higher fresh Gateway source-debit quote creates an additive exact-delta
-- top-up after the prior deposit is confirmed; it never rewrites/replaces it.
select public.refresh_funding_quote_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 110000,
  pg_temp.funding_fee_allocations(
    '[{"network":"Base_Sepolia","amountBaseUnits":"110000"},{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  now(), now() + interval '10 minutes'
);
select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Base_Sepolia', 84532,
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 10000, 5100000
);
do $$
begin
  if not exists (
    select 1 from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and source_chain = 'Base_Sepolia' and attempt_no = 2
      and requested_amount_base_units = 10000 and pre_gateway_balance_base_units = 5100000
      and replaces_operation_id = (
        select id from public.funding_operations
        where funding_intent_id = '39000000-0000-4000-8000-000000000005'
          and source_chain = 'Base_Sepolia' and attempt_no = 1
      ) and status = 'awaiting_signature'
  ) or (
    select count(*) from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and source_chain = 'Base_Sepolia' and status = 'confirmed'
  ) <> 1 then raise exception 'fee increase did not create an additive exact-delta top-up'; end if;
end $$;

-- Only a server-verified reverted receipt releases a source for a linked replacement attempt.
select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Arc_Testnet', 5042002,
  '0x3600000000000000000000000000000000000000',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5000000, 0
);
select public.observe_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005',
  (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Arc_Testnet'),
  'submitted', '0xacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac', null
);
select public.fail_source_deposit_reverted_atomic(
  (select id from public.funding_operations where funding_intent_id = '39000000-0000-4000-8000-000000000005' and source_chain = 'Arc_Testnet'),
  '0xacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac'
);
select public.create_source_deposit_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000005', 'Arc_Testnet', 5042002,
  '0x3600000000000000000000000000000000000000',
  '0x0077777d7eba4688bdef3e311b846f25870a19b9',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 5000000, 0
);
do $$
begin
  if (select count(*) from public.funding_operations
      where funding_intent_id = '39000000-0000-4000-8000-000000000005'
        and source_chain = 'Arc_Testnet') <> 2
     or not exists (
       select 1 from public.funding_operations current
       join public.funding_operations prior on prior.id = current.replaces_operation_id
       where current.funding_intent_id = '39000000-0000-4000-8000-000000000005'
         and current.source_chain = 'Arc_Testnet' and current.attempt_no = 2
         and current.status = 'awaiting_signature'
         and prior.failure_code = 'server.source_deposit_reverted'
         and prior.transaction_hash = '0xacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacacac'
     ) then raise exception 'verified revert replacement did not retain audit linkage'; end if;
end $$;

-- Browser attribution followed by a late-funding scan and normal reconciliation
-- cannot double-credit the same destination Transfer.
delete from public.funding_operations
where funding_intent_id = '39000000-0000-4000-8000-000000000005';
update public.funding_intents set
  route_mode = 'send',
  funding_phase = 'ready_for_destination',
  status = 'delivery_pending',
  gross_amount_base_units = 2000000,
  estimated_fee_reserve_base_units = 0,
  fee_allocations = pg_temp.funding_fee_allocations(
    '[{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  sources = '[{"network":"Arc_Testnet","amountBaseUnits":"2000000"}]'::jsonb,
  destination_transaction_hash = null,
  transfer_id = null,
  sync_circle_transaction_id = null,
  net_received_base_units = null,
  completed_at = null
where id = '39000000-0000-4000-8000-000000000005';
select public.observe_funding_operation_atomic(
  '39000000-0000-4000-8000-000000000005', 'race-send',
  '0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
  null, '[]'::jsonb, 'success', false, false, '[]'::jsonb
);
update public.funding_intents set
  status = 'syncing_pool',
  reconcile_lease_id = '39000000-0000-4000-8000-000000000031',
  reconcile_lease_expires_at = now() + interval '10 minutes'
where id = '39000000-0000-4000-8000-000000000005';
do $$
declare pool_before numeric;
begin
  select total_pool into pool_before from public.programs
  where id = '31000000-0000-4000-8000-000000000006';
  perform public.reconcile_late_funding_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000001', 42,
    '[{"transactionHash":"0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1","logIndex":5,"fromAddress":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","amountBaseUnits":"2000000","blockNumber":"42","blockHash":"0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2"}]'::jsonb,
    false
  );
  if (select total_pool from public.programs
      where id = '31000000-0000-4000-8000-000000000006') <> pool_before
  then raise exception 'late scan credited an attributed funding destination'; end if;

  perform public.reconcile_funding_intent_atomic(
    '39000000-0000-4000-8000-000000000005',
    '39000000-0000-4000-8000-000000000031',
    '0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
    5, 42,
    '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
    '0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3',
    6, 2000000, 2000000, 43,
    '0xb4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4'
  );
  if (select total_pool from public.programs
      where id = '31000000-0000-4000-8000-000000000006') <> pool_before + 2
  then raise exception 'normal funding reconciliation did not credit exactly once'; end if;
end $$;
select public.reconcile_funding_intent_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000031',
  '0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1',
  5, 42,
  '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
  '0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3',
  6, 2000000, 2000000, 43,
  '0xb4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4'
);
do $$
begin
  if (select count(*) from public.funding_confirmation_artifacts
      where funding_intent_id = '39000000-0000-4000-8000-000000000005') <> 1
     or not exists (
       select 1
       from public.funding_confirmation_artifacts artifact
       join public.programs program on program.id = artifact.program_id
       where artifact.funding_intent_id = '39000000-0000-4000-8000-000000000005'
         and artifact.program_id = '31000000-0000-4000-8000-000000000006'
         and artifact.escrow_contract_id = '39000000-0000-4000-8000-000000000001'
         and artifact.route_mode = 'send'
         and artifact.escrow_address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
         and artifact.artifact_version = '1.1.0'
         and artifact.artifact_checksum =
           '0x2222222222222222222222222222222222222222222222222222222222222222'
         and artifact.token_address = '0x3600000000000000000000000000000000000000'
         and artifact.token_decimals = 6
         and artifact.destination_transaction_hash =
           '0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1'
         and artifact.destination_log_index = 5
         and artifact.destination_block_number = 42
         and artifact.destination_block_hash =
           '0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
         and artifact.sync_transaction_hash =
           '0xb3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3b3'
         and artifact.sync_log_index = 6
         and artifact.sync_block_number = 43
         and artifact.sync_block_hash =
           '0xb4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4'
         and artifact.gross_amount_base_units = 2000000
         and artifact.estimated_fee_reserve_base_units = 0
         and artifact.net_received_base_units = 2000000
         and artifact.required_total_funded_base_units =
           artifact.pre_total_funded_base_units + artifact.net_received_base_units
         and artifact.post_total_funded_base_units >= artifact.required_total_funded_base_units
         and artifact.total_pool = program.total_pool
         and artifact.reserved_pool = program.reserved_pool
         and artifact.paid_pool = program.paid_pool
         and artifact.withdrawn_pool = program.withdrawn_pool
         and artifact.available_pool = program.available_pool
     )
  then raise exception 'canonical funding confirmation artifact was incomplete or mutable'; end if;
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'funding_confirmation_artifacts'
      and grantee in ('anon','authenticated','service_role')
      and privilege_type in ('INSERT','UPDATE','DELETE')
  ) then raise exception 'funding confirmation artifact grants mutable application access'; end if;
  begin
    insert into public.funding_confirmation_artifacts
    select * from public.funding_confirmation_artifacts
    where funding_intent_id = '39000000-0000-4000-8000-000000000005';
    raise exception 'duplicate funding confirmation artifact was accepted';
  exception when unique_violation then null; end;
end $$;

-- A scan larger than one SQL batch keeps the old cursor until all chunks are
-- durable, then advances once; replay remains idempotent.
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 43,
  (
    select jsonb_agg(jsonb_build_object(
      'transactionHash', '0x' || lpad(to_hex(sequence_no + 100000), 64, '0'),
      'logIndex', 0,
      'fromAddress', '0x9999999999999999999999999999999999999999',
      'amountBaseUnits', '1',
      'blockNumber', '43',
      'blockHash', '0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5'
    ))
    from generate_series(1, 1000) as sequence_no
  ),
  false
);
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 43,
  '[{"transactionHash":"0xb6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6b6","logIndex":0,"fromAddress":"0x9999999999999999999999999999999999999999","amountBaseUnits":"1","blockNumber":"43","blockHash":"0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5"}]'::jsonb,
  false
);
do $$
begin
  if (select late_funding_scanned_through_block from public.escrow_contracts
      where id = '39000000-0000-4000-8000-000000000001') = 43
  then raise exception 'late funding cursor advanced before all chunks committed'; end if;
end $$;
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 43, '[]'::jsonb, true
);
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 43,
  (
    select jsonb_agg(jsonb_build_object(
      'transactionHash', '0x' || lpad(to_hex(sequence_no + 100000), 64, '0'),
      'logIndex', 0,
      'fromAddress', '0x9999999999999999999999999999999999999999',
      'amountBaseUnits', '1',
      'blockNumber', '43',
      'blockHash', '0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5'
    ))
    from generate_series(1, 1000) as sequence_no
  ),
  false
);
do $$
begin
  if (select late_funding_scanned_through_block from public.escrow_contracts
      where id = '39000000-0000-4000-8000-000000000001') <> 43
     or (select count(*) from public.escrow_transactions
         where escrow_contract_id = '39000000-0000-4000-8000-000000000001'
           and transaction_type = 'funding'
           and block_hash =
             '0xb5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5') <> 1001
  then raise exception 'chunked late funding scan was not cursor-safe and idempotent'; end if;
end $$;

-- First full withdrawal consumes the current projection exactly once.
update public.programs set
  status = 'expired',
  published_at = coalesce(published_at, now()),
  total_pool = 10, reserved_pool = 0, paid_pool = 0, withdrawn_pool = 0
where id = '31000000-0000-4000-8000-000000000006';

select public.create_withdrawal_intent_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000007',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  10000000, 0, false
);
-- A late direct transfer after the intent snapshot must remain available for a
-- second intent; it cannot invalidate reconciliation of exact withdrawal 10.
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 44,
  '[{"transactionHash":"0x7878787878787878787878787878787878787878787878787878787878787878","logIndex":4,"fromAddress":"0x9999999999999999999999999999999999999999","amountBaseUnits":"1000000","blockNumber":"44","blockHash":"0x7979797979797979797979797979797979797979797979797979797979797979"}]'::jsonb
);
select public.observe_withdrawal_operation_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  'close', null, 'submission_uncertain'
);
select public.observe_withdrawal_operation_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  'close', '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
);
do $withdrawal_close_first_confirmation_null$
declare
  target_id uuid := (
    select id
    from public.withdrawal_intents
    where idempotency_key = '39000000-0000-4000-8000-000000000007'
  );
  rejected boolean := false;
  error_detail text;
begin
  begin
    perform public.confirm_withdrawal_close_atomic(
      target_id,
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      1,
      45,
      null
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_close_evidence_required';
  end;
  if not rejected then
    raise exception 'First withdrawal close confirmation accepted NULL evidence';
  end if;
  if (select status from public.withdrawal_intents where id = target_id)
       is distinct from 'close_submitted'
     or (select close_log_index
         from public.withdrawal_intents where id = target_id) is not null
  then
    raise exception 'Rejected NULL close confirmation mutated withdrawal state';
  end if;
end
$withdrawal_close_first_confirmation_null$;

select public.confirm_withdrawal_close_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  1, 45, '0x5555555555555555555555555555555555555555555555555555555555555555'
);
do $withdrawal_close_replay_evidence$
declare
  target_id uuid := (
    select id
    from public.withdrawal_intents
    where idempotency_key = '39000000-0000-4000-8000-000000000007'
  );
  rejected boolean;
  error_detail text;
begin
  perform public.confirm_withdrawal_close_atomic(
    target_id,
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    1,
    45,
    '0x5555555555555555555555555555555555555555555555555555555555555555'
  );

  rejected := false;
  begin
    perform public.confirm_withdrawal_close_atomic(
      target_id,
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      null,
      45,
      '0x5555555555555555555555555555555555555555555555555555555555555555'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_close_evidence_required';
  end;
  if not rejected then
    raise exception 'Withdrawal close replay accepted NULL evidence';
  end if;

  rejected := false;
  begin
    perform public.confirm_withdrawal_close_atomic(
      target_id,
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      2,
      45,
      '0x5555555555555555555555555555555555555555555555555555555555555555'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_close_evidence_mismatch';
  end;
  if not rejected then
    raise exception 'Withdrawal close replay accepted changed evidence';
  end if;
end
$withdrawal_close_replay_evidence$;

select public.observe_withdrawal_operation_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  'withdraw', null, 'submission_uncertain'
);
select public.observe_withdrawal_operation_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  'withdraw', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
);
do $withdrawal_first_reconciliation_null$
declare
  target_id uuid := (
    select id
    from public.withdrawal_intents
    where idempotency_key = '39000000-0000-4000-8000-000000000007'
  );
  rejected boolean := false;
  error_detail text;
begin
  begin
    perform public.reconcile_withdrawal_intent_atomic(
      target_id,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      2,
      3,
      null,
      46,
      '0x6666666666666666666666666666666666666666666666666666666666666666'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_evidence_required';
  end;
  if not rejected then
    raise exception 'First withdrawal reconciliation accepted NULL evidence';
  end if;
  if (select status from public.withdrawal_intents where id = target_id)
       is distinct from 'withdraw_submitted'
     or exists (
       select 1
       from public.escrow_transactions transaction_record
       where transaction_record.withdrawal_intent_id = target_id
         and transaction_record.transaction_type = 'withdraw_remaining'
     )
  then
    raise exception 'Rejected NULL reconciliation mutated withdrawal state';
  end if;
end
$withdrawal_first_reconciliation_null$;

select public.reconcile_withdrawal_intent_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000007'),
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  2, 3, 10000000, 46,
  '0x6666666666666666666666666666666666666666666666666666666666666666'
);
do $withdrawal_complete_replay_evidence$
declare
  target_id uuid := (
    select id
    from public.withdrawal_intents
    where idempotency_key = '39000000-0000-4000-8000-000000000007'
  );
  rejected boolean;
  error_detail text;
begin
  perform public.reconcile_withdrawal_intent_atomic(
    target_id,
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    2,
    3,
    10000000,
    46,
    '0x6666666666666666666666666666666666666666666666666666666666666666'
  );

  rejected := false;
  begin
    perform public.reconcile_withdrawal_intent_atomic(
      target_id,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      2,
      null,
      10000000,
      46,
      '0x6666666666666666666666666666666666666666666666666666666666666666'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_evidence_required';
  end;
  if not rejected then
    raise exception 'Completed withdrawal replay accepted NULL evidence';
  end if;

  rejected := false;
  begin
    perform public.reconcile_withdrawal_intent_atomic(
      target_id,
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      2,
      4,
      10000000,
      46,
      '0x6666666666666666666666666666666666666666666666666666666666666666'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_evidence_mismatch';
  end;
  if not rejected then
    raise exception 'Completed withdrawal replay accepted changed evidence';
  end if;
end
$withdrawal_complete_replay_evidence$;

-- A later canonical Transfer is credited from exact chain evidence, not balance-only.
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 50,
  '[{"transactionHash":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","logIndex":4,"fromAddress":"0x9999999999999999999999999999999999999999","amountBaseUnits":"5000000","blockNumber":"50","blockHash":"0x7777777777777777777777777777777777777777777777777777777777777777"}]'::jsonb
);
select public.reconcile_late_funding_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001', 50,
  '[{"transactionHash":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","logIndex":4,"fromAddress":"0x9999999999999999999999999999999999999999","amountBaseUnits":"5000000","blockNumber":"50","blockHash":"0x7777777777777777777777777777777777777777777777777777777777777777"}]'::jsonb
);

-- Closed escrow uses a new intent and does not replay close; duplicate reconcile is a no-op.
select public.create_withdrawal_intent_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000008',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  6000000, 10000000, true
);
select public.observe_withdrawal_operation_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000008'),
  'withdraw', '0x8888888888888888888888888888888888888888888888888888888888888888'
);
select public.reconcile_withdrawal_intent_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000008'),
  '0x8888888888888888888888888888888888888888888888888888888888888888',
  5, 6, 6000000, 51,
  '0x9999999999999999999999999999999999999999999999999999999999999999'
);
select public.reconcile_withdrawal_intent_atomic(
  (select id from public.withdrawal_intents where idempotency_key = '39000000-0000-4000-8000-000000000008'),
  '0x8888888888888888888888888888888888888888888888888888888888888888',
  5, 6, 6000000, 51,
  '0x9999999999999999999999999999999999999999999999999999999999999999'
);

do $$
begin
  if not exists (
    select 1 from public.programs
    where id = '31000000-0000-4000-8000-000000000006'
      and total_pool = 16 and withdrawn_pool = 16 and available_pool = 0
  ) then raise exception 'late funding or repeated withdrawal accounting drifted'; end if;
  if (select count(*) from public.withdrawal_intents
      where program_id = '31000000-0000-4000-8000-000000000006' and status = 'complete') <> 2
  then raise exception 'late deposit did not complete through a new withdrawal intent'; end if;
  if (select count(*) from public.escrow_transactions
      where program_id = '31000000-0000-4000-8000-000000000006'
        and transaction_type = 'withdraw_remaining') <> 2
  then raise exception 'withdrawal reconciliation was not idempotent'; end if;
end $$;

-- Event identity is chain-aware: the same signed EVM transaction/log can exist
-- on two source testnets, while a duplicate on one chain remains forbidden.
update public.funding_intents set
  route_mode = 'unified_balance',
  funding_phase = 'collecting_deposits'
where id = '39000000-0000-4000-8000-000000000005';
insert into public.funding_operations (
  funding_intent_id, attempt_no, operation_type, operation_id, source_chain,
  source_chain_id, event_chain_id, transaction_hash, log_index, status
) values
  (
    '39000000-0000-4000-8000-000000000005', 90, 'deposit',
    'test:base-chain-event', 'Base_Sepolia', 84532, 84532,
    '0xabababababababababababababababababababababababababababababababab', 9,
    'confirmed'
  ),
  (
    '39000000-0000-4000-8000-000000000005', 90, 'deposit',
    'test:arb-chain-event', 'Arbitrum_Sepolia', 421614, 421614,
    '0xabababababababababababababababababababababababababababababababab', 9,
    'confirmed'
  );
do $$
begin
  begin
    insert into public.funding_operations (
      funding_intent_id, attempt_no, operation_type, operation_id, source_chain,
      source_chain_id, event_chain_id, transaction_hash, log_index, status
    ) values (
      '39000000-0000-4000-8000-000000000005', 91, 'deposit',
      'test:base-chain-event-duplicate', 'Base_Sepolia', 84532, 84532,
      '0xabababababababababababababababababababababababababababababababab', 9,
      'confirmed'
    );
    raise exception 'same-chain funding event duplicate was accepted';
  exception when unique_violation then null; end;
end $$;
update public.funding_intents
set funding_phase = 'ready_for_destination'
where id = '39000000-0000-4000-8000-000000000005';

-- Legacy/precredited accounting is not sufficient for first publish. The same
-- fully collateralized state becomes publishable only after a canonical
-- confirmation artifact exists for a completed intent on the verified escrow.
create temporary table cp13_publish_artifact_backup on commit drop as
select * from public.funding_confirmation_artifacts
where funding_intent_id = '39000000-0000-4000-8000-000000000005';
delete from public.funding_confirmation_artifacts
where funding_intent_id = '39000000-0000-4000-8000-000000000005';
do $$
declare caught_detail text;
begin
  update public.programs set
    status = 'draft', total_pool = 16, withdrawn_pool = 15,
    reserved_pool = 0, paid_pool = 0, max_bounty = 1
  where id = '31000000-0000-4000-8000-000000000006';
  begin
    update public.programs set status = 'active', published_at = now()
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'legacy funded program published without canonical artifact';
  exception
    when check_violation then
      get stacked diagnostics caught_detail = pg_exception_detail;
      if caught_detail <> 'canonical_funding_confirmation_required' then raise; end if;
  end;
end $$;
insert into public.funding_confirmation_artifacts
select * from cp13_publish_artifact_backup;
do $$
begin
  update public.programs set
    status = 'draft', total_pool = 16, withdrawn_pool = 15,
    reserved_pool = 0, paid_pool = 0, max_bounty = 1
  where id = '31000000-0000-4000-8000-000000000006';
  update public.programs set status = 'active', published_at = now()
  where id = '31000000-0000-4000-8000-000000000006';
  delete from public.funding_confirmation_artifacts
  where funding_intent_id = '39000000-0000-4000-8000-000000000005';
  update public.programs set max_bounty = 0
  where id = '31000000-0000-4000-8000-000000000006';
  if not exists (
    select 1 from public.programs
    where id = '31000000-0000-4000-8000-000000000006'
      and status = 'active' and max_bounty = 0
  ) then raise exception 'active max-bounty edit was retroactively blocked by artifact guard'; end if;
end $$;
insert into public.funding_confirmation_artifacts
select * from cp13_publish_artifact_backup;
drop table cp13_publish_artifact_backup;

-- Confirmed escrow freezes deadline, and publishing requires max-bounty collateral.
do $$
declare locked_deadline timestamp with time zone;
begin
  select deadline into locked_deadline from public.programs
  where id = '31000000-0000-4000-8000-000000000006';
  begin
    update public.programs set deadline = locked_deadline + interval '1 day'
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'confirmed escrow deadline was mutable';
  exception when check_violation then null; end;

  update public.programs set status = 'draft', total_pool = 15, withdrawn_pool = 15,
    reserved_pool = 0, paid_pool = 0, max_bounty = 1
  where id = '31000000-0000-4000-8000-000000000006';
  begin
    update public.programs set status = 'active', published_at = now()
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'underfunded program was published';
  exception when check_violation then null; end;
  update public.programs set total_pool = 16, status = 'active', published_at = now()
  where id = '31000000-0000-4000-8000-000000000006';
  if (select status from public.programs where id = '31000000-0000-4000-8000-000000000006') <> 'active' then
    raise exception 'exactly collateralized program did not publish';
  end if;
  begin
    update public.programs set max_bounty = 2
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'active max bounty increased beyond collateral';
  exception when check_violation then null; end;
  update public.programs set total_pool = 17, max_bounty = 2
  where id = '31000000-0000-4000-8000-000000000006';
  update public.programs set max_bounty = 1
  where id = '31000000-0000-4000-8000-000000000006';

  -- A verified deployment cannot be published or resumed after its immutable
  -- refund unlock/deadline has passed, even if accounting is collateralized.
  update public.programs set status = 'draft'
  where id = '31000000-0000-4000-8000-000000000006';
  update public.escrow_contracts set refund_unlock_at = now() - interval '1 minute'
  where id = '39000000-0000-4000-8000-000000000001';
  update public.programs set deadline = (
    select refund_unlock_at from public.escrow_contracts
    where id = '39000000-0000-4000-8000-000000000001'
  ) where id = '31000000-0000-4000-8000-000000000006';
  begin
    update public.programs set status = 'active', published_at = now()
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'program with expired escrow deadline was published';
  exception when check_violation then null; end;

  update public.escrow_contracts set refund_unlock_at = null
  where id = '39000000-0000-4000-8000-000000000001';
  update public.programs set deadline = null
  where id = '31000000-0000-4000-8000-000000000006';
  begin
    update public.programs set status = 'active', published_at = now()
    where id = '31000000-0000-4000-8000-000000000006';
    raise exception 'program without a deadline was published';
  exception when check_violation then null; end;
end $$;

-- A definitively failed Circle sync rotates its idempotency key and creates a
-- linked replacement. Only the successful replacement can credit the pool.
delete from public.funding_confirmation_artifacts
where funding_intent_id = '39000000-0000-4000-8000-000000000005';
delete from public.funding_operations
where funding_intent_id = '39000000-0000-4000-8000-000000000005'
  and operation_id = 'server:destination_verified';
update public.funding_intents set
  status = 'syncing_pool',
  gross_amount_base_units = 1000000,
  estimated_fee_reserve_base_units = 0,
  fee_allocations = pg_temp.funding_fee_allocations(
    '[{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
  ),
  sources = '[{"network":"Arc_Testnet","amountBaseUnits":"1000000"}]'::jsonb,
  destination_transaction_hash =
    '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
  sync_idempotency_key = '39000000-0000-4000-8000-000000000020',
  sync_circle_transaction_id = null,
  reconcile_lease_id = '39000000-0000-4000-8000-000000000021',
  reconcile_lease_expires_at = now() + interval '10 minutes',
  net_received_base_units = null,
  failure_code = null,
  completed_at = null
where id = '39000000-0000-4000-8000-000000000005';
select public.store_funding_sync_transaction_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000022'
);
select public.fail_funding_sync_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000021',
  '39000000-0000-4000-8000-000000000022',
  'server.circle_sync_failed'
);
do $$
begin
  if not exists (
    select 1 from public.funding_intents
    where id = '39000000-0000-4000-8000-000000000005'
      and status = 'sync_failed'
      and sync_circle_transaction_id is null
      and sync_idempotency_key <> '39000000-0000-4000-8000-000000000020'
  ) then raise exception 'terminal funding sync did not rotate recovery identity'; end if;
  if not exists (
    select 1 from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and operation_type = 'funding_sync' and attempt_no = 1
      and operation_id = 'circle:39000000-0000-4000-8000-000000000022'
      and status = 'failed'
  ) then raise exception 'terminal funding sync attempt was not retained'; end if;
end $$;

update public.funding_intents set
  status = 'syncing_pool',
  reconcile_lease_id = '39000000-0000-4000-8000-000000000023',
  reconcile_lease_expires_at = now() + interval '10 minutes'
where id = '39000000-0000-4000-8000-000000000005';
select public.store_funding_sync_transaction_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000023',
  '39000000-0000-4000-8000-000000000024'
);
do $$
begin
  if not exists (
    select 1
    from public.funding_operations replacement
    join public.funding_operations failed
      on failed.id = replacement.replaces_operation_id
    where replacement.funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and replacement.operation_type = 'funding_sync'
      and replacement.attempt_no = 2
      and replacement.operation_id = 'circle:39000000-0000-4000-8000-000000000024'
      and replacement.status = 'pending'
      and failed.operation_id = 'circle:39000000-0000-4000-8000-000000000022'
      and failed.status = 'failed'
  ) then raise exception 'funding sync replacement was not linked'; end if;
end $$;

select public.reconcile_funding_intent_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000023',
  '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
  0, 60,
  '0xf2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
  '0xf3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3',
  0, 1000000, 1000000, 61,
  '0xf4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4'
);
select public.reconcile_funding_intent_atomic(
  '39000000-0000-4000-8000-000000000005',
  '39000000-0000-4000-8000-000000000023',
  '0xf1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1',
  0, 60,
  '0xf2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2',
  '0xf3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3',
  0, 1000000, 1000000, 61,
  '0xf4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4'
);
do $$
begin
  if (select total_pool from public.programs
      where id = '31000000-0000-4000-8000-000000000006') <> 18
  then raise exception 'funding sync replacement did not credit exactly once'; end if;
  if not exists (
    select 1 from public.funding_operations
    where funding_intent_id = '39000000-0000-4000-8000-000000000005'
      and operation_id = 'circle:39000000-0000-4000-8000-000000000024'
      and status = 'confirmed'
  ) then raise exception 'successful funding sync replacement was not confirmed'; end if;
end $$;

-- CP-14 destination claims are idempotent, cancellation becomes irreversible at the armed
-- boundary, and only a server-verified Send revert can create one linked replacement.
insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, funding_phase,
  status, expires_at, quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000200',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000201',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'send', 1000000, 0,
  pg_temp.funding_fee_allocations('[{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb),
  '[{"network":"Arc_Testnet","amountBaseUnits":"1000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'ready_for_destination',
  'ready_to_sign', now() + interval '30 minutes', now(), now() + interval '10 minutes'
);
do $$
declare first_id uuid; replay_id uuid;
begin
  first_id := public.claim_funding_destination_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    '39000000-0000-4000-8000-000000000202'
  );
  replay_id := public.claim_funding_destination_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    '39000000-0000-4000-8000-000000000202'
  );
  if first_id <> replay_id then raise exception 'destination claim replay created a new operation'; end if;
  if not public.arm_funding_destination_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    '39000000-0000-4000-8000-000000000203'
  ) then raise exception 'first destination wallet boundary was not acquired'; end if;
  if public.arm_funding_destination_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    '39000000-0000-4000-8000-000000000204'
  ) then raise exception 'second destination wallet boundary was acquired'; end if;
  begin
    perform public.release_rejected_send_attempt_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000200',
      first_id,
      '39000000-0000-4000-8000-000000000204'
    );
    raise exception 'loser token released the winner Send boundary';
  exception when check_violation then null; end;
  perform public.release_rejected_send_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    first_id,
    '39000000-0000-4000-8000-000000000203'
  );
  if public.release_rejected_send_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    first_id,
    '39000000-0000-4000-8000-000000000203'
  ) then raise exception 'released Send replay was not idempotent'; end if;
  if not exists (
    select 1 from public.funding_operations
    where id = first_id and status = 'awaiting_signature' and not submission_uncertain
  ) then raise exception 'explicit rejected Send did not release the same pre-broadcast attempt'; end if;
  if not public.arm_funding_destination_attempt_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    '39000000-0000-4000-8000-000000000205'
  ) then raise exception 'released Send boundary was not reacquired'; end if;
  begin
    perform public.arm_funding_destination_attempt_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000200',
      null
    );
    raise exception 'null destination claim token was accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.cancel_funding_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000200'
    );
    raise exception 'armed funding intent was cancelled';
  exception when check_violation then null; end;
  perform public.observe_claimed_funding_destination_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    first_id, '39000000-0000-4000-8000-000000000205', 'submitted', null,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa20',
    null, '[]'::jsonb, 'pending', false, '[]'::jsonb
  );
  begin
    perform public.release_rejected_send_attempt_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000200',
      first_id,
      '39000000-0000-4000-8000-000000000205'
    );
    raise exception 'submitted Send was released as a rejected signature';
  exception when check_violation then null; end;
  perform public.record_funding_recovery_poll_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200',
    first_id,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa20',
    'reverted', 77,
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  );
  replay_id := public.create_funding_destination_replacement_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000200'
  );
  if not exists (
    select 1 from public.funding_operations
    where id = replay_id and replaces_operation_id = first_id and attempt_no = 2
  ) then raise exception 'Send replacement was not linked to the reverted attempt'; end if;
end $$;

update public.funding_intents
set status = 'failed', failure_code = 'test.fixture_terminalized'
where id = '39000000-0000-4000-8000-000000000200';

-- Source wallet claims are exactly-once, claimed observations are replay-safe, and recovery
-- evidence is retained per transaction hash with its authoritative network/role classification.
insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, funding_phase,
  status, expires_at, quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000300',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000301',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'unified_balance', 2000000, 0,
  pg_temp.funding_fee_allocations('[{"network":"Base_Sepolia","amountBaseUnits":"0"},{"network":"Ethereum_Sepolia","amountBaseUnits":"0"}]'::jsonb),
  '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"},{"network":"Ethereum_Sepolia","amountBaseUnits":"1000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'collecting_deposits',
  'ready_to_sign', now() + interval '30 minutes', now(), now() + interval '10 minutes'
);
do $$
declare deposit_id uuid; reverted_deposit_id uuid;
begin
  deposit_id := public.create_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300',
    'Base_Sepolia', 84532,
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
    '0x0077777d7eba4688bdef3e311b846f25870a19b9',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    1000000, 0
  );
  if not public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '39000000-0000-4000-8000-000000000302'
  ) then raise exception 'source wallet boundary was not acquired'; end if;
  if not public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '39000000-0000-4000-8000-000000000302'
  ) then raise exception 'same source claim-token replay was not idempotent'; end if;
  if public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '39000000-0000-4000-8000-000000000303'
  ) then raise exception 'second source wallet boundary was acquired'; end if;
  perform public.observe_claimed_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '39000000-0000-4000-8000-000000000302', 'submitted',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null
  );
  if public.observe_claimed_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '39000000-0000-4000-8000-000000000302', 'submitted',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', null
  ) then raise exception 'same source hash replay was not idempotent'; end if;
  begin
    perform public.observe_claimed_source_deposit_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000300', deposit_id,
      '39000000-0000-4000-8000-000000000302', 'submitted',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', null
    );
    raise exception 'conflicting source hash replay was accepted';
  exception when check_violation then null; end;
  perform public.record_funding_recovery_poll_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', deposit_id,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'success', 91,
    '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  );
  if not exists (
    select 1 from public.funding_operation_recovery_checks
    where funding_operation_id = deposit_id
      and evidence_role = 'source' and network = 'Base_Sepolia'
      and state = 'success' and block_number = 91
  ) then raise exception 'Base source recovery evidence was misclassified'; end if;

  reverted_deposit_id := public.create_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300',
    'Ethereum_Sepolia', 11155111,
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
    '0x0077777d7eba4688bdef3e311b846f25870a19b9',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    1000000, 0
  );
  perform public.arm_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', reverted_deposit_id,
    '39000000-0000-4000-8000-000000000304'
  );
  perform public.observe_claimed_source_deposit_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', reverted_deposit_id,
    '39000000-0000-4000-8000-000000000304', 'submitted',
    '0x1212121212121212121212121212121212121212121212121212121212121212', null
  );
  perform public.record_funding_recovery_poll_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000300', reverted_deposit_id,
    '0x1212121212121212121212121212121212121212121212121212121212121212',
    'reverted', 94,
    '0x3434343434343434343434343434343434343434343434343434343434343434'
  );
  if not exists (
    select 1 from public.funding_operations
    where id = reverted_deposit_id and status = 'failed'
      and failure_code = 'server.source_deposit_reverted'
  ) then raise exception 'reverted source deposit received destination failure code'; end if;
end $$;

update public.funding_intents
set status = 'failed', failure_code = 'test.fixture_terminalized'
where id = '39000000-0000-4000-8000-000000000300';

-- Bridge recovery keeps source and destination observations independently, allows a known Mint
-- hash to be attached after reload, and CAS-locks delivery retries before another SDK call.
insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, funding_phase,
  status, expires_at, quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000310',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000311',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bridge', 1000000, 0,
  pg_temp.funding_fee_allocations('[{"network":"Base_Sepolia","amountBaseUnits":"0"}]'::jsonb),
  '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'ready_for_destination',
  'source_submitted', now() + interval '30 minutes', now(), now() + interval '10 minutes'
);
do $$
declare operation_id uuid;
begin
  insert into public.funding_operations (
    funding_intent_id, attempt_no, operation_type, operation_id, idempotency_key,
    status, provider_state, retryable, submission_uncertain, wallet_claim_token, steps
  ) values (
    '39000000-0000-4000-8000-000000000310', 1, 'bridge',
    'client:bridge-recovery-test', '39000000-0000-4000-8000-000000000312',
    'pending', 'error', true, false, '39000000-0000-4000-8000-000000000313',
    jsonb_build_array(
      jsonb_build_object('name','Burn','state','success','transactionHash',
        '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'),
      jsonb_build_object('name','Mint','state','error','errorCode','failed_offchain')
    )
  ) returning id into operation_id;
  perform public.record_funding_recovery_poll_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000310', operation_id,
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'success', 92,
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  );
  begin
    perform public.attach_funding_destination_hash_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000310', operation_id,
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
    );
    raise exception 'Bridge source hash was attached as the Arc destination';
  exception when check_violation then null; end;
  if not public.attach_funding_destination_hash_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000310', operation_id,
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  ) then raise exception 'Bridge Mint manual attachment was not accepted'; end if;
  perform public.record_funding_recovery_poll_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000310', operation_id,
    '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'reverted', 93,
    '0xabababababababababababababababababababababababababababababababab'
  );
  if (select count(*) from public.funding_operation_recovery_checks
      where funding_operation_id = operation_id) <> 2
  then raise exception 'Bridge per-hash recovery evidence was overwritten'; end if;
  if not exists (
    select 1 from public.funding_operation_recovery_checks
    where funding_operation_id = operation_id and evidence_role = 'source'
      and network = 'Base_Sepolia' and state = 'success'
  ) or not exists (
    select 1 from public.funding_operation_recovery_checks
    where funding_operation_id = operation_id and evidence_role = 'destination'
      and network = 'Arc_Testnet' and state = 'reverted'
  ) then raise exception 'Bridge recovery evidence role/network classification failed'; end if;
end $$;

update public.funding_intents
set status = 'failed', failure_code = coalesce(failure_code, 'test.fixture_terminalized')
where id = '39000000-0000-4000-8000-000000000310';

insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, funding_phase,
  status, expires_at, quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000320',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000321',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'bridge', 1000000, 0,
  pg_temp.funding_fee_allocations('[{"network":"Base_Sepolia","amountBaseUnits":"0"}]'::jsonb),
  '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'ready_for_destination',
  'source_submitted', now() + interval '30 minutes', now(), now() + interval '10 minutes'
);
do $$
declare operation_id uuid; many_names jsonb; many_unbound jsonb;
begin
  insert into public.funding_operations (
    funding_intent_id, attempt_no, operation_type, operation_id, idempotency_key,
    status, provider_state, retryable, submission_uncertain, wallet_claim_token, steps
  ) values (
    '39000000-0000-4000-8000-000000000320', 1, 'bridge',
    'client:bridge-delivery-retry-test', '39000000-0000-4000-8000-000000000322',
    'pending', 'error', true, false, '39000000-0000-4000-8000-000000000323',
    jsonb_build_array(jsonb_build_object('name','Burn','state','success','transactionHash',
      '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd'))
  ) returning id into operation_id;
  if not public.arm_bridge_delivery_retry_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000320', operation_id,
    '39000000-0000-4000-8000-000000000324'
  ) then raise exception 'Bridge delivery retry was not armed'; end if;
  if not public.arm_bridge_delivery_retry_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000320', operation_id,
    '39000000-0000-4000-8000-000000000324'
  ) then raise exception 'Bridge delivery retry replay was not idempotent'; end if;
  if public.arm_bridge_delivery_retry_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000320', operation_id,
    '39000000-0000-4000-8000-000000000325'
  ) then raise exception 'second Bridge delivery retry claim was acquired'; end if;
end $$;

update public.funding_intents
set status = 'failed', failure_code = 'test.fixture_terminalized'
where id = '39000000-0000-4000-8000-000000000320';

-- Reloaded Spend source evidence must retain an exact source hash/network binding. Invalid or
-- duplicate mappings fail atomically and leave the armed operation unchanged.
alter table public.funding_operations disable trigger funding_operations_enforce_phase;
insert into public.funding_intents (
  id, program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
  route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
  destination_address, pre_balance_base_units, pre_total_funded_base_units, funding_phase,
  status, expires_at, quote_quoted_at, quote_expires_at
) values (
  '39000000-0000-4000-8000-000000000330',
  '31000000-0000-4000-8000-000000000006',
  '39000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000331',
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'unified_balance', 2000000, 0,
  pg_temp.funding_fee_allocations('[{"network":"Base_Sepolia","amountBaseUnits":"0"},{"network":"Ethereum_Sepolia","amountBaseUnits":"0"}]'::jsonb),
  '[{"network":"Base_Sepolia","amountBaseUnits":"1000000"},{"network":"Ethereum_Sepolia","amountBaseUnits":"1000000"}]'::jsonb,
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'ready_for_destination',
  'source_submitted', now() + interval '30 minutes', now(), now() + interval '10 minutes'
);
do $$
declare spend_operation_id uuid; many_names jsonb; many_unbound jsonb;
begin
  insert into public.funding_operations (
    funding_intent_id, attempt_no, operation_type, operation_id, idempotency_key,
    status, provider_state, retryable, submission_uncertain, wallet_claim_token, steps
  ) values (
    '39000000-0000-4000-8000-000000000330', 1, 'spend',
    'client:spend-reload-test', '39000000-0000-4000-8000-000000000332',
    'submission_uncertain', 'pending', false, true,
    '39000000-0000-4000-8000-000000000333', '[]'::jsonb
  ) returning id into spend_operation_id;

  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'success', false,
      '["0x5656565656565656565656565656565656565656565656565656565656565656"]'::jsonb,
      '[]'::jsonb,
      '[{"name":"source_transaction","state":"success","network":"Arbitrum_Sepolia","transactionHash":"0x5656565656565656565656565656565656565656565656565656565656565656"}]'::jsonb
    );
    raise exception 'Spend source hash accepted a network outside the intent';
  exception when check_violation then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'invalid Spend mapping partially mutated the operation'; end if;

  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'success', false,
      '["0x5656565656565656565656565656565656565656565656565656565656565656"]'::jsonb,
      '[]'::jsonb,
      '[{"name":"source_transaction","state":"success","network":"Base_Sepolia","transactionHash":"0x5656565656565656565656565656565656565656565656565656565656565656"},{"name":"duplicate_source","state":"success","network":"Base_Sepolia","transactionHash":"0x5656565656565656565656565656565656565656565656565656565656565656"}]'::jsonb
    );
    raise exception 'duplicate Spend step identity was accepted';
  exception when invalid_parameter_value or check_violation then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'duplicate Spend step partially mutated the operation'; end if;

  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'error', false, '[]'::jsonb, '[]'::jsonb,
      '[{"name":"Mint","state":"pending"},{"name":"mint","state":"error","errorCode":"duplicate_name"}]'::jsonb
    );
    raise exception 'case-insensitive duplicate step name was accepted';
  exception when invalid_parameter_value then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'duplicate step name partially mutated the operation'; end if;

  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'success', false, '[]'::jsonb, '[]'::jsonb,
      '[{"name":"unlisted_source","state":"success","network":"Base_Sepolia","transactionHash":"0x5858585858585858585858585858585858585858585858585858585858585858"}]'::jsonb
    );
    raise exception 'network-bearing Spend step was accepted without a source hash';
  exception when check_violation then null; end;
  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'pending', false, '[]'::jsonb, '[]'::jsonb,
      '[{"name":"invalid_hash","state":"pending","transactionHash":"0x1234"}]'::jsonb
    );
    raise exception 'invalid recovery step transaction hash was accepted';
  exception when invalid_parameter_value then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'inconsistent Spend telemetry partially mutated the operation'; end if;

  select jsonb_agg(jsonb_build_object(
    'name', 'step_' || ordinal::text, 'state', 'pending'
  )) into many_names from generate_series(1, 32) ordinal;
  select jsonb_agg('0x' || lpad(to_hex(ordinal), 64, '0'))
  into many_unbound from generate_series(1, 32) ordinal;
  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'pending', false, '[]'::jsonb, many_unbound, many_names
    );
    raise exception 'name-only steps bypassed the global recovery identity bound';
  exception when check_violation then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'identity-bound rejection partially mutated the operation'; end if;

  begin
    perform public.attach_funding_recovery_telemetry_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31000000-0000-4000-8000-000000000006',
      '39000000-0000-4000-8000-000000000330', spend_operation_id,
      'success', false,
      '["0x5656565656565656565656565656565656565656565656565656565656565656","0x5757575757575757575757575757575757575757575757575757575757575757"]'::jsonb,
      '[]'::jsonb,
      '[{"name":"base_source_one","state":"success","network":"Base_Sepolia","transactionHash":"0x5656565656565656565656565656565656565656565656565656565656565656"},{"name":"base_source_two","state":"success","network":"Base_Sepolia","transactionHash":"0x5757575757575757575757575757575757575757575757575757575757575757"}]'::jsonb
    );
    raise exception 'Spend accepted two source hashes mapped to the same network';
  exception when check_violation then null; end;
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'submission_uncertain' and steps = '[]'::jsonb
  ) then raise exception 'duplicate-network Spend mapping partially mutated the operation'; end if;

  perform public.attach_funding_recovery_telemetry_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000006',
    '39000000-0000-4000-8000-000000000330', spend_operation_id,
    'success', false,
    '["0x5656565656565656565656565656565656565656565656565656565656565656","0x5757575757575757575757575757575757575757575757575757575757575757"]'::jsonb,
    '[]'::jsonb,
    '[{"name":"base_source","state":"success","network":"Base_Sepolia","transactionHash":"0x5656565656565656565656565656565656565656565656565656565656565656"},{"name":"ethereum_source","state":"success","network":"Ethereum_Sepolia","transactionHash":"0x5757575757575757575757575757575757575757575757575757575757575757"}]'::jsonb
  );
  if not exists (
    select 1 from public.funding_operations operation where operation.id = spend_operation_id
      and status = 'pending' and not submission_uncertain
      and jsonb_array_length(steps) = 2
      and steps->0->>'network' = 'Base_Sepolia'
      and steps->0->>'transactionHash' =
        '0x5656565656565656565656565656565656565656565656565656565656565656'
  ) then raise exception 'valid Spend source mapping was not persisted exactly'; end if;
end $$;
alter table public.funding_operations enable trigger funding_operations_enforce_phase;

do $$
begin
  if not has_table_privilege('service_role', 'public.funding_operations', 'SELECT')
     or has_table_privilege('service_role', 'public.funding_operations', 'INSERT')
     or has_table_privilege('service_role', 'public.funding_operations', 'UPDATE')
     or has_table_privilege('service_role', 'public.funding_operations', 'DELETE')
     or has_table_privilege('service_role', 'public.funding_operations', 'TRUNCATE')
     or not has_table_privilege(
       'service_role', 'public.funding_operation_recovery_checks', 'SELECT'
     )
     or has_table_privilege(
       'service_role', 'public.funding_operation_recovery_checks', 'INSERT'
     )
     or has_table_privilege(
       'service_role', 'public.funding_operation_recovery_checks', 'UPDATE'
     )
     or has_table_privilege(
       'service_role', 'public.funding_operation_recovery_checks', 'DELETE'
     )
     or has_table_privilege(
       'service_role', 'public.funding_operation_recovery_checks', 'TRUNCATE'
     )
  then raise exception 'funding recovery tables are not SELECT-only for service_role'; end if;
end $$;

alter table public.funding_intents enable trigger funding_intents_enforce_locked_identity;
rollback;
