-- CP-13 reward settlement: reservation-before-signature, immutable calculation snapshots,
-- evidence-idempotent confirmation, and retirement of the client-evidence ledger path.

begin;

update public.profiles
set wallet_address = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    wallet_updated_at = now()
where id = '30000000-0000-4000-8000-000000000002';

insert into public.escrow_contracts (
  id, program_id, chain_id, contract_address, deployment_transaction_hash,
  deployment_status, deployed_at, program_key, contract_version, artifact_checksum,
  runtime_bytecode_checksum, immutable_references, token_address, token_decimals,
  owner_wallet, withdraw_recipient, refund_unlock_at, circle_contract_id,
  circle_transaction_id, deployment_wallet_reference, deploy_idempotency_key,
  deployment_block_number, deployment_block_hash
) values
  (
    '39000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    5042002,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
    '0x1000000000000000000000000000000000000000000000000000000000000001',
    'confirmed',
    now(),
    '0x2000000000000000000000000000000000000000000000000000000000000001',
    '1.1.0',
    '0x3000000000000000000000000000000000000000000000000000000000000001',
    '0x4000000000000000000000000000000000000000000000000000000000000001',
    '{}'::jsonb,
    '0x3600000000000000000000000000000000000000',
    6,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
    (select deadline from public.programs where id = '31000000-0000-4000-8000-000000000001'),
    'circle-contract-reward-1',
    'circle-transaction-reward-1',
    'circle-wallet-reward-1',
    '39000000-0000-4000-8000-000000000011',
    90,
    '0x5000000000000000000000000000000000000000000000000000000000000001'
  ),
  (
    '39000000-0000-4000-8000-000000000005',
    '31000000-0000-4000-8000-000000000005',
    5042002,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5',
    '0x1000000000000000000000000000000000000000000000000000000000000005',
    'confirmed',
    now(),
    '0x2000000000000000000000000000000000000000000000000000000000000005',
    '1.1.0',
    '0x3000000000000000000000000000000000000000000000000000000000000005',
    '0x4000000000000000000000000000000000000000000000000000000000000005',
    '{}'::jsonb,
    '0x3600000000000000000000000000000000000000',
    6,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
    (select deadline from public.programs where id = '31000000-0000-4000-8000-000000000005'),
    'circle-contract-reward-5',
    'circle-transaction-reward-5',
    'circle-wallet-reward-5',
    '39000000-0000-4000-8000-000000000015',
    90,
    '0x5000000000000000000000000000000000000000000000000000000000000005'
  );

do $$
declare
  owner_id constant uuid := '30000000-0000-4000-8000-000000000001';
  percentage_report constant uuid := '33000000-0000-4000-8000-000000000029';
  range_report constant uuid := '33000000-0000-4000-8000-000000000005';
  percentage_key constant uuid := '39000000-0000-4000-8000-000000000021';
  range_key constant uuid := '39000000-0000-4000-8000-000000000025';
  approval_hash constant text :=
    '0x6100000000000000000000000000000000000000000000000000000000000001';
  payout_hash constant text :=
    '0x6200000000000000000000000000000000000000000000000000000000000001';
  approval_block_hash constant text :=
    '0x6300000000000000000000000000000000000000000000000000000000000001';
  payout_block_hash constant text :=
    '0x6400000000000000000000000000000000000000000000000000000000000001';
  intent_id uuid;
  replay_id uuid;
  range_intent_id uuid;
  reserve_before numeric;
  reserve_after_create numeric;
  paid_before numeric;
  post_paid_base_units numeric;
  post_outstanding_base_units numeric;
  post_funded_base_units numeric;
  post_withdrawn_base_units numeric;
  post_balance_base_units numeric;
  rejected boolean;
  metadata jsonb;
