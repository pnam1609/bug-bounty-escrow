-- CP-13 completion hardening:
-- - failed withdrawals can only continue through an explicitly linked replacement;
-- - transaction evidence and replacement links are immutable once recorded;
-- - security-sensitive escrow lifecycle changes produce bounded, redacted audit rows;
-- - reward payout confirmation persists and validates an exact on-chain accounting snapshot.

alter table public.withdrawal_intents
  add column replaces_intent_id uuid
    references public.withdrawal_intents(id) on delete restrict,
  add column replaced_by_intent_id uuid
    references public.withdrawal_intents(id) on delete restrict,
  add constraint withdrawal_intents_not_self_replacement_check
    check (
      replaces_intent_id is null or replaces_intent_id <> id
    ),
  add constraint withdrawal_intents_not_self_replaced_by_check
    check (
      replaced_by_intent_id is null or replaced_by_intent_id <> id
    );

create unique index withdrawal_intents_one_replacement_per_intent
  on public.withdrawal_intents(replaces_intent_id)
  where replaces_intent_id is not null;

create unique index withdrawal_intents_one_successor_per_intent
  on public.withdrawal_intents(replaced_by_intent_id)
  where replaced_by_intent_id is not null;

create or replace function public.enforce_withdrawal_intent_immutable_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.program_id is distinct from old.program_id
     or new.escrow_contract_id is distinct from old.escrow_contract_id
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.wallet_address is distinct from old.wallet_address
     or new.recipient_address is distinct from old.recipient_address
     or new.amount_base_units is distinct from old.amount_base_units
     or new.pre_total_withdrawn_base_units is distinct from old.pre_total_withdrawn_base_units
     or new.close_required is distinct from old.close_required
     or new.replaces_intent_id is distinct from old.replaces_intent_id
  then
    raise exception using errcode = '55000', detail = 'withdrawal_intent_identity_immutable';
  end if;
  if (old.replaced_by_intent_id is not null
        and new.replaced_by_intent_id is distinct from old.replaced_by_intent_id)
     or (old.status in ('complete', 'failed') and new.status is distinct from old.status)
     or (old.close_transaction_hash is not null
        and new.close_transaction_hash is distinct from old.close_transaction_hash)
     or (old.withdraw_transaction_hash is not null
        and new.withdraw_transaction_hash is distinct from old.withdraw_transaction_hash)
     or (old.close_log_index is not null
        and new.close_log_index is distinct from old.close_log_index)
     or (old.close_block_number is not null
        and new.close_block_number is distinct from old.close_block_number)
     or (old.close_block_hash is not null
        and new.close_block_hash is distinct from old.close_block_hash)
     or (old.withdraw_log_index is not null
        and new.withdraw_log_index is distinct from old.withdraw_log_index)
     or (old.transfer_log_index is not null
        and new.transfer_log_index is distinct from old.transfer_log_index)
     or (old.withdraw_block_number is not null
        and new.withdraw_block_number is distinct from old.withdraw_block_number)
     or (old.withdraw_block_hash is not null
        and new.withdraw_block_hash is distinct from old.withdraw_block_hash)
     or (old.failure_code is not null
        and new.failure_code is distinct from old.failure_code)
     or (old.completed_at is not null
        and new.completed_at is distinct from old.completed_at)
  then
    raise exception using errcode = '55000', detail = 'withdrawal_intent_evidence_immutable';
  end if;
  return new;
end;
$$;

create trigger withdrawal_intents_immutable_evidence
before update on public.withdrawal_intents
for each row execute function public.enforce_withdrawal_intent_immutable_evidence();

create or replace function public.prevent_unlinked_withdrawal_replacement()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.replaces_intent_id is null and exists (
    select 1
    from public.withdrawal_intents previous
    where previous.escrow_contract_id = new.escrow_contract_id
      and previous.status = 'failed'
      and previous.replaced_by_intent_id is null
  ) then
    raise exception using errcode = '23514', detail = 'withdrawal_replacement_required';
  end if;
  return new;
end;
$$;

create trigger withdrawal_intents_require_linked_replacement
before insert on public.withdrawal_intents
for each row execute function public.prevent_unlinked_withdrawal_replacement();

create or replace function public.validate_withdrawal_replacement_link()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.replaces_intent_id is not null and not exists (
    select 1
    from public.withdrawal_intents prior
    where prior.id = new.replaces_intent_id
      and prior.program_id = new.program_id
      and prior.escrow_contract_id = new.escrow_contract_id
      and prior.status = 'failed'
      and prior.failure_code is not null
      and (prior.close_transaction_hash is not null
        or prior.withdraw_transaction_hash is not null)
      and prior.replaced_by_intent_id = new.id
  ) then
    raise exception using errcode = '23514',
      detail = 'withdrawal_replacement_link_invalid';
  end if;
  if new.replaced_by_intent_id is not null and not exists (
    select 1
    from public.withdrawal_intents successor
    where successor.id = new.replaced_by_intent_id
      and successor.program_id = new.program_id
      and successor.escrow_contract_id = new.escrow_contract_id
      and successor.replaces_intent_id = new.id
  ) then
    raise exception using errcode = '23514',
      detail = 'withdrawal_replacement_link_invalid';
  end if;
  return null;
end;
$$;

create constraint trigger withdrawal_intents_valid_replacement_link
after insert or update of replaces_intent_id, replaced_by_intent_id
on public.withdrawal_intents
deferrable initially deferred
for each row execute function public.validate_withdrawal_replacement_link();

