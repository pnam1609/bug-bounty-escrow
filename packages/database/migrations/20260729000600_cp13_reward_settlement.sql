-- CP-13: durable, evidence-backed reward settlement.
--
-- The browser signs only approveReward. A Circle developer-controlled wallet relays the
-- permissionless payReward call after approval is final. Application callers can observe a
-- submission, but only service-role code that has verified Arc receipt/event/state evidence can
-- project either transition into the report and program ledgers.

create table public.reward_settlement_intents (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete restrict,
  program_id uuid not null references public.programs (id) on delete restrict,
  escrow_contract_id uuid not null references public.escrow_contracts (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  idempotency_key uuid not null,
  owner_wallet text not null check (owner_wallet ~ '^0x[0-9a-f]{40}$'),
  report_key text not null check (report_key ~ '^0x[0-9a-f]{64}$'),
  approved_content_hash text not null check (approved_content_hash ~ '^0x[0-9a-f]{64}$'),
  recipient_address text not null check (
    recipient_address ~ '^0x[0-9a-f]{40}$'
    and recipient_address <> '0x0000000000000000000000000000000000000000'
  ),
  calculation_type text not null check (
    calculation_type in ('range', 'flat', 'percentage')
  ),
  calculation_basis_base_units bigint,
  calculation_basis_amount numeric(30, 6),
  percentage_bps integer,
  max_reward_cap_base_units bigint,
  max_reward_cap numeric(30, 6),
  amount_base_units bigint not null check (amount_base_units > 0),
  amount numeric(30, 6) not null check (amount > 0),
  status text not null default 'awaiting_approval' check (
    status in (
      'awaiting_approval',
      'approval_submitted',
      'ready_for_payout',
      'payout_submitted',
      'paid',
      'failed'
    )
  ),
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint reward_settlement_intents_idempotency_key unique (program_id, idempotency_key),
  constraint reward_settlement_intents_amount_consistent check (
    amount_base_units = round(amount * 1000000)::bigint
  ),
  constraint reward_settlement_intents_calculation_snapshot_check check (
    (
      calculation_type = 'percentage'
      and calculation_basis_base_units is not null
      and calculation_basis_base_units > 0
      and calculation_basis_amount is not null
      and calculation_basis_amount > 0
      and calculation_basis_base_units = round(calculation_basis_amount * 1000000)::bigint
      and percentage_bps is not null
      and percentage_bps > 0
      and percentage_bps <= 10000
      and max_reward_cap_base_units is not null
      and max_reward_cap_base_units > 0
      and max_reward_cap is not null
      and max_reward_cap > 0
      and max_reward_cap_base_units = round(max_reward_cap * 1000000)::bigint
    )
    or (
      calculation_type in ('range', 'flat')
      and calculation_basis_base_units is null
      and calculation_basis_amount is null
      and percentage_bps is null
      and max_reward_cap_base_units is null
      and max_reward_cap is null
    )
  )
);

create unique index reward_settlement_intents_active_report_key
  on public.reward_settlement_intents (report_id)
  where status <> 'failed';

create table public.reward_settlement_operations (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.reward_settlement_intents (id) on delete restrict,
  operation_type text not null check (operation_type in ('approval', 'payout')),
  attempt_no integer not null check (attempt_no > 0),
  replaces_operation_id uuid references public.reward_settlement_operations (id) on delete restrict,
  status text not null check (
    status in (
      'submission_uncertain',
      'provider_accepted',
      'submitted',
      'confirmed',
      'failed'
    )
  ),
  provider_idempotency_key uuid,
  circle_transaction_id text,
  transaction_hash text check (
    transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  event_log_index integer check (event_log_index is null or event_log_index >= 0),
  transfer_log_index integer check (transfer_log_index is null or transfer_log_index >= 0),
  block_number bigint check (block_number is null or block_number >= 0),
  block_hash text check (block_hash is null or block_hash ~ '^0x[0-9a-f]{64}$'),
  failure_code text check (
    failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'
  ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint reward_settlement_operations_attempt_key
    unique (intent_id, operation_type, attempt_no),
  constraint reward_settlement_operations_chain_hash_key unique (transaction_hash),
  constraint reward_settlement_operations_circle_transaction_key unique (circle_transaction_id),
  constraint reward_settlement_operations_outcome_check check (
    (
      status = 'failed'
      and failure_code is not null
    )
    or (
      status <> 'failed'
      and failure_code is null
    )
  ),
  constraint reward_settlement_operations_type_evidence_check check (
    (
      operation_type = 'approval'
      and provider_idempotency_key is null
      and circle_transaction_id is null
      and transfer_log_index is null
      and (
        (
          status = 'submission_uncertain'
          and transaction_hash is null
          and event_log_index is null
          and block_number is null
          and block_hash is null
        )
        or (
          status = 'submitted'
          and transaction_hash is not null
          and event_log_index is null
          and block_number is null
          and block_hash is null
        )
        or (
          status = 'confirmed'
          and transaction_hash is not null
          and event_log_index is not null
          and block_number is not null
          and block_hash is not null
        )
        or (
          status = 'failed'
          and event_log_index is null
          and block_number is null
          and block_hash is null
        )
      )
    )
    or (
      operation_type = 'payout'
      and (
        (
          status = 'submission_uncertain'
          and provider_idempotency_key is not null
          and circle_transaction_id is null
          and transaction_hash is null
          and event_log_index is null
          and transfer_log_index is null
          and block_number is null
          and block_hash is null
        )
        or (
          status = 'provider_accepted'
          and provider_idempotency_key is not null
          and circle_transaction_id is not null
          and transaction_hash is null
          and event_log_index is null
          and transfer_log_index is null
          and block_number is null
          and block_hash is null
        )
        or (
          status = 'submitted'
          and transaction_hash is not null
          and event_log_index is null
          and transfer_log_index is null
          and block_number is null
          and block_hash is null
          and (
            (
              provider_idempotency_key is null
              and circle_transaction_id is null
            )
            or (
              provider_idempotency_key is not null
              and circle_transaction_id is not null
            )
          )
        )
        or (
          status = 'confirmed'
          and transaction_hash is not null
          and event_log_index is not null
          and transfer_log_index is not null
          and block_number is not null
          and block_hash is not null
          and (
            (
              provider_idempotency_key is null
              and circle_transaction_id is null
            )
            or (
              provider_idempotency_key is not null
              and circle_transaction_id is not null
            )
          )
        )
        or (
          status = 'failed'
          and event_log_index is null
          and transfer_log_index is null
          and block_number is null
          and block_hash is null
          and (
            circle_transaction_id is null
            or provider_idempotency_key is not null
          )
        )
      )
    )
  )
);

create unique index reward_settlement_operations_active_key
  on public.reward_settlement_operations (intent_id, operation_type)
  where status in ('submission_uncertain', 'provider_accepted', 'submitted');

create trigger reward_settlement_intents_set_updated_at
before update on public.reward_settlement_intents
for each row execute function public.set_updated_at();

create trigger reward_settlement_operations_set_updated_at
before update on public.reward_settlement_operations
for each row execute function public.set_updated_at();

alter table public.reward_settlement_intents enable row level security;
alter table public.reward_settlement_operations enable row level security;
revoke all on public.reward_settlement_intents from public, anon, authenticated;
revoke all on public.reward_settlement_operations from public, anon, authenticated;
grant select, insert, update on public.reward_settlement_intents to service_role;
grant select, insert, update on public.reward_settlement_operations to service_role;
create policy authenticated_user_must_be_active
  on public.reward_settlement_intents
  as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));
create policy authenticated_user_must_be_active
  on public.reward_settlement_operations
  as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));