begin
  select reserved_pool, paid_pool into reserve_before, paid_before
  from public.programs
  where id = '31000000-0000-4000-8000-000000000001';

  intent_id := public.create_reward_settlement_intent_atomic(
    owner_id,
    percentage_report,
    null,
    10000,
    '0x7100000000000000000000000000000000000000000000000000000000000001',
    (select content_hash from public.reports where id = percentage_report),
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    percentage_key
  );

  if not exists (
    select 1
    from public.reward_settlement_intents
    where id = intent_id
      and calculation_type = 'percentage'
      and calculation_basis_amount = 10000
      and calculation_basis_base_units = 10000000000
      and percentage_bps = 1000
      and max_reward_cap = 250000
      and max_reward_cap_base_units = 250000000000
      and amount = 1000
      and amount_base_units = 1000000000
      and status = 'awaiting_approval'
  ) then
    raise exception 'Percentage settlement snapshot is incomplete or inexact';
  end if;

  select reserved_pool into reserve_after_create
  from public.programs
  where id = '31000000-0000-4000-8000-000000000001';
  if reserve_after_create <> reserve_before + 1000 then
    raise exception 'Reward was not reserved atomically before the wallet prompt';
  end if;

  replay_id := public.create_reward_settlement_intent_atomic(
    owner_id,
    percentage_report,
    null,
    10000,
    '0x7100000000000000000000000000000000000000000000000000000000000001',
    (select content_hash from public.reports where id = percentage_report),
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    percentage_key
  );
  if replay_id <> intent_id
    or (select reserved_pool from public.programs
        where id = '31000000-0000-4000-8000-000000000001') <> reserve_after_create
  then
    raise exception 'Idempotent intent replay double-reserved the pool';
  end if;

  rejected := false;
  begin
    perform public.create_reward_settlement_intent_atomic(
      owner_id,
      percentage_report,
      null,
      10001,
      '0x7100000000000000000000000000000000000000000000000000000000000001',
      (select content_hash from public.reports where id = percentage_report),
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      percentage_key
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'Percentage idempotency payload mismatch was accepted'; end if;

  perform public.observe_reward_approval_submission_atomic(
    owner_id, intent_id, 'submitted', approval_hash
  );
  perform public.confirm_reward_approval_atomic(
    intent_id, approval_hash, 7, 100, approval_block_hash
  );
  -- Exact confirmation replay is a no-op; any changed evidence must fail closed.
  perform public.confirm_reward_approval_atomic(
    intent_id, approval_hash, 7, 100, approval_block_hash
  );
  rejected := false;
  begin
    perform public.confirm_reward_approval_atomic(
      intent_id, approval_hash, 8, 100, approval_block_hash
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'Approval confirmation accepted mismatched replay evidence'; end if;

  rejected := false;
  begin
    perform public.confirm_reward_approval_atomic(
      intent_id, approval_hash, 7, 100, null
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Approval confirmation replay accepted NULL evidence';
  end if;

  select review.metadata into metadata
  from public.report_reviews as review
  where review.report_id = percentage_report and review.action = 'approve_reward'
  order by review.created_at desc
  limit 1;
  if metadata ->> 'calculationType' <> 'percentage'
    or (metadata ->> 'calculationBasisAmount')::numeric <> 10000
    or (metadata ->> 'percentageBps')::integer <> 1000
    or (metadata ->> 'maxRewardCap')::numeric <> 250000
    or (metadata ->> 'rewardAmount')::numeric <> 1000
  then
    raise exception 'Percentage calculation was not snapshotted in review audit metadata';
  end if;

  perform public.prepare_reward_payout_relay_atomic(
    intent_id, '39000000-0000-4000-8000-000000000031'
  );
  perform public.accept_reward_payout_relay_atomic(
    intent_id,
    '39000000-0000-4000-8000-000000000031',
    'circle-reward-payout-transaction'
  );
  perform public.attach_reward_payout_hash_atomic(
    intent_id, 'circle-reward-payout-transaction', payout_hash
  );
  select
    round((paid_pool + 1000) * 1000000),
    round((reserved_pool - 1000) * 1000000),
    round(total_pool * 1000000),
    round(withdrawn_pool * 1000000),
    round((total_pool - paid_pool - 1000 - withdrawn_pool) * 1000000)
  into
    post_paid_base_units,
    post_outstanding_base_units,
    post_funded_base_units,
    post_withdrawn_base_units,
    post_balance_base_units
  from public.programs
  where id = '31000000-0000-4000-8000-000000000001';

  rejected := false;
  begin
    perform public.confirm_reward_payout_with_accounting_atomic(
      intent_id, payout_hash, null, 10, 101, payout_block_hash,
      post_paid_base_units, post_outstanding_base_units, post_funded_base_units,
      post_withdrawn_base_units, post_balance_base_units
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'First payout confirmation accepted NULL receipt evidence';
  end if;

  rejected := false;
  begin
    perform public.confirm_reward_payout_with_accounting_atomic(
      intent_id, payout_hash, 9, 10, 101, payout_block_hash,
      null, post_outstanding_base_units, post_funded_base_units,
      post_withdrawn_base_units, post_balance_base_units
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'First payout confirmation accepted a NULL accounting snapshot';
  end if;
  if (select status from public.reward_settlement_intents where id = intent_id)
       <> 'payout_submitted'
    or exists (
      select 1
      from public.reward_settlement_operations operation
      where operation.intent_id = (
          select settlement.id
          from public.reward_settlement_intents settlement
          where settlement.report_id = percentage_report
        )
        and operation.operation_type = 'payout'
        and operation.status = 'confirmed'
    )
  then
    raise exception 'Rejected NULL first confirmation mutated settlement state';
  end if;

  perform public.confirm_reward_payout_with_accounting_atomic(
    intent_id, payout_hash, 9, 10, 101, payout_block_hash,
    post_paid_base_units, post_outstanding_base_units, post_funded_base_units,
    post_withdrawn_base_units, post_balance_base_units
  );
  perform public.confirm_reward_payout_with_accounting_atomic(
    intent_id, payout_hash, 9, 10, 101, payout_block_hash,
    post_paid_base_units, post_outstanding_base_units, post_funded_base_units,
    post_withdrawn_base_units, post_balance_base_units
  );
  rejected := false;
  begin
    perform public.confirm_reward_payout_with_accounting_atomic(
      intent_id, payout_hash, 9, 10, 101, payout_block_hash,
      post_paid_base_units, post_outstanding_base_units, post_funded_base_units,
      post_withdrawn_base_units, null
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Payout confirmation replay accepted a NULL accounting snapshot';
  end if;

  rejected := false;
  begin
    perform public.confirm_reward_payout_with_accounting_atomic(
      intent_id, null, 9, 10, 101, payout_block_hash,
      post_paid_base_units, post_outstanding_base_units, post_funded_base_units,
      post_withdrawn_base_units, post_balance_base_units
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Payout confirmation replay accepted NULL receipt evidence';
  end if;

  rejected := false;
  begin
    perform public.confirm_reward_payout_atomic(
      intent_id, payout_hash, 9, null, 101, payout_block_hash
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Legacy-compatible payout confirmation replay accepted NULL evidence';
  end if;

  rejected := false;
  begin
    perform public.confirm_reward_payout_with_accounting_atomic(
      intent_id, payout_hash, 9, 10, 101, payout_block_hash,
      post_paid_base_units + 1, post_outstanding_base_units, post_funded_base_units,
      post_withdrawn_base_units, post_balance_base_units
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Payout confirmation accepted mismatched global accounting';
  end if;

  if not exists (
    select 1
    from public.reward_settlement_operations operation
    where operation.intent_id = (
        select settlement.id
        from public.reward_settlement_intents settlement
        where settlement.report_id = percentage_report
      )
      and operation_type = 'payout'
      and status = 'confirmed'
      and post_total_paid_base_units = post_paid_base_units
      and post_total_approved_outstanding_base_units = post_outstanding_base_units
      and post_total_funded_base_units = post_funded_base_units
      and post_total_withdrawn_base_units = post_withdrawn_base_units
      and post_escrow_balance_base_units = post_balance_base_units
  ) then
    raise exception 'Exact payout accounting snapshot was not persisted';
  end if;

  if (select status from public.reports where id = percentage_report) <> 'paid'
    or (select status from public.reward_settlement_intents where id = intent_id) <> 'paid'
    or (select reserved_pool from public.programs
        where id = '31000000-0000-4000-8000-000000000001') <> reserve_before
    or (select paid_pool from public.programs
        where id = '31000000-0000-4000-8000-000000000001') <> paid_before + 1000
  then
    raise exception 'Confirmed payout did not move exactly reserved to paid once';
  end if;

  rejected := false;
  begin
    insert into public.reward_settlement_operations (
      intent_id, operation_type, attempt_no, status, transaction_hash,
      event_log_index, block_number, block_hash
    ) values (
      intent_id, 'payout', 2, 'confirmed',
      '0x6500000000000000000000000000000000000000000000000000000000000001',
      12, 102,
      '0x6600000000000000000000000000000000000000000000000000000000000001'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then raise exception 'Payout confirmation without USDC transfer evidence was stored'; end if;

  rejected := false;
  begin
    insert into public.reward_settlement_operations (
      intent_id, operation_type, attempt_no, status, transaction_hash,
      event_log_index, transfer_log_index, block_number, block_hash
    ) values (
      intent_id, 'approval', 2, 'confirmed',
      '0x6700000000000000000000000000000000000000000000000000000000000001',
      12, 13, 102,
      '0x6800000000000000000000000000000000000000000000000000000000000001'
    );
  exception when check_violation then
    rejected := true;
  end;
  if not rejected then raise exception 'Approval operation accepted payout transfer evidence'; end if;

  if not exists (
    select 1 from public.audit_logs
    where entity_id = intent_id::text
      and action = 'reward.intent.transitioned'
  ) or not exists (
    select 1 from public.audit_logs audit
    where audit.entity_type = 'reward_settlement_operation'
      and audit.action = 'reward.operation.transitioned'
      and audit.metadata ? 'intentId'
      and not (
        audit.metadata ? 'transactionHash'
        or audit.metadata ? 'circleTransactionId'
        or audit.metadata ? 'recipientAddress'
      )
  ) then
    raise exception 'Required redacted reward lifecycle audit events are missing';
  end if;

  select reserved_pool into reserve_before
  from public.programs
  where id = '31000000-0000-4000-8000-000000000005';
  range_intent_id := public.create_reward_settlement_intent_atomic(
    owner_id,
    range_report,
    100,
    null,
    '0x7200000000000000000000000000000000000000000000000000000000000001',
    (select content_hash from public.reports where id = range_report),
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    range_key
  );
  rejected := false;
  begin
    perform public.create_reward_settlement_intent_atomic(
      owner_id,
      range_report,
      101,
      null,
      '0x7200000000000000000000000000000000000000000000000000000000000001',
      (select content_hash from public.reports where id = range_report),
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      range_key
    );
  exception when sqlstate '22023' then
    rejected := true;
  end;
  if not rejected then raise exception 'Range idempotency payload mismatch was accepted'; end if;
  perform public.cancel_reward_settlement_intent_atomic(owner_id, range_intent_id);
  if (select reserved_pool from public.programs
      where id = '31000000-0000-4000-8000-000000000005') <> reserve_before
  then
    raise exception 'Unsigned cancellation did not release exactly one reservation';
  end if;
end;
$$;

do $$
begin
  if pg_get_functiondef(
    'public.confirm_reward_payout_with_accounting_atomic(uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric)'::regprocedure
  ) not like '%for update%'
     or pg_get_functiondef(
       'public.confirm_reward_payout_with_accounting_atomic(uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric)'::regprocedure
     ) not like '%post_total_paid_base_units + post_total_approved_outstanding_base_units%'
     or pg_get_functiondef(
       'public.confirm_reward_payout_with_accounting_atomic(uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric)'::regprocedure
     ) not like '%post_total_paid_base_units < expected_paid%'
  then
    raise exception 'Payout accounting confirmation lost its concurrency-safe locks/conservation checks';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.approve_report_reward_atomic(uuid,uuid,numeric,numeric)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.start_report_payment_atomic(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.confirm_report_payment_atomic(uuid,uuid,bigint,text,integer)',
      'EXECUTE'
    )
  then
    raise exception 'Previous-image reward RPC rollback compatibility is missing';
  end if;

  if has_function_privilege(
      'anon',
      'public.approve_report_reward_atomic(uuid,uuid,numeric,numeric)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.approve_report_reward_atomic(uuid,uuid,numeric,numeric)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.start_report_payment_atomic(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.start_report_payment_atomic(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.confirm_report_payment_atomic(uuid,uuid,bigint,text,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.confirm_report_payment_atomic(uuid,uuid,bigint,text,integer)',
      'EXECUTE'
    )
  then
    raise exception 'Legacy reward RPC leaked to a browser role';
  end if;
end;
$$;

rollback;