create or replace function public.create_withdrawal_replacement_intent_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_failed_intent_id uuid,
  request_idempotency_key uuid,
  source_wallet text,
  expected_amount_base_units numeric,
  escrow_pre_total_withdrawn_base_units numeric,
  escrow_already_closed boolean
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prior_row public.withdrawal_intents%rowtype;
  existing_row public.withdrawal_intents%rowtype;
  escrow_row public.escrow_contracts%rowtype;
  program_owner uuid;
  program_status text;
  program_reserved numeric;
  program_available_base_units numeric;
  created_id uuid;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':withdraw', 0)
  );
  select owner_id, status, reserved_pool, trunc(available_pool * 1000000)
    into program_owner, program_status, program_reserved, program_available_base_units
  from public.programs
  where id = target_program_id
  for update;
  if not found or program_owner <> actor_id then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  if program_status not in ('expired', 'closed') then
    raise exception using errcode = '23514', detail = 'withdrawal_program_not_ended';
  end if;

  select * into prior_row
  from public.withdrawal_intents
  where id = target_failed_intent_id
  for update;
  if not found or prior_row.program_id <> target_program_id then
    raise exception using errcode = 'P0002', detail = 'withdrawal_intent_not_found';
  end if;
  if prior_row.status <> 'failed'
     or prior_row.failure_code is null
     or (prior_row.close_transaction_hash is null
       and prior_row.withdraw_transaction_hash is null)
  then
    raise exception using errcode = '23514',
      detail = 'withdrawal_replacement_requires_verified_failure';
  end if;

  select * into existing_row
  from public.withdrawal_intents
  where program_id = target_program_id
    and idempotency_key = request_idempotency_key;
  if found then
    if existing_row.replaces_intent_id is distinct from prior_row.id
       or existing_row.wallet_address <> lower(source_wallet)
       or existing_row.amount_base_units <> expected_amount_base_units
       or existing_row.pre_total_withdrawn_base_units
          <> escrow_pre_total_withdrawn_base_units
       or existing_row.close_required <> not escrow_already_closed
    then
      raise exception using errcode = '22023',
        detail = 'withdrawal_idempotency_payload_mismatch';
    end if;
    return existing_row.id;
  end if;
  if prior_row.replaced_by_intent_id is not null then
    raise exception using errcode = '23505', detail = 'withdrawal_replacement_already_exists';
  end if;

  select * into escrow_row
  from public.escrow_contracts
  where id = prior_row.escrow_contract_id
    and program_id = target_program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
  for update;
  if not found
     or escrow_row.contract_address is null
     or escrow_row.owner_wallet is null
     or escrow_row.withdraw_recipient is null
     or escrow_row.token_address <> '0x3600000000000000000000000000000000000000'
     or escrow_row.contract_version <> '1.1.0'
     or escrow_row.program_key is null
     or escrow_row.artifact_checksum is null
     or escrow_row.runtime_bytecode_checksum is null
  then
    raise exception using errcode = '23514', detail = 'verified_arc_escrow_required';
  end if;
  if lower(source_wallet) <> escrow_row.owner_wallet then
    raise exception using errcode = '22023', detail = 'withdrawal_owner_wallet_mismatch';
  end if;
  if program_reserved <> 0 then
    raise exception using errcode = '23514', detail = 'withdrawal_reserved_rewards_exist';
  end if;
  if expected_amount_base_units <= 0
     or expected_amount_base_units <> program_available_base_units
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_amount_projection_mismatch';
  end if;
  if exists (
    select 1
    from public.withdrawal_intents
    where escrow_contract_id = escrow_row.id
      and status not in ('complete', 'failed')
  ) then
    raise exception using errcode = '23505', detail = 'withdrawal_intent_already_active';
  end if;

  insert into public.withdrawal_intents (
    program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
    recipient_address, amount_base_units, pre_total_withdrawn_base_units,
    close_required, status, replaces_intent_id
  ) values (
    target_program_id, escrow_row.id, actor_id, request_idempotency_key,
    lower(source_wallet), escrow_row.withdraw_recipient, expected_amount_base_units,
    escrow_pre_total_withdrawn_base_units, not escrow_already_closed,
    case when escrow_already_closed then 'ready_to_withdraw' else 'ready_to_close' end,
    prior_row.id
  ) returning id into created_id;

  update public.withdrawal_intents
  set replaced_by_intent_id = created_id
  where id = prior_row.id
    and replaced_by_intent_id is null;
  if not found then
    raise exception using errcode = '23505', detail = 'withdrawal_replacement_already_exists';
  end if;
  return created_id;
end;
$$;

revoke all on function public.create_withdrawal_replacement_intent_atomic(
  uuid,uuid,uuid,uuid,text,numeric,numeric,boolean
) from public, anon, authenticated;
grant execute on function public.create_withdrawal_replacement_intent_atomic(
  uuid,uuid,uuid,uuid,text,numeric,numeric,boolean
) to service_role;

-- Bounded, redacted audit events. Metadata intentionally excludes addresses,
-- nonces, signatures, provider identifiers, transaction hashes, and report text.
create or replace function public.audit_escrow_wallet_challenge()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare event_action text;
begin
  event_action := case
    when tg_op = 'INSERT' then 'escrow.wallet_challenge.created'
    when old.consumed_at is null and new.consumed_at is not null
      then 'escrow.wallet_challenge.consumed'
    when old.invalidated_at is null and new.invalidated_at is not null
      then 'escrow.wallet_challenge.invalidated'
    else null
  end;
  if event_action is not null then
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      new.actor_id, 'user', event_action, 'escrow_wallet_challenge', new.id::text,
      jsonb_build_object(
        'programId', new.program_id,
        'chainId', new.chain_id,
        'hasDeployment', new.deployment_id is not null
      )
    );
  end if;
  return new;
end;
$$;

create trigger escrow_wallet_challenges_audit
after insert or update on public.escrow_wallet_control_challenges
for each row execute function public.audit_escrow_wallet_challenge();

create or replace function public.audit_escrow_contract_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT'
     or new.deployment_status is distinct from old.deployment_status
  then
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      null, 'system',
      case when tg_op = 'INSERT'
        then 'escrow.deployment.created'
        else 'escrow.deployment.transitioned'
      end,
      'escrow_contract', new.id::text,
      jsonb_build_object(
        'programId', new.program_id,
        'chainId', new.chain_id,
        'fromStatus', case when tg_op = 'INSERT' then null else old.deployment_status end,
        'toStatus', new.deployment_status,
        'hasContractAddress', new.contract_address is not null,
        'hasTransactionEvidence', new.deployment_transaction_hash is not null
      )
    );
  end if;
  return new;
end;
$$;

create trigger escrow_contracts_lifecycle_audit
after insert or update on public.escrow_contracts
for each row execute function public.audit_escrow_contract_lifecycle();