create or replace function public.create_reward_settlement_intent_atomic(
  actor_id uuid,
  target_report_id uuid,
  reward_amount numeric,
  calculation_basis_amount numeric,
  target_report_key text,
  target_content_hash text,
  target_owner_wallet text,
  request_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  escrow_record public.escrow_contracts;
  tier_record public.program_reward_tiers;
  scope_asset_type text;
  allowed_bounds numrange;
  settled_amount numeric;
  recipient text;
  existing_intent public.reward_settlement_intents;
  result_id uuid;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found then
    perform public.reject_forbidden('report_not_accessible');
  end if;
  if report_record.status <> 'validated' or report_record.final_severity is null then
    perform public.reject_business('invalid_report_transition');
  end if;

  select * into program_record from public.programs
  where id = report_record.program_id for update;
  if program_record.owner_id <> actor_id then
    perform public.reject_forbidden('program_owner_required');
  end if;

  select * into existing_intent
  from public.reward_settlement_intents
  where program_id = report_record.program_id and idempotency_key = request_idempotency_key
  order by created_at
  limit 1
  for update;
  if found then
    if existing_intent.report_id <> target_report_id
      or existing_intent.owner_wallet <> lower(target_owner_wallet)
      or existing_intent.report_key <> lower(target_report_key)
      or existing_intent.approved_content_hash <> lower(target_content_hash)
      or (
        existing_intent.calculation_type = 'percentage'
        and (
          reward_amount is not null
          or calculation_basis_amount is distinct from existing_intent.calculation_basis_amount
        )
      )
      or (
        existing_intent.calculation_type in ('range', 'flat')
        and (
          calculation_basis_amount is not null
          or reward_amount is distinct from existing_intent.amount
        )
      )
    then
      perform public.reject_business('reward_settlement_idempotency_mismatch');
    end if;
    return existing_intent.id;
  end if;

  select * into escrow_record
  from public.escrow_contracts
  where program_id = report_record.program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
    and contract_version = '1.1.0'
  order by created_at desc
  limit 1
  for update;
  if not found
    or escrow_record.contract_address is null
    or escrow_record.owner_wallet is null
    or escrow_record.token_address <> '0x3600000000000000000000000000000000000000'
  then
    perform public.reject_business('canonical_program_escrow_required');
  end if;
  if escrow_record.owner_wallet <> lower(target_owner_wallet) then
    perform public.reject_business('escrow_owner_wallet_mismatch');
  end if;

  select profile.wallet_address into recipient
  from public.profiles as profile
  where profile.id = report_record.researcher_id
  for share;
  if recipient is null then
    perform public.reject_business('researcher_payout_wallet_required');
  end if;

  select scope.asset_type into scope_asset_type
  from public.program_scopes as scope
  where scope.id = report_record.affected_scope_id;
  select * into tier_record
  from public.program_reward_tiers
  where program_id = report_record.program_id
    and asset_type = scope_asset_type
    and severity = report_record.final_severity
    and archived_at is null;
  if not found then
    perform public.reject_business('reward_tier_coverage_missing');
  end if;

  if tier_record.calculation_type = 'percentage' then
    if reward_amount is not null
      or calculation_basis_amount is null
      or calculation_basis_amount <= 0
    then
      perform public.reject_business('reward_basis_required');
    end if;
    settled_amount := round(
      least(
        calculation_basis_amount * tier_record.percentage_bps / 10000,
        tier_record.max_reward_cap
      ),
      6
    );
  else
    if reward_amount is null or calculation_basis_amount is not null then
      perform public.reject_business('reward_amount_required');
    end if;
    allowed_bounds := public.reward_tier_bounds(tier_record);
    if not (allowed_bounds @> reward_amount) then
      perform public.reject_business('reward_out_of_bounds');
    end if;
    settled_amount := reward_amount;
  end if;
  if settled_amount <= 0 then perform public.reject_business('reward_out_of_bounds'); end if;
  if settled_amount > program_record.available_pool then
    perform public.reject_business('insufficient_available_pool');
  end if;

  insert into public.reward_settlement_intents (
    report_id, program_id, escrow_contract_id, actor_id, idempotency_key,
    owner_wallet, report_key, approved_content_hash, recipient_address,
    calculation_type, calculation_basis_base_units, calculation_basis_amount,
    percentage_bps, max_reward_cap_base_units, max_reward_cap,
    amount_base_units, amount
  ) values (
    target_report_id, report_record.program_id, escrow_record.id, actor_id,
    request_idempotency_key, lower(target_owner_wallet), lower(target_report_key),
    lower(report_record.content_hash), lower(recipient),
    tier_record.calculation_type,
    case when tier_record.calculation_type = 'percentage'
      then round(calculation_basis_amount * 1000000)::bigint else null end,
    case when tier_record.calculation_type = 'percentage'
      then calculation_basis_amount else null end,
    case when tier_record.calculation_type = 'percentage'
      then tier_record.percentage_bps else null end,
    case when tier_record.calculation_type = 'percentage'
      then round(tier_record.max_reward_cap * 1000000)::bigint else null end,
    case when tier_record.calculation_type = 'percentage'
      then tier_record.max_reward_cap else null end,
    round(settled_amount * 1000000)::bigint, settled_amount
  )
  returning id into result_id;
  -- Reserve before the browser prompt. This serializes concurrent reward intents against the
  -- same program and prevents off-chain availability from overbooking the contract balance.
  update public.programs
  set reserved_pool = reserved_pool + settled_amount
  where id = report_record.program_id;
  return result_id;
end;
$$;

create or replace function public.observe_reward_approval_submission_atomic(
  actor_id uuid,
  target_intent_id uuid,
  submission_outcome text,
  submitted_transaction_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  operation_id uuid;
  next_attempt integer;
  replaced_id uuid;
begin
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found or not exists (
    select 1 from public.programs
    where id = intent_record.program_id and owner_id = actor_id
  ) then
    perform public.reject_forbidden('reward_settlement_not_accessible');
  end if;
  if intent_record.status in ('approval_submitted', 'ready_for_payout', 'payout_submitted', 'paid')
    and submission_outcome = 'submitted'
    and submitted_transaction_hash is not null
  then
    select id into operation_id
    from public.reward_settlement_operations
    where intent_id = target_intent_id
      and operation_type = 'approval'
      and transaction_hash = lower(submitted_transaction_hash)
      and status in ('submitted', 'confirmed')
    order by attempt_no desc
    limit 1;
    if operation_id is null then
      perform public.reject_business('reward_approval_observation_mismatch');
    end if;
    return operation_id;
  end if;
  if intent_record.status <> 'awaiting_approval' then
    perform public.reject_business('reward_approval_not_awaiting_submission');
  end if;
  if submission_outcome not in ('submitted', 'submission_uncertain') then
    perform public.reject_business('reward_submission_outcome_invalid');
  end if;
  if (submission_outcome = 'submitted') <> (submitted_transaction_hash is not null) then
    perform public.reject_business('reward_submission_hash_invalid');
  end if;

  if submission_outcome = 'submitted' then
    update public.reward_settlement_operations
    set status = 'submitted', transaction_hash = lower(submitted_transaction_hash)
    where id = (
      select id from public.reward_settlement_operations
      where intent_id = target_intent_id
        and operation_type = 'approval'
        and status = 'submission_uncertain'
      order by attempt_no desc
      limit 1
    )
    returning id into operation_id;
    if operation_id is not null then
      update public.reward_settlement_intents
      set status = 'approval_submitted', failure_code = null
      where id = target_intent_id;
      return operation_id;
    end if;
  end if;

  select coalesce(max(attempt_no), 0) + 1,
    (array_agg(id order by attempt_no desc))[1]
  into next_attempt, replaced_id
  from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'approval';

  insert into public.reward_settlement_operations (
    intent_id, operation_type, attempt_no, replaces_operation_id, status, transaction_hash
  ) values (
    target_intent_id, 'approval', next_attempt, replaced_id, submission_outcome,
    lower(submitted_transaction_hash)
  )
  returning id into operation_id;
  if submission_outcome = 'submitted' then
    update public.reward_settlement_intents
    set status = 'approval_submitted', failure_code = null where id = target_intent_id;
  end if;
  return operation_id;
end;
$$;

create or replace function public.confirm_reward_approval_atomic(
  target_intent_id uuid,
  submitted_transaction_hash text,
  reward_event_log_index integer,
  settled_block_number bigint,
  settled_block_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  operation_record public.reward_settlement_operations;
  report_record public.reports;
begin
  if target_intent_id is null
    or submitted_transaction_hash is null
    or reward_event_log_index is null
    or settled_block_number is null
    or settled_block_hash is null
  then
    perform public.reject_business('reward_approval_confirmation_mismatch');
  end if;

  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  if intent_record.status in ('ready_for_payout', 'payout_submitted', 'paid') then
    select * into operation_record
    from public.reward_settlement_operations
    where intent_id = target_intent_id
      and operation_type = 'approval'
      and status = 'confirmed'
    order by attempt_no desc
    limit 1;
    if not found
      or operation_record.transaction_hash is distinct from lower(submitted_transaction_hash)
      or operation_record.event_log_index is distinct from reward_event_log_index
      or operation_record.block_number is distinct from settled_block_number
      or operation_record.block_hash is distinct from lower(settled_block_hash)
    then
      perform public.reject_business('reward_approval_confirmation_mismatch');
    end if;
    return intent_record.id;
  end if;
  if intent_record.status <> 'approval_submitted' then
    perform public.reject_business('reward_approval_not_submitted');
  end if;

  select * into operation_record from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'approval'
    and transaction_hash = lower(submitted_transaction_hash)
    and status = 'submitted'
  for update;
  if not found then perform public.reject_business('reward_approval_hash_unknown'); end if;
  select * into report_record from public.reports
  where id = intent_record.report_id for update;
  if report_record.status <> 'validated' then
    perform public.reject_business('invalid_report_transition');
  end if;
  perform 1 from public.programs where id = intent_record.program_id for update;

  update public.reward_settlement_operations
  set status = 'confirmed', event_log_index = reward_event_log_index,
    block_number = settled_block_number, block_hash = lower(settled_block_hash)
  where id = operation_record.id;
  update public.reports
  set status = 'reward_approved', approved_reward = intent_record.amount,
    reward_approved_at = now()
  where id = intent_record.report_id;
  update public.reward_settlement_intents
  set status = 'ready_for_payout'
  where id = target_intent_id;
  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  ) values (
    intent_record.report_id, intent_record.actor_id, 'approve_reward',
    'validated', 'reward_approved',
    jsonb_build_object(
      'rewardSettlementIntentId', target_intent_id,
      'transactionHash', lower(submitted_transaction_hash),
      'calculationType', intent_record.calculation_type,
      'calculationBasisAmount', intent_record.calculation_basis_amount,
      'percentageBps', intent_record.percentage_bps,
      'maxRewardCap', intent_record.max_reward_cap,
      'rewardAmount', intent_record.amount
    )
  );
  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id, 'reward_approved',
    jsonb_build_object('reportId', intent_record.report_id, 'amount', intent_record.amount::text)
  );
  return target_intent_id;
end;
$$;

create or replace function public.fail_reward_settlement_operation_atomic(
  target_intent_id uuid,
  target_operation_type text,
  target_failure_code text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  operation_id uuid;
begin
  if target_operation_type not in ('approval', 'payout')
    or target_failure_code !~ '^[a-z][a-z0-9._-]{0,127}$'
  then
    perform public.reject_business('reward_operation_failure_invalid');
  end if;
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  update public.reward_settlement_operations
  set status = 'failed', failure_code = target_failure_code
  where id = (
    select id from public.reward_settlement_operations
    where intent_id = target_intent_id
      and operation_type = target_operation_type
      and status in ('submission_uncertain', 'provider_accepted', 'submitted')
    order by attempt_no desc
    limit 1
  )
  returning id into operation_id;
  if operation_id is null then
    perform public.reject_business('reward_operation_active_attempt_missing');
  end if;
  if target_operation_type = 'approval' then
    update public.reward_settlement_intents
    set status = 'awaiting_approval', failure_code = target_failure_code
    where id = target_intent_id;
  else
    update public.reward_settlement_intents
    set status = 'ready_for_payout', failure_code = target_failure_code
    where id = target_intent_id;
    update public.reports set status = 'reward_approved'
    where id = intent_record.report_id and status = 'payment_pending';
  end if;
  return operation_id;
end;
$$;

create or replace function public.cancel_reward_settlement_intent_atomic(
  actor_id uuid,
  target_intent_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare intent_record public.reward_settlement_intents;
begin
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found or not exists (
    select 1 from public.programs
    where id = intent_record.program_id and owner_id = actor_id
  ) then
    perform public.reject_forbidden('reward_settlement_not_accessible');
  end if;
  if intent_record.status <> 'awaiting_approval'
    or exists (
      select 1 from public.reward_settlement_operations
      where intent_id = target_intent_id
        and status in ('submission_uncertain', 'provider_accepted', 'submitted', 'confirmed')
    )
  then
    perform public.reject_business('reward_settlement_cannot_cancel');
  end if;
  perform 1 from public.programs where id = intent_record.program_id for update;
  update public.programs
  set reserved_pool = reserved_pool - intent_record.amount
  where id = intent_record.program_id;
  update public.reward_settlement_intents
  set status = 'failed', failure_code = 'cancelled_before_approval'
  where id = target_intent_id;
  return target_intent_id;
end;
$$;

create or replace function public.prepare_reward_payout_relay_atomic(
  target_intent_id uuid,
  target_provider_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  result_id uuid;
  next_attempt integer;
  replaced_id uuid;
begin
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  select id into result_id
  from public.reward_settlement_operations
  where intent_id = target_intent_id
    and operation_type = 'payout'
    and provider_idempotency_key = target_provider_idempotency_key;
  if found then return result_id; end if;
  if intent_record.status <> 'ready_for_payout' then
    perform public.reject_business('reward_payout_not_ready');
  end if;
  select coalesce(max(attempt_no), 0) + 1,
    (array_agg(id order by attempt_no desc))[1]
  into next_attempt, replaced_id
  from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'payout';
  insert into public.reward_settlement_operations (
    intent_id, operation_type, attempt_no, replaces_operation_id, status,
    provider_idempotency_key
  ) values (
    target_intent_id, 'payout', next_attempt, replaced_id, 'submission_uncertain',
    target_provider_idempotency_key
  ) returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.accept_reward_payout_relay_atomic(
  target_intent_id uuid,
  target_provider_idempotency_key uuid,
  target_circle_transaction_id text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  result_id uuid;
begin
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  if intent_record.status <> 'ready_for_payout' then
    perform public.reject_business('reward_payout_not_ready');
  end if;
  update public.reward_settlement_operations
  set status = 'provider_accepted', circle_transaction_id = target_circle_transaction_id
  where intent_id = target_intent_id
    and operation_type = 'payout'
    and provider_idempotency_key = target_provider_idempotency_key
    and status = 'submission_uncertain'
  returning id into result_id;
  if result_id is null then
    perform public.reject_business('reward_payout_operation_unknown');
  end if;
  update public.reward_settlement_intents set status = 'payout_submitted'
  where id = target_intent_id;
  update public.reports set status = 'payment_pending'
  where id = intent_record.report_id and status = 'reward_approved';
  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  ) values (
    intent_record.report_id, intent_record.actor_id, 'start_payment',
    'reward_approved', 'payment_pending',
    jsonb_build_object(
      'rewardSettlementIntentId', target_intent_id,
      'circleTransactionId', target_circle_transaction_id
    )
  );
  return result_id;
end;
$$;

create or replace function public.attach_reward_payout_hash_atomic(
  target_intent_id uuid,
  target_circle_transaction_id text,
  submitted_transaction_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare result_id uuid;
begin
  update public.reward_settlement_operations
  set status = 'submitted', transaction_hash = lower(submitted_transaction_hash)
  where intent_id = target_intent_id and operation_type = 'payout'
    and circle_transaction_id = target_circle_transaction_id
    and status = 'provider_accepted'
  returning id into result_id;
  if result_id is null then perform public.reject_business('reward_payout_operation_unknown'); end if;
  return result_id;
end;
$$;

create or replace function public.observe_external_reward_payout_atomic(
  target_intent_id uuid,
  submitted_transaction_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  result_id uuid;
  next_attempt integer;
  replaced_id uuid;
begin
  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
  if not found then perform public.reject_missing('reward_settlement_not_found'); end if;
  select id into result_id from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'payout'
    and transaction_hash = lower(submitted_transaction_hash);
  if found then return result_id; end if;
  if intent_record.status not in ('ready_for_payout', 'payout_submitted') then
    perform public.reject_business('reward_payout_not_ready');
  end if;
  update public.reward_settlement_operations
  set status = 'failed', failure_code = 'superseded_by_external_payout'
  where intent_id = target_intent_id
    and operation_type = 'payout'
    and status in ('submission_uncertain', 'provider_accepted', 'submitted');
  select coalesce(max(attempt_no), 0) + 1,
    (array_agg(id order by attempt_no desc))[1]
  into next_attempt, replaced_id
  from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'payout';
  insert into public.reward_settlement_operations (
    intent_id, operation_type, attempt_no, replaces_operation_id, status, transaction_hash
  ) values (
    target_intent_id, 'payout', next_attempt, replaced_id, 'submitted',
    lower(submitted_transaction_hash)
  ) returning id into result_id;
  update public.reward_settlement_intents set status = 'payout_submitted'
  where id = target_intent_id;
  update public.reports set status = 'payment_pending'
  where id = intent_record.report_id and status = 'reward_approved';
  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  ) values (
    intent_record.report_id, intent_record.actor_id, 'start_payment',
    'reward_approved', 'payment_pending',
    jsonb_build_object(
      'rewardSettlementIntentId', target_intent_id,
      'transactionHash', lower(submitted_transaction_hash),
      'executor', 'permissionless_external'
    )
  );
  return result_id;
end;
$$;

create or replace function public.confirm_reward_payout_atomic(
  target_intent_id uuid,
  submitted_transaction_hash text,
  reward_event_log_index integer,
  usdc_transfer_log_index integer,
  settled_block_number bigint,
  settled_block_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_record public.reward_settlement_intents;
  operation_record public.reward_settlement_operations;
  report_record public.reports;
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

  select * into intent_record from public.reward_settlement_intents
  where id = target_intent_id for update;
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
    then
      perform public.reject_business('reward_payout_confirmation_mismatch');
    end if;
    return intent_record.id;
  end if;
  if intent_record.status <> 'payout_submitted' then
    perform public.reject_business('reward_payout_not_submitted');
  end if;
  select * into operation_record from public.reward_settlement_operations
  where intent_id = target_intent_id and operation_type = 'payout'
    and transaction_hash = lower(submitted_transaction_hash)
    and status = 'submitted'
  for update;
  if not found then perform public.reject_business('reward_payout_hash_unknown'); end if;
  select * into report_record from public.reports
  where id = intent_record.report_id for update;
  if report_record.status <> 'payment_pending'
    or report_record.approved_reward <> intent_record.amount
  then
    perform public.reject_business('invalid_report_transition');
  end if;
  perform 1 from public.programs where id = intent_record.program_id for update;

  update public.reward_settlement_operations
  set status = 'confirmed', event_log_index = reward_event_log_index,
    transfer_log_index = usdc_transfer_log_index, block_number = settled_block_number,
    block_hash = lower(settled_block_hash)
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
  update public.reports set status = 'paid', paid_at = now()
  where id = intent_record.report_id;
  update public.reward_settlement_intents set status = 'paid'
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
    jsonb_build_object('reportId', intent_record.report_id, 'amount', intent_record.amount::text)
  );
  return target_intent_id;
end;
$$;

revoke all on function public.create_reward_settlement_intent_atomic(
  uuid, uuid, numeric, numeric, text, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.observe_reward_approval_submission_atomic(
  uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.confirm_reward_approval_atomic(
  uuid, text, integer, bigint, text
) from public, anon, authenticated;
revoke all on function public.fail_reward_settlement_operation_atomic(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_reward_settlement_intent_atomic(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_reward_payout_relay_atomic(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.accept_reward_payout_relay_atomic(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.attach_reward_payout_hash_atomic(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.observe_external_reward_payout_atomic(uuid, text)
  from public, anon, authenticated;
revoke all on function public.confirm_reward_payout_atomic(
  uuid, text, integer, integer, bigint, text
) from public, anon, authenticated;
grant execute on function public.create_reward_settlement_intent_atomic(
  uuid, uuid, numeric, numeric, text, text, text, uuid
) to service_role;
grant execute on function public.observe_reward_approval_submission_atomic(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.confirm_reward_approval_atomic(
  uuid, text, integer, bigint, text
) to service_role;
grant execute on function public.fail_reward_settlement_operation_atomic(uuid, text, text)
  to service_role;
grant execute on function public.cancel_reward_settlement_intent_atomic(uuid, uuid)
  to service_role;
grant execute on function public.prepare_reward_payout_relay_atomic(uuid, uuid)
  to service_role;
grant execute on function public.accept_reward_payout_relay_atomic(uuid, uuid, text)
  to service_role;
grant execute on function public.attach_reward_payout_hash_atomic(uuid, text, text)
  to service_role;
grant execute on function public.observe_external_reward_payout_atomic(uuid, text)
  to service_role;
grant execute on function public.confirm_reward_payout_atomic(
  uuid, text, integer, integer, bigint, text
) to service_role;

-- Expand/contract deployment compatibility:
-- The previous production image still calls these RPCs. Keep service_role access
-- for exactly one rollback window while the new HTTP API disables its legacy
-- routes and exclusively uses reward-settlement intents. Public browser roles
-- remain denied. Revoke service_role only in a later cleanup release whose
-- previous image no longer depends on these functions.
revoke all on function public.approve_report_reward_atomic(uuid, uuid, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.start_report_payment_atomic(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.confirm_report_payment_atomic(uuid, uuid, bigint, text, integer)
  from public, anon, authenticated;
grant execute on function public.approve_report_reward_atomic(uuid, uuid, numeric, numeric)
  to service_role;
grant execute on function public.start_report_payment_atomic(uuid, uuid, text, text)
  to service_role;
grant execute on function public.confirm_report_payment_atomic(uuid, uuid, bigint, text, integer)
  to service_role;
comment on function public.approve_report_reward_atomic(uuid, uuid, numeric, numeric) is
  'Temporary previous-image rollback compatibility. New API routes must use reward-settlement intents; remove this service_role grant only in a later release.';
comment on function public.start_report_payment_atomic(uuid, uuid, text, text) is
  'Temporary previous-image rollback compatibility. New API routes must use reward-settlement intents; remove this service_role grant only in a later release.';
comment on function public.confirm_report_payment_atomic(uuid, uuid, bigint, text, integer) is
  'Temporary previous-image rollback compatibility. New API routes must use reward-settlement intents; remove this service_role grant only in a later release.';