create or replace function public.audit_reward_settlement_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      new.actor_id, 'user',
      case when tg_op = 'INSERT'
        then 'reward.intent.created'
        else 'reward.intent.transitioned'
      end,
      'reward_settlement_intent', new.id::text,
      jsonb_build_object(
        'programId', new.program_id,
        'reportId', new.report_id,
        'calculationType', new.calculation_type,
        'fromStatus', case when tg_op = 'INSERT' then null else old.status end,
        'toStatus', new.status,
        'hasFailureCode', new.failure_code is not null
      )
    );
  end if;
  return new;
end;
$$;

create trigger reward_settlement_intents_audit
after insert or update on public.reward_settlement_intents
for each row execute function public.audit_reward_settlement_intent();

create or replace function public.audit_reward_settlement_operation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      null, 'system',
      case when tg_op = 'INSERT'
        then 'reward.operation.created'
        else 'reward.operation.transitioned'
      end,
      'reward_settlement_operation', new.id::text,
      jsonb_build_object(
        'intentId', new.intent_id,
        'operationType', new.operation_type,
        'attemptNo', new.attempt_no,
        'fromStatus', case when tg_op = 'INSERT' then null else old.status end,
        'toStatus', new.status,
        'hasTransactionEvidence', new.transaction_hash is not null,
        'hasProviderReference', new.circle_transaction_id is not null,
        'hasFailureCode', new.failure_code is not null
      )
    );
  end if;
  return new;
end;
$$;

create trigger reward_settlement_operations_audit
after insert or update on public.reward_settlement_operations
for each row execute function public.audit_reward_settlement_operation();

create or replace function public.audit_withdrawal_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.replaced_by_intent_id is distinct from old.replaced_by_intent_id
  then
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      new.created_by, 'user',
      case
        when tg_op = 'INSERT' and new.replaces_intent_id is not null
          then 'withdrawal.intent.replaced'
        when tg_op = 'INSERT' then 'withdrawal.intent.created'
        when new.replaced_by_intent_id is distinct from old.replaced_by_intent_id
          then 'withdrawal.intent.linked'
        else 'withdrawal.intent.transitioned'
      end,
      'withdrawal_intent', new.id::text,
      jsonb_build_object(
        'programId', new.program_id,
        'fromStatus', case when tg_op = 'INSERT' then null else old.status end,
        'toStatus', new.status,
        'replacesIntentId', new.replaces_intent_id,
        'replacedByIntentId', new.replaced_by_intent_id,
        'hasCloseEvidence', new.close_transaction_hash is not null,
        'hasWithdrawalEvidence', new.withdraw_transaction_hash is not null,
        'hasFailureCode', new.failure_code is not null
      )
    );
  end if;
  return new;
end;
$$;

create trigger withdrawal_intents_lifecycle_audit
after insert or update on public.withdrawal_intents
for each row execute function public.audit_withdrawal_intent();

alter table public.reward_settlement_operations
  add column post_total_paid_base_units numeric(78, 0)
    check (post_total_paid_base_units is null or post_total_paid_base_units >= 0),
  add column post_total_approved_outstanding_base_units numeric(78, 0)
    check (
      post_total_approved_outstanding_base_units is null
      or post_total_approved_outstanding_base_units >= 0
    ),
  add column post_total_funded_base_units numeric(78, 0)
    check (post_total_funded_base_units is null or post_total_funded_base_units >= 0),
  add column post_total_withdrawn_base_units numeric(78, 0)
    check (post_total_withdrawn_base_units is null or post_total_withdrawn_base_units >= 0),
  add column post_escrow_balance_base_units numeric(78, 0)
    check (post_escrow_balance_base_units is null or post_escrow_balance_base_units >= 0);

create or replace function public.confirm_reward_payout_with_accounting_atomic(
  target_intent_id uuid,
  submitted_transaction_hash text,
  reward_event_log_index integer,
  usdc_transfer_log_index integer,
  settled_block_number bigint,
  settled_block_hash text,
  post_total_paid_base_units numeric,
  post_total_approved_outstanding_base_units numeric,
  post_total_funded_base_units numeric,
  post_total_withdrawn_base_units numeric,
  post_escrow_balance_base_units numeric
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents%rowtype;
  operation_record public.reward_settlement_operations%rowtype;
  report_record public.reports%rowtype;
  program_record public.programs%rowtype;
  expected_paid numeric;
  expected_outstanding numeric;
  expected_funded numeric;
  expected_withdrawn numeric;
begin
  if target_intent_id is null
     or submitted_transaction_hash is null
     or reward_event_log_index is null
     or usdc_transfer_log_index is null
     or settled_block_number is null
     or settled_block_hash is null
  then
    perform public.reject_business('reward_payout_confirmation_mismatch');
  end if;

  if post_total_paid_base_units is null
     or post_total_approved_outstanding_base_units is null
     or post_total_funded_base_units is null
     or post_total_withdrawn_base_units is null
     or post_escrow_balance_base_units is null
     or post_total_paid_base_units < 0
     or post_total_approved_outstanding_base_units < 0
     or post_total_funded_base_units < 0
     or post_total_withdrawn_base_units < 0
     or post_escrow_balance_base_units < 0
     or post_total_paid_base_units + post_total_withdrawn_base_units
        > post_total_funded_base_units
     or post_total_approved_outstanding_base_units > post_escrow_balance_base_units
     or post_total_funded_base_units
        is distinct from post_escrow_balance_base_units
          + post_total_paid_base_units
          + post_total_withdrawn_base_units
  then
    perform public.reject_business('reward_payout_accounting_snapshot_invalid');
  end if;

  select * into intent_record
  from public.reward_settlement_intents
  where id = target_intent_id
  for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  if intent_record.status = 'paid' then
    select * into operation_record
    from public.reward_settlement_operations
    where intent_id = target_intent_id
      and operation_type = 'payout'
      and status = 'confirmed'
    order by attempt_no desc
    limit 1;
    if not found
       or operation_record.transaction_hash is distinct from lower(submitted_transaction_hash)
       or operation_record.event_log_index is distinct from reward_event_log_index
       or operation_record.transfer_log_index is distinct from usdc_transfer_log_index
       or operation_record.block_number is distinct from settled_block_number
       or operation_record.block_hash is distinct from lower(settled_block_hash)
       or operation_record.post_total_paid_base_units
          is distinct from post_total_paid_base_units
       or operation_record.post_total_approved_outstanding_base_units
          is distinct from post_total_approved_outstanding_base_units
       or operation_record.post_total_funded_base_units
          is distinct from post_total_funded_base_units
       or operation_record.post_total_withdrawn_base_units
          is distinct from post_total_withdrawn_base_units
       or operation_record.post_escrow_balance_base_units
          is distinct from post_escrow_balance_base_units
    then
      perform public.reject_business('reward_payout_confirmation_mismatch');
    end if;
    return intent_record.id;
  end if;
  if intent_record.status <> 'payout_submitted' then
    perform public.reject_business('reward_payout_not_submitted');
  end if;

  select * into operation_record
  from public.reward_settlement_operations
  where intent_id = target_intent_id
    and operation_type = 'payout'
    and transaction_hash = lower(submitted_transaction_hash)
    and status = 'submitted'
  for update;
  if not found then perform public.reject_business('reward_payout_hash_unknown'); end if;

  select * into report_record
  from public.reports
  where id = intent_record.report_id
  for update;
  if report_record.status <> 'payment_pending'
     or report_record.approved_reward <> intent_record.amount
  then
    perform public.reject_business('invalid_report_transition');
  end if;
  select * into program_record
  from public.programs
  where id = intent_record.program_id
  for update;
  if not found then perform public.reject_missing('program_not_found'); end if;
  if program_record.reserved_pool < intent_record.amount then
    perform public.reject_business('reward_payout_projection_changed');
  end if;

  expected_paid := round((program_record.paid_pool + intent_record.amount) * 1000000);
  expected_outstanding :=
    round((program_record.reserved_pool - intent_record.amount) * 1000000);
  expected_funded := round(program_record.total_pool * 1000000);
  expected_withdrawn := round(program_record.withdrawn_pool * 1000000);
  -- eth_call at receipt.blockNumber observes end-of-block state. More than one
  -- payout can therefore be included in this snapshot. Accept that monotonic
  -- advancement only when the complete paid+outstanding conservation equation
  -- still matches the locked SQL reservations; each intent remains bound to its
  -- own exact RewardPaid and USDC Transfer evidence.
  if post_total_paid_base_units < expected_paid
     or post_total_approved_outstanding_base_units > expected_outstanding
     or post_total_paid_base_units + post_total_approved_outstanding_base_units
        is distinct from
          round((program_record.paid_pool + program_record.reserved_pool) * 1000000)
     or post_total_funded_base_units is distinct from expected_funded
     or post_total_withdrawn_base_units is distinct from expected_withdrawn
  then
    perform public.reject_business('reward_payout_accounting_projection_mismatch');
  end if;

  update public.reward_settlement_operations
  set status = 'confirmed',
    event_log_index = reward_event_log_index,
    transfer_log_index = usdc_transfer_log_index,
    block_number = settled_block_number,
    block_hash = lower(settled_block_hash),
    post_total_paid_base_units = confirm_reward_payout_with_accounting_atomic.post_total_paid_base_units,
    post_total_approved_outstanding_base_units =
      confirm_reward_payout_with_accounting_atomic.post_total_approved_outstanding_base_units,
    post_total_funded_base_units =
      confirm_reward_payout_with_accounting_atomic.post_total_funded_base_units,
    post_total_withdrawn_base_units =
      confirm_reward_payout_with_accounting_atomic.post_total_withdrawn_base_units,
    post_escrow_balance_base_units =
      confirm_reward_payout_with_accounting_atomic.post_escrow_balance_base_units
  where id = operation_record.id;

  insert into public.escrow_transactions (
    program_id, report_id, escrow_contract_id, chain_id, transaction_hash, log_index,
    transaction_type, status, token_address, amount, block_number, block_hash,
    confirmations, confirmed_at
  ) values (
    intent_record.program_id, intent_record.report_id, intent_record.escrow_contract_id,
    5042002, lower(submitted_transaction_hash), reward_event_log_index, 'payout',
    'confirmed', '0x3600000000000000000000000000000000000000',
    intent_record.amount, settled_block_number, lower(settled_block_hash), 1, now()
  );
  update public.programs
  set reserved_pool = reserved_pool - intent_record.amount,
    paid_pool = paid_pool + intent_record.amount,
    paid_report_count = paid_report_count + 1
  where id = intent_record.program_id;
  update public.reports
  set status = 'paid', paid_at = now()
  where id = intent_record.report_id;
  update public.reward_settlement_intents
  set status = 'paid'
  where id = target_intent_id;
  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  ) values (
    intent_record.report_id, intent_record.actor_id, 'confirm_payment',
    'payment_pending', 'paid',
    jsonb_build_object(
      'rewardSettlementIntentId', target_intent_id,
      'transactionHash', lower(submitted_transaction_hash)
    )
  );
  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id, 'payment_confirmed',
    jsonb_build_object(
      'reportId', intent_record.report_id,
      'amount', intent_record.amount::text
    )
  );
  return target_intent_id;
end;
$$;

revoke all on function public.confirm_reward_payout_with_accounting_atomic(
  uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric
) from public, anon, authenticated;
grant execute on function public.confirm_reward_payout_with_accounting_atomic(
  uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric
) to service_role;

comment on function public.confirm_reward_payout_with_accounting_atomic(
  uuid,text,integer,integer,bigint,text,numeric,numeric,numeric,numeric,numeric
) is
  'Confirms payout only when exact receipt-block contract counters and USDC balance match the locked SQL projection.';

-- NULL-safe compatibility hardening. These CREATE OR REPLACE definitions keep
-- the Release A signatures and service-role grants intact while making every
-- required request/evidence field explicit and every replay comparison exact.

create or replace function public.create_escrow_deployment_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_program_key text,
  target_owner_wallet text,
  target_withdraw_recipient text,
  target_refund_unlock_at timestamp with time zone,
  target_artifact_checksum text,
  target_runtime_checksum text,
  target_immutable_references jsonb,
  target_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  deployment_row public.escrow_contracts%rowtype;
  program_deadline timestamp with time zone;
begin
  if actor_id is null
     or target_program_id is null
     or target_program_key is null
     or target_owner_wallet is null
     or target_withdraw_recipient is null
     or target_refund_unlock_at is null
     or target_artifact_checksum is null
     or target_runtime_checksum is null
     or target_immutable_references is null
     or target_idempotency_key is null
  then
    raise exception using errcode = '22023',
      detail = 'escrow_deployment_parameters_required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':5042002', 0)
  );
  if not exists (
    select 1
    from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = '42501', detail = 'program_not_accessible';
  end if;
  select deadline into program_deadline
  from public.programs
  where id = target_program_id;
  if program_deadline is null then
    raise exception using errcode = '23514',
      detail = 'program_deadline_required_for_escrow';
  end if;
  if target_refund_unlock_at is distinct from program_deadline then
    raise exception using errcode = '22023',
      detail = 'refund_unlock_must_equal_program_deadline';
  end if;

  select * into deployment_row
  from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002
  for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
       or deployment_row.owner_wallet is distinct from lower(target_owner_wallet)
       or deployment_row.withdraw_recipient
          is distinct from lower(target_withdraw_recipient)
       or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at
       or deployment_row.artifact_checksum
          is distinct from lower(target_artifact_checksum)
       or deployment_row.runtime_bytecode_checksum
          is distinct from lower(target_runtime_checksum)
       or deployment_row.immutable_references
          is distinct from target_immutable_references
       or deployment_row.deploy_idempotency_key
          is distinct from target_idempotency_key
    then
      raise exception using errcode = '22023',
        detail = 'escrow_deployment_parameters_locked';
    end if;
    return deployment_row.id;
  end if;

  insert into public.escrow_contracts (
    program_id, chain_id, deployment_status, program_key, contract_version,
    artifact_checksum, runtime_bytecode_checksum, immutable_references,
    token_address, token_decimals, owner_wallet, withdraw_recipient,
    refund_unlock_at, deploy_idempotency_key
  ) values (
    target_program_id, 5042002, 'accepted', lower(target_program_key), '1.1.0',
    lower(target_artifact_checksum), lower(target_runtime_checksum),
    target_immutable_references,
    '0x3600000000000000000000000000000000000000', 6,
    lower(target_owner_wallet), lower(target_withdraw_recipient),
    target_refund_unlock_at, target_idempotency_key
  ) returning id into deployment_row.id;
  return deployment_row.id;
end;
$$;

create or replace function public.create_escrow_deployment_with_wallet_proof_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_wallet_challenge_id uuid,
  target_program_key text,
  target_owner_wallet text,
  target_withdraw_recipient text,
  target_refund_unlock_at timestamp with time zone,
  target_artifact_checksum text,
  target_runtime_checksum text,
  target_immutable_references jsonb,
  target_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  challenge_row public.escrow_wallet_control_challenges%rowtype;
  created_deployment_id uuid;
begin
  if actor_id is null
     or target_program_id is null
     or target_wallet_challenge_id is null
     or target_program_key is null
     or target_owner_wallet is null
     or target_withdraw_recipient is null
     or target_refund_unlock_at is null
     or target_artifact_checksum is null
     or target_runtime_checksum is null
     or target_immutable_references is null
     or target_idempotency_key is null
  then
    raise exception using errcode = '22023',
      detail = 'escrow_deployment_parameters_required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':5042002', 0)
  );
  perform 1
  from public.programs
  where id = target_program_id and owner_id = actor_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;

  select * into challenge_row
  from public.escrow_wallet_control_challenges
  where id = target_wallet_challenge_id
  for update;
  if not found
     or challenge_row.program_id is distinct from target_program_id
     or challenge_row.actor_id is distinct from actor_id
  then
    raise exception using errcode = 'P0002',
      detail = 'wallet_control_challenge_not_found';
  end if;
  if challenge_row.owner_wallet is distinct from lower(target_owner_wallet)
     or challenge_row.withdraw_recipient
        is distinct from lower(target_withdraw_recipient)
     or challenge_row.chain_id is distinct from 5042002
  then
    raise exception using errcode = '22023',
      detail = 'wallet_control_challenge_binding_mismatch';
  end if;
  if challenge_row.invalidated_at is not null then
    raise exception using errcode = '23514',
      detail = 'wallet_control_challenge_invalidated';
  end if;
  if challenge_row.expires_at <= statement_timestamp() then
    raise exception using errcode = '23514',
      detail = 'wallet_control_challenge_expired';
  end if;
  if challenge_row.consumed_at is not null then
    raise exception using errcode = '23505',
      detail = 'wallet_control_challenge_replayed';
  end if;

  created_deployment_id := public.create_escrow_deployment_atomic(
    actor_id,
    target_program_id,
    target_program_key,
    target_owner_wallet,
    target_withdraw_recipient,
    target_refund_unlock_at,
    target_artifact_checksum,
    target_runtime_checksum,
    target_immutable_references,
    target_idempotency_key
  );

  update public.escrow_wallet_control_challenges
  set consumed_at = statement_timestamp(),
    deployment_id = created_deployment_id
  where id = target_wallet_challenge_id;
  return created_deployment_id;
end;
$$;

create or replace function public.confirm_escrow_deployment_atomic(
  target_deployment_id uuid,
  verified_contract_address text,
  verified_transaction_hash text,
  verified_block_number bigint,
  verified_block_hash text,
  verified_deployment_wallet_reference text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  deployment_row public.escrow_contracts%rowtype;
  current_deadline timestamp with time zone;
begin
  if target_deployment_id is null
     or verified_contract_address is null
     or verified_transaction_hash is null
     or verified_block_number is null
     or verified_block_hash is null
     or verified_deployment_wallet_reference is null
  then
    raise exception using errcode = '22023',
      detail = 'escrow_deployment_confirmation_evidence_required';
  end if;

  select * into deployment_row
  from public.escrow_contracts
  where id = target_deployment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      detail = 'escrow_deployment_not_found';
  end if;
  select deadline into current_deadline
  from public.programs
  where id = deployment_row.program_id
  for update;
  if deployment_row.refund_unlock_at is distinct from current_deadline then
    raise exception using errcode = '22023',
      detail = 'refund_unlock_no_longer_matches_program_deadline';
  end if;
  if deployment_row.deployment_status = 'confirmed' then
    if deployment_row.contract_address
         is distinct from lower(verified_contract_address)
       or deployment_row.deployment_transaction_hash
         is distinct from lower(verified_transaction_hash)
       or deployment_row.deployment_block_number
         is distinct from verified_block_number
       or deployment_row.deployment_block_hash
         is distinct from lower(verified_block_hash)
       or deployment_row.deployment_wallet_reference
         is distinct from lower(verified_deployment_wallet_reference)
    then
      raise exception using errcode = '22023',
        detail = 'escrow_deployment_confirmation_mismatch';
    end if;
    return true;
  end if;
  if deployment_row.deployment_status not in ('pending', 'verifying') then
    raise exception using errcode = '22023',
      detail = 'escrow_deployment_transition_invalid';
  end if;
  update public.escrow_contracts
  set deployment_status = 'confirmed',
    contract_address = lower(verified_contract_address),
    deployment_transaction_hash = lower(verified_transaction_hash),
    deployment_block_number = verified_block_number,
    deployment_block_hash = lower(verified_block_hash),
    deployment_wallet_reference = lower(verified_deployment_wallet_reference),
    deployed_at = now(),
    failure_code = null
  where id = target_deployment_id;
  return true;
end;
$$;

create or replace function public.create_withdrawal_intent_atomic(
  actor_id uuid,
  target_program_id uuid,
  request_idempotency_key uuid,
  source_wallet text,
  expected_amount_base_units numeric,
  escrow_pre_total_withdrawn_base_units numeric,
  escrow_already_closed boolean
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  escrow_row public.escrow_contracts%rowtype;
  existing_row public.withdrawal_intents%rowtype;
  program_owner uuid;
  program_status text;
  program_reserved numeric;
  program_available_base_units numeric;
  created_id uuid;
begin
  if actor_id is null
     or target_program_id is null
     or request_idempotency_key is null
     or source_wallet is null
     or expected_amount_base_units is null
     or escrow_pre_total_withdrawn_base_units is null
     or escrow_already_closed is null
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_parameters_required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':withdraw', 0)
  );
  select owner_id, status, reserved_pool, trunc(available_pool * 1000000)
    into program_owner, program_status, program_reserved, program_available_base_units
  from public.programs
  where id = target_program_id
  for update;
  if not found or program_owner is distinct from actor_id then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  if program_status not in ('expired', 'closed') then
    raise exception using errcode = '23514',
      detail = 'withdrawal_program_not_ended';
  end if;

  select * into escrow_row
  from public.escrow_contracts
  where program_id = target_program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
  for update;
  if not found
     or escrow_row.contract_address is null
     or escrow_row.owner_wallet is null
     or escrow_row.withdraw_recipient is null
     or escrow_row.token_address
        is distinct from '0x3600000000000000000000000000000000000000'
     or escrow_row.contract_version is distinct from '1.1.0'
     or escrow_row.program_key is null
     or escrow_row.artifact_checksum is null
     or escrow_row.runtime_bytecode_checksum is null
  then
    raise exception using errcode = '23514',
      detail = 'verified_arc_escrow_required';
  end if;
  if lower(source_wallet) is distinct from escrow_row.owner_wallet then
    raise exception using errcode = '22023',
      detail = 'withdrawal_owner_wallet_mismatch';
  end if;
  if program_reserved is distinct from 0::numeric then
    raise exception using errcode = '23514',
      detail = 'withdrawal_reserved_rewards_exist';
  end if;
  if expected_amount_base_units <= 0
     or expected_amount_base_units is distinct from program_available_base_units
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_amount_projection_mismatch';
  end if;

  select * into existing_row
  from public.withdrawal_intents
  where program_id = target_program_id
    and idempotency_key = request_idempotency_key;
  if found then
    if existing_row.wallet_address is distinct from lower(source_wallet)
       or existing_row.amount_base_units
          is distinct from expected_amount_base_units
       or existing_row.pre_total_withdrawn_base_units
          is distinct from escrow_pre_total_withdrawn_base_units
       or existing_row.close_required
          is distinct from (not escrow_already_closed)
    then
      raise exception using errcode = '22023',
        detail = 'withdrawal_idempotency_payload_mismatch';
    end if;
    return existing_row.id;
  end if;
  if exists (
    select 1
    from public.withdrawal_intents
    where escrow_contract_id = escrow_row.id
      and status not in ('complete', 'failed')
  ) then
    raise exception using errcode = '23505',
      detail = 'withdrawal_intent_already_active';
  end if;

  insert into public.withdrawal_intents (
    program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
    recipient_address, amount_base_units, pre_total_withdrawn_base_units,
    close_required, status
  ) values (
    target_program_id, escrow_row.id, actor_id, request_idempotency_key,
    lower(source_wallet), escrow_row.withdraw_recipient,
    expected_amount_base_units, escrow_pre_total_withdrawn_base_units,
    not escrow_already_closed,
    case when escrow_already_closed
      then 'ready_to_withdraw' else 'ready_to_close' end
  ) returning id into created_id;
  return created_id;
end;
$$;

create or replace function public.create_withdrawal_replacement_intent_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_failed_intent_id uuid,
  request_idempotency_key uuid,
  source_wallet text,
  expected_amount_base_units numeric,
  escrow_pre_total_withdrawn_base_units numeric,
  escrow_already_closed boolean
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  prior_row public.withdrawal_intents%rowtype;
  existing_row public.withdrawal_intents%rowtype;
  escrow_row public.escrow_contracts%rowtype;
  program_owner uuid;
  program_status text;
  program_reserved numeric;
  program_available_base_units numeric;
  created_id uuid;
begin
  if actor_id is null
     or target_program_id is null
     or target_failed_intent_id is null
     or request_idempotency_key is null
     or source_wallet is null
     or expected_amount_base_units is null
     or escrow_pre_total_withdrawn_base_units is null
     or escrow_already_closed is null
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_parameters_required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':withdraw', 0)
  );
  select owner_id, status, reserved_pool, trunc(available_pool * 1000000)
    into program_owner, program_status, program_reserved, program_available_base_units
  from public.programs
  where id = target_program_id
  for update;
  if not found or program_owner is distinct from actor_id then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  if program_status not in ('expired', 'closed') then
    raise exception using errcode = '23514',
      detail = 'withdrawal_program_not_ended';
  end if;

  select * into prior_row
  from public.withdrawal_intents
  where id = target_failed_intent_id
  for update;
  if not found or prior_row.program_id is distinct from target_program_id then
    raise exception using errcode = 'P0002',
      detail = 'withdrawal_intent_not_found';
  end if;
  if prior_row.status is distinct from 'failed'
     or prior_row.failure_code is null
     or (prior_row.close_transaction_hash is null
       and prior_row.withdraw_transaction_hash is null)
  then
    raise exception using errcode = '23514',
      detail = 'withdrawal_replacement_requires_verified_failure';
  end if;

  select * into existing_row
  from public.withdrawal_intents
  where program_id = target_program_id
    and idempotency_key = request_idempotency_key;
  if found then
    if existing_row.replaces_intent_id is distinct from prior_row.id
       or existing_row.wallet_address is distinct from lower(source_wallet)
       or existing_row.amount_base_units
          is distinct from expected_amount_base_units
       or existing_row.pre_total_withdrawn_base_units
          is distinct from escrow_pre_total_withdrawn_base_units
       or existing_row.close_required
          is distinct from (not escrow_already_closed)
    then
      raise exception using errcode = '22023',
        detail = 'withdrawal_idempotency_payload_mismatch';
    end if;
    return existing_row.id;
  end if;
  if prior_row.replaced_by_intent_id is not null then
    raise exception using errcode = '23505',
      detail = 'withdrawal_replacement_already_exists';
  end if;

  select * into escrow_row
  from public.escrow_contracts
  where id = prior_row.escrow_contract_id
    and program_id = target_program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
  for update;
  if not found
     or escrow_row.contract_address is null
     or escrow_row.owner_wallet is null
     or escrow_row.withdraw_recipient is null
     or escrow_row.token_address
        is distinct from '0x3600000000000000000000000000000000000000'
     or escrow_row.contract_version is distinct from '1.1.0'
     or escrow_row.program_key is null
     or escrow_row.artifact_checksum is null
     or escrow_row.runtime_bytecode_checksum is null
  then
    raise exception using errcode = '23514',
      detail = 'verified_arc_escrow_required';
  end if;
  if lower(source_wallet) is distinct from escrow_row.owner_wallet then
    raise exception using errcode = '22023',
      detail = 'withdrawal_owner_wallet_mismatch';
  end if;
  if program_reserved is distinct from 0::numeric then
    raise exception using errcode = '23514',
      detail = 'withdrawal_reserved_rewards_exist';
  end if;
  if expected_amount_base_units <= 0
     or expected_amount_base_units is distinct from program_available_base_units
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_amount_projection_mismatch';
  end if;
  if exists (
    select 1
    from public.withdrawal_intents
    where escrow_contract_id = escrow_row.id
      and status not in ('complete', 'failed')
  ) then
    raise exception using errcode = '23505',
      detail = 'withdrawal_intent_already_active';
  end if;

  insert into public.withdrawal_intents (
    program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
    recipient_address, amount_base_units, pre_total_withdrawn_base_units,
    close_required, status, replaces_intent_id
  ) values (
    target_program_id, escrow_row.id, actor_id, request_idempotency_key,
    lower(source_wallet), escrow_row.withdraw_recipient,
    expected_amount_base_units, escrow_pre_total_withdrawn_base_units,
    not escrow_already_closed,
    case when escrow_already_closed
      then 'ready_to_withdraw' else 'ready_to_close' end,
    prior_row.id
  ) returning id into created_id;

  update public.withdrawal_intents
  set replaced_by_intent_id = created_id
  where id = prior_row.id
    and replaced_by_intent_id is null;
  if not found then
    raise exception using errcode = '23505',
      detail = 'withdrawal_replacement_already_exists';
  end if;
  return created_id;
end;
$$;

create or replace function public.confirm_withdrawal_close_atomic(
  target_intent_id uuid,
  verified_close_hash text,
  verified_close_log_index integer,
  verified_close_block_number bigint,
  verified_close_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.withdrawal_intents%rowtype;
begin
  if target_intent_id is null
     or verified_close_hash is null
     or verified_close_log_index is null
     or verified_close_block_number is null
     or verified_close_block_hash is null
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_close_evidence_required';
  end if;

  select * into intent_row
  from public.withdrawal_intents
  where id = target_intent_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      detail = 'withdrawal_intent_not_found';
  end if;
  if not intent_row.close_required then
    return false;
  end if;
  if intent_row.close_transaction_hash
       is distinct from lower(verified_close_hash)
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_close_hash_mismatch';
  end if;
  if intent_row.close_log_index is not null then
    if intent_row.close_log_index is distinct from verified_close_log_index
       or intent_row.close_block_number
          is distinct from verified_close_block_number
       or intent_row.close_block_hash
          is distinct from lower(verified_close_block_hash)
    then
      raise exception using errcode = '22023',
        detail = 'withdrawal_close_evidence_mismatch';
    end if;
    return true;
  end if;
  update public.withdrawal_intents
  set close_log_index = verified_close_log_index,
    close_block_number = verified_close_block_number,
    close_block_hash = lower(verified_close_block_hash),
    status = 'ready_to_withdraw',
    updated_at = now()
  where id = target_intent_id
    and status = 'close_submitted';
  return found;
end;
$$;

create or replace function public.reconcile_withdrawal_intent_atomic(
  target_intent_id uuid,
  verified_withdraw_hash text,
  verified_withdraw_log_index integer,
  verified_transfer_log_index integer,
  verified_amount_base_units numeric,
  verified_block_number bigint,
  verified_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.withdrawal_intents%rowtype;
  escrow_row public.escrow_contracts%rowtype;
  program_available_base_units numeric;
  program_reserved numeric;
  inserted_id uuid;
begin
  if target_intent_id is null
     or verified_withdraw_hash is null
     or verified_withdraw_log_index is null
     or verified_transfer_log_index is null
     or verified_amount_base_units is null
     or verified_block_number is null
     or verified_block_hash is null
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_evidence_required';
  end if;

  select * into intent_row
  from public.withdrawal_intents
  where id = target_intent_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      detail = 'withdrawal_intent_not_found';
  end if;
  if intent_row.status = 'complete' then
    if intent_row.withdraw_transaction_hash
         is distinct from lower(verified_withdraw_hash)
       or intent_row.withdraw_log_index
         is distinct from verified_withdraw_log_index
       or intent_row.transfer_log_index
         is distinct from verified_transfer_log_index
       or intent_row.amount_base_units
         is distinct from verified_amount_base_units
       or intent_row.withdraw_block_number
         is distinct from verified_block_number
       or intent_row.withdraw_block_hash
         is distinct from lower(verified_block_hash)
    then
      raise exception using errcode = '22023',
        detail = 'withdrawal_evidence_mismatch';
    end if;
    return true;
  end if;
  if intent_row.status is distinct from 'withdraw_submitted'
     or intent_row.withdraw_transaction_hash
        is distinct from lower(verified_withdraw_hash)
     or intent_row.amount_base_units
        is distinct from verified_amount_base_units
  then
    raise exception using errcode = '22023',
      detail = 'withdrawal_evidence_mismatch';
  end if;
  if intent_row.close_required and intent_row.close_log_index is null then
    raise exception using errcode = '23514',
      detail = 'withdrawal_close_not_verified';
  end if;
  select reserved_pool, trunc(available_pool * 1000000)
    into program_reserved, program_available_base_units
  from public.programs
  where id = intent_row.program_id
  for update;
  if program_reserved is distinct from 0::numeric
     or program_available_base_units < verified_amount_base_units
  then
    raise exception using errcode = '23514',
      detail = 'withdrawal_projection_changed';
  end if;
  select * into escrow_row
  from public.escrow_contracts
  where id = intent_row.escrow_contract_id;

  insert into public.escrow_transactions (
    program_id, escrow_contract_id, withdrawal_intent_id, chain_id,
    transaction_hash, log_index, transaction_type, status, token_address,
    amount, block_number, block_hash, confirmations, from_address, to_address,
    confirmed_at
  ) values (
    intent_row.program_id, escrow_row.id, intent_row.id, 5042002,
    lower(verified_withdraw_hash), verified_withdraw_log_index,
    'withdraw_remaining', 'confirmed', escrow_row.token_address,
    verified_amount_base_units / 1000000, verified_block_number,
    lower(verified_block_hash), 1, escrow_row.contract_address,
    intent_row.recipient_address, now()
  )
  on conflict (chain_id, transaction_hash, log_index) do nothing
  returning id into inserted_id;
  if inserted_id is null then
    if exists (
      select 1
      from public.escrow_transactions transaction_record
      where transaction_record.withdrawal_intent_id = intent_row.id
        and transaction_record.transaction_hash = lower(verified_withdraw_hash)
        and transaction_record.log_index = verified_withdraw_log_index
        and transaction_record.amount = verified_amount_base_units / 1000000
        and transaction_record.block_number = verified_block_number
        and transaction_record.block_hash = lower(verified_block_hash)
    ) then
      return true;
    end if;
    raise exception using errcode = '23505',
      detail = 'withdrawal_event_already_attributed';
  end if;
  update public.programs
  set withdrawn_pool =
    withdrawn_pool + verified_amount_base_units / 1000000
  where id = intent_row.program_id;
  update public.escrow_contracts
  set last_synced_block =
    greatest(coalesce(last_synced_block, 0), verified_block_number)
  where id = escrow_row.id;
  update public.withdrawal_intents
  set status = 'complete',
    withdraw_log_index = verified_withdraw_log_index,
    transfer_log_index = verified_transfer_log_index,
    withdraw_block_number = verified_block_number,
    withdraw_block_hash = lower(verified_block_hash),
    completed_at = now(),
    updated_at = now()
  where id = target_intent_id;
  return true;
end;
$$;

revoke all on function public.create_escrow_deployment_atomic(
  uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) from public, anon, authenticated;
revoke all on function public.create_escrow_deployment_with_wallet_proof_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) from public, anon, authenticated;
revoke all on function public.confirm_escrow_deployment_atomic(
  uuid,text,text,bigint,text,text
) from public, anon, authenticated;
revoke all on function public.create_withdrawal_intent_atomic(
  uuid,uuid,uuid,text,numeric,numeric,boolean
) from public, anon, authenticated;
revoke all on function public.create_withdrawal_replacement_intent_atomic(
  uuid,uuid,uuid,uuid,text,numeric,numeric,boolean
) from public, anon, authenticated;
revoke all on function public.confirm_withdrawal_close_atomic(
  uuid,text,integer,bigint,text
) from public, anon, authenticated;
revoke all on function public.reconcile_withdrawal_intent_atomic(
  uuid,text,integer,integer,numeric,bigint,text
) from public, anon, authenticated;

grant execute on function public.create_escrow_deployment_atomic(
  uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) to service_role;
grant execute on function public.create_escrow_deployment_with_wallet_proof_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) to service_role;
grant execute on function public.confirm_escrow_deployment_atomic(
  uuid,text,text,bigint,text,text
) to service_role;
grant execute on function public.create_withdrawal_intent_atomic(
  uuid,uuid,uuid,text,numeric,numeric,boolean
) to service_role;
grant execute on function public.create_withdrawal_replacement_intent_atomic(
  uuid,uuid,uuid,uuid,text,numeric,numeric,boolean
) to service_role;
grant execute on function public.confirm_withdrawal_close_atomic(
  uuid,text,integer,bigint,text
) to service_role;
grant execute on function public.reconcile_withdrawal_intent_atomic(
  uuid,text,integer,integer,numeric,bigint,text
) to service_role;
