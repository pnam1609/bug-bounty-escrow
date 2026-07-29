-- CP-13: verified Circle deployment, durable funding operations, and remaining-funds withdrawal.
-- Browser-provided hashes are evidence only; only the service role may mutate these projections.

alter table public.programs
  drop constraint programs_pool_solvency_check,
  drop column available_pool,
  add column withdrawn_pool numeric(30, 6) not null default 0
    check (withdrawn_pool >= 0),
  add column available_pool numeric(30, 6)
    generated always as (total_pool - reserved_pool - paid_pool - withdrawn_pool) stored,
  add constraint programs_pool_solvency_check
    check (total_pool >= reserved_pool + paid_pool + withdrawn_pool);

alter table public.escrow_contracts
  alter column deployment_transaction_hash drop not null,
  drop constraint escrow_contracts_deployment_status_check,
  drop constraint escrow_contracts_deployment_outcome_check;

alter table public.escrow_contracts
  add column program_key text,
  add column contract_version text,
  add column artifact_checksum text,
  add column runtime_bytecode_checksum text,
  add column immutable_references jsonb,
  add column token_address text,
  add column token_decimals smallint,
  add column owner_wallet text,
  add column withdraw_recipient text,
  add column refund_unlock_at timestamp with time zone,
  add column circle_contract_id text,
  add column circle_transaction_id text,
  add column deployment_wallet_reference text,
  add column deploy_idempotency_key uuid,
  add column deployment_block_number bigint,
  add column deployment_block_hash text,
  add column last_synced_block bigint,
  add column late_funding_scanned_through_block bigint;

alter table public.escrow_contracts
  add constraint escrow_contracts_deployment_status_check
    check (deployment_status in ('accepted', 'pending', 'verifying', 'confirmed', 'reverted', 'failed')),
  add constraint escrow_contracts_deployment_outcome_check check (
    (deployment_status in ('accepted','pending','verifying') and deployed_at is null and failure_code is null)
    or (
      deployment_status = 'confirmed' and contract_address is not null
      and deployment_transaction_hash is not null and deployed_at is not null and failure_code is null
    )
    or (deployment_status in ('reverted','failed') and failure_code is not null)
  ),
  add constraint escrow_contracts_program_key_check
    check (program_key is null or program_key ~ '^0x[0-9a-f]{64}$'),
  add constraint escrow_contracts_artifact_checksum_check
    check (artifact_checksum is null or artifact_checksum ~ '^0x[0-9a-f]{64}$'),
  add constraint escrow_contracts_token_address_check
    check (token_address is null or token_address ~ '^0x[0-9a-f]{40}$'),
  add constraint escrow_contracts_owner_wallet_check
    check (owner_wallet is null or owner_wallet ~ '^0x[0-9a-f]{40}$'),
  add constraint escrow_contracts_withdraw_recipient_check
    check (withdraw_recipient is null or withdraw_recipient ~ '^0x[0-9a-f]{40}$'),
  add constraint escrow_contracts_circle_contract_key unique (circle_contract_id),
  add constraint escrow_contracts_circle_transaction_key unique (circle_transaction_id),
  add constraint escrow_contracts_deploy_idempotency_key unique (deploy_idempotency_key);

create table public.funding_intents (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete restrict,
  escrow_contract_id uuid not null references public.escrow_contracts(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  route_mode text not null check (route_mode in ('send', 'bridge', 'unified_balance')),
  gross_amount_base_units numeric(78, 0) not null check (gross_amount_base_units > 0),
  estimated_fee_reserve_base_units numeric(78, 0) not null check (estimated_fee_reserve_base_units >= 0),
  fee_allocations jsonb not null check (
    jsonb_typeof(fee_allocations) = 'array'
    and jsonb_array_length(fee_allocations) between 1 and 4
  ),
  quote_quoted_at timestamp with time zone,
  quote_expires_at timestamp with time zone,
  sources jsonb not null check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 4),
  destination_chain text not null default 'Arc_Testnet' check (destination_chain = 'Arc_Testnet'),
  destination_address text not null check (destination_address ~ '^0x[0-9a-f]{40}$'),
  pre_balance_base_units numeric(78, 0) not null check (pre_balance_base_units >= 0),
  pre_total_funded_base_units numeric(78, 0) not null check (pre_total_funded_base_units >= 0),
  status text not null default 'ready_to_sign'
    check (status in (
      'ready_to_sign','awaiting_signature','source_submitted','destination_submitted','delivery_pending',
      'verifying_destination','syncing_pool','sync_failed','complete','failed','cancelled'
    )),
  destination_transaction_hash text check (destination_transaction_hash is null or destination_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  transfer_id text,
  net_received_base_units numeric(78, 0) check (net_received_base_units is null or net_received_base_units > 0),
  sync_idempotency_key uuid not null default gen_random_uuid(),
  sync_circle_transaction_id uuid,
  reconcile_lease_id uuid,
  reconcile_lease_expires_at timestamp with time zone,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  expires_at timestamp with time zone not null,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (program_id, idempotency_key),
  unique (sync_idempotency_key),
  unique (sync_circle_transaction_id)
);
alter table public.funding_intents add constraint funding_intents_fee_bound_check
  check (
    estimated_fee_reserve_base_units >= 0
    and gross_amount_base_units + estimated_fee_reserve_base_units
      <= 999999999999999999999999999999
  );
alter table public.funding_intents add constraint funding_intents_net_bound_check
  check (net_received_base_units is null or net_received_base_units <= gross_amount_base_units);
alter table public.funding_intents add constraint funding_intents_reconcile_lease_check
  check (
    (reconcile_lease_id is null and reconcile_lease_expires_at is null)
    or (reconcile_lease_id is not null and reconcile_lease_expires_at is not null)
  );
alter table public.funding_intents add constraint funding_intents_quote_window_check
  check ((quote_quoted_at is null and quote_expires_at is null)
    or (quote_quoted_at is not null and quote_expires_at > quote_quoted_at));

create unique index funding_intents_one_active_per_escrow
  on public.funding_intents (escrow_contract_id)
  where status in (
    'ready_to_sign','awaiting_signature','source_submitted','destination_submitted','delivery_pending',
    'verifying_destination','syncing_pool','sync_failed'
  );

create table public.funding_operations (
  id uuid primary key default gen_random_uuid(),
  funding_intent_id uuid not null references public.funding_intents(id) on delete restrict,
  attempt_no integer not null default 1 check (attempt_no > 0),
  replaces_operation_id uuid references public.funding_operations(id) on delete restrict,
  operation_type text not null check (operation_type in ('deposit','send','bridge','spend','funding_sync')),
  operation_id text,
  source_chain text,
  source_chain_id bigint,
  event_chain_id bigint check (event_chain_id is null or event_chain_id > 0),
  source_address text,
  source_token_address text check (source_token_address is null or source_token_address ~ '^0x[0-9a-f]{40}$'),
  gateway_wallet_address text check (gateway_wallet_address is null or gateway_wallet_address ~ '^0x[0-9a-f]{40}$'),
  requested_amount_base_units numeric(78, 0),
  pre_gateway_balance_base_units numeric(78, 0) check (pre_gateway_balance_base_units is null or pre_gateway_balance_base_units >= 0),
  transaction_hash text check (transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer check (log_index is null or log_index >= 0),
  transfer_log_index integer check (transfer_log_index is null or transfer_log_index >= 0),
  transfer_id text,
  status text not null check (status in ('awaiting_signature','submitted','pending','submission_uncertain','onchain_verified','gateway_finalized','confirmed','failed')),
  provider_state text check (provider_state is null or provider_state in ('pending','success','error')),
  retryable boolean not null default false,
  submission_uncertain boolean not null default false,
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and octet_length(steps::text) <= 32768),
  net_received_base_units numeric(78, 0),
  block_number bigint,
  block_hash text,
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique nulls not distinct (funding_intent_id, operation_type, operation_id)
);
create unique index funding_operations_deposit_attempt_key
  on public.funding_operations (funding_intent_id, source_chain, attempt_no)
  where operation_type = 'deposit';
create unique index funding_operations_one_active_deposit_per_network
  on public.funding_operations (funding_intent_id, source_chain)
  where operation_type = 'deposit' and status not in ('failed','confirmed');
create unique index funding_operations_chain_event_key
  on public.funding_operations (event_chain_id, transaction_hash, log_index) nulls not distinct
  where transaction_hash is not null;

create table public.funding_confirmation_artifacts (
  funding_intent_id uuid primary key references public.funding_intents(id) on delete restrict,
  program_id uuid not null references public.programs(id) on delete restrict,
  escrow_contract_id uuid not null references public.escrow_contracts(id) on delete restrict,
  route_mode text not null check (route_mode in ('send','bridge','unified_balance')),
  escrow_address text not null check (escrow_address ~ '^0x[0-9a-f]{40}$'),
  artifact_version text not null check (artifact_version = '1.1.0'),
  artifact_checksum text not null check (artifact_checksum ~ '^0x[0-9a-f]{64}$'),
  token_address text not null check (token_address = '0x3600000000000000000000000000000000000000'),
  token_decimals smallint not null check (token_decimals = 6),
  destination_transaction_hash text not null check (destination_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  destination_log_index integer not null check (destination_log_index >= 0),
  destination_block_number bigint not null check (destination_block_number >= 0),
  destination_block_hash text not null check (destination_block_hash ~ '^0x[0-9a-f]{64}$'),
  sync_transaction_hash text not null check (sync_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  sync_log_index integer check (sync_log_index is null or sync_log_index >= 0),
  sync_block_number bigint not null check (sync_block_number >= 0),
  sync_block_hash text not null check (sync_block_hash ~ '^0x[0-9a-f]{64}$'),
  gross_amount_base_units numeric(78,0) not null check (gross_amount_base_units > 0),
  estimated_fee_reserve_base_units numeric(78,0) not null check (estimated_fee_reserve_base_units >= 0),
  net_received_base_units numeric(78,0) not null check (net_received_base_units > 0),
  pre_total_funded_base_units numeric(78,0) not null check (pre_total_funded_base_units >= 0),
  required_total_funded_base_units numeric(78,0) not null check (required_total_funded_base_units > 0),
  post_total_funded_base_units numeric(78,0) not null
    check (post_total_funded_base_units >= required_total_funded_base_units),
  total_pool numeric(30,6) not null,
  reserved_pool numeric(30,6) not null,
  paid_pool numeric(30,6) not null,
  withdrawn_pool numeric(30,6) not null,
  available_pool numeric(30,6) not null,
  reconciled_at timestamp with time zone not null default now(),
  check (required_total_funded_base_units = pre_total_funded_base_units + net_received_base_units),
  check (total_pool >= reserved_pool + paid_pool + withdrawn_pool),
  check (available_pool = total_pool - reserved_pool - paid_pool - withdrawn_pool)
);

create table public.circle_gateway_deposit_events (
  notification_id uuid primary key,
  event_id uuid not null unique,
  subscription_id uuid not null,
  source_domain integer not null check (source_domain in (0,3,6,26)),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_units numeric(78,0) not null check (amount_base_units > 0),
  from_address text not null check (from_address ~ '^0x[0-9a-f]{40}$'),
  to_address text not null check (to_address ~ '^0x[0-9a-f]{40}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  event_timestamp timestamp with time zone not null,
  payload_version smallint not null check (payload_version = 2),
  created_at timestamp with time zone not null default now(),
  unique (source_domain, transaction_hash)
);

create table public.withdrawal_intents (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete restrict,
  escrow_contract_id uuid not null references public.escrow_contracts(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  recipient_address text not null check (recipient_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  pre_total_withdrawn_base_units numeric(78, 0) not null check (pre_total_withdrawn_base_units >= 0),
  close_required boolean not null,
  status text not null check (status in (
    'ready_to_close','ready_to_withdraw','close_submission_uncertain','withdraw_submission_uncertain','close_submitted','withdraw_submitted',
    'verifying','complete','failed'
  )),
  close_transaction_hash text check (close_transaction_hash is null or close_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  withdraw_transaction_hash text check (withdraw_transaction_hash is null or withdraw_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  close_log_index integer check (close_log_index is null or close_log_index >= 0),
  close_block_number bigint check (close_block_number is null or close_block_number >= 0),
  close_block_hash text check (close_block_hash is null or close_block_hash ~ '^0x[0-9a-f]{64}$'),
  withdraw_log_index integer check (withdraw_log_index is null or withdraw_log_index >= 0),
  transfer_log_index integer check (transfer_log_index is null or transfer_log_index >= 0),
  withdraw_block_number bigint check (withdraw_block_number is null or withdraw_block_number >= 0),
  withdraw_block_hash text check (withdraw_block_hash is null or withdraw_block_hash ~ '^0x[0-9a-f]{64}$'),
  failure_code text check (failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (program_id, idempotency_key)
);

create unique index withdrawal_intents_one_active_per_escrow
  on public.withdrawal_intents (escrow_contract_id)
  where status <> 'complete' and status <> 'failed';

alter table public.escrow_transactions
  add column funding_intent_id uuid references public.funding_intents(id) on delete restrict,
  add column withdrawal_intent_id uuid references public.withdrawal_intents(id) on delete restrict,
  add column from_address text,
  add column to_address text;

alter table public.escrow_transactions
  drop constraint escrow_transactions_type_check,
  drop constraint escrow_transactions_report_type_check;

alter table public.escrow_transactions
  add constraint escrow_transactions_type_check
    check (transaction_type in (
      'funding','refund','funding_sync','payout','withdraw_remaining'
    )),
  add constraint escrow_transactions_intent_binding_check check (
    (transaction_type = 'payout' and report_id is not null and funding_intent_id is null and withdrawal_intent_id is null)
    or (transaction_type = 'funding' and report_id is null and withdrawal_intent_id is null)
    or (transaction_type = 'refund' and report_id is null and funding_intent_id is null and withdrawal_intent_id is null)
    or (transaction_type = 'funding_sync' and report_id is null and funding_intent_id is not null and withdrawal_intent_id is null)
    or (transaction_type = 'withdraw_remaining' and report_id is null and withdrawal_intent_id is not null and funding_intent_id is null)
  );

create trigger funding_intents_set_updated_at
before update on public.funding_intents
for each row execute function public.set_updated_at();
create trigger funding_operations_set_updated_at
before update on public.funding_operations
for each row execute function public.set_updated_at();
create trigger withdrawal_intents_set_updated_at
before update on public.withdrawal_intents
for each row execute function public.set_updated_at();

alter table public.funding_intents enable row level security;
alter table public.funding_operations enable row level security;
alter table public.funding_confirmation_artifacts enable row level security;
alter table public.circle_gateway_deposit_events enable row level security;
alter table public.withdrawal_intents enable row level security;
revoke all on public.funding_intents, public.funding_operations, public.withdrawal_intents from anon, authenticated;
revoke all on public.funding_confirmation_artifacts from anon, authenticated, service_role;
revoke all on public.circle_gateway_deposit_events from anon, authenticated;
grant select, insert, update on public.funding_intents, public.funding_operations, public.withdrawal_intents to service_role;
grant select on public.funding_confirmation_artifacts to service_role;
grant select, insert on public.circle_gateway_deposit_events to service_role;

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
  perform pg_advisory_xact_lock(hashtextextended(target_program_id::text || ':5042002', 0));
  if not exists (
    select 1 from public.programs where id = target_program_id and owner_id = actor_id
  ) then raise exception using errcode = '42501', detail = 'program_not_accessible'; end if;
  select deadline into program_deadline from public.programs where id = target_program_id;
  if program_deadline is null then
    raise exception using errcode = '23514', detail = 'program_deadline_required_for_escrow';
  end if;
  if target_refund_unlock_at <> program_deadline then
    raise exception using errcode = '22023', detail = 'refund_unlock_must_equal_program_deadline';
  end if;

  select * into deployment_row from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002 for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
       or deployment_row.owner_wallet is distinct from lower(target_owner_wallet)
       or deployment_row.withdraw_recipient is distinct from lower(target_withdraw_recipient)
       or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at
       or deployment_row.artifact_checksum is distinct from lower(target_artifact_checksum)
       or deployment_row.runtime_bytecode_checksum is distinct from lower(target_runtime_checksum)
    then raise exception using errcode = '22023', detail = 'escrow_deployment_parameters_locked'; end if;
    return deployment_row.id;
  end if;

  insert into public.escrow_contracts (
    program_id, chain_id, deployment_status, program_key, contract_version,
    artifact_checksum, runtime_bytecode_checksum, immutable_references,
    token_address, token_decimals, owner_wallet, withdraw_recipient, refund_unlock_at,
    deploy_idempotency_key
  ) values (
    target_program_id, 5042002, 'accepted', lower(target_program_key), '1.1.0',
    lower(target_artifact_checksum), lower(target_runtime_checksum), target_immutable_references,
    '0x3600000000000000000000000000000000000000', 6, lower(target_owner_wallet),
    lower(target_withdraw_recipient), target_refund_unlock_at, target_idempotency_key
  ) returning id into deployment_row.id;
  return deployment_row.id;
end $$;

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
  select * into deployment_row from public.escrow_contracts
  where id = target_deployment_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'escrow_deployment_not_found'; end if;
  select deadline into current_deadline from public.programs
  where id = deployment_row.program_id for update;
  if deployment_row.refund_unlock_at is distinct from current_deadline then
    raise exception using errcode = '22023', detail = 'refund_unlock_no_longer_matches_program_deadline';
  end if;
  if deployment_row.deployment_status = 'confirmed' then
    return deployment_row.contract_address = lower(verified_contract_address)
      and deployment_row.deployment_transaction_hash = lower(verified_transaction_hash)
      and deployment_row.deployment_block_number = verified_block_number
      and deployment_row.deployment_block_hash = lower(verified_block_hash);
  end if;
  if deployment_row.deployment_status not in ('pending','verifying') then
    raise exception using errcode = '22023', detail = 'escrow_deployment_transition_invalid';
  end if;
  update public.escrow_contracts set
    deployment_status = 'confirmed', contract_address = lower(verified_contract_address),
    deployment_transaction_hash = lower(verified_transaction_hash),
    deployment_block_number = verified_block_number,
    deployment_block_hash = lower(verified_block_hash),
    deployment_wallet_reference = lower(verified_deployment_wallet_reference),
    deployed_at = now(), failure_code = null
  where id = target_deployment_id;
  return true;
end $$;

create or replace function public.create_funding_intent_atomic(
  actor_id uuid,
  target_program_id uuid,
  request_idempotency_key uuid,
  source_wallet text,
  gross_base_units numeric,
  fee_reserve_base_units numeric,
  requested_fee_allocations jsonb,
  requested_sources jsonb,
  escrow_pre_balance_base_units numeric,
  escrow_pre_total_funded_base_units numeric,
  intent_expires_at timestamp with time zone,
  initial_quote_quoted_at timestamp with time zone,
  initial_quote_expires_at timestamp with time zone
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  escrow_row public.escrow_contracts%rowtype;
  existing_row public.funding_intents%rowtype;
  existing_id uuid;
  source_count integer;
  unique_count integer;
  allocation_total numeric;
  fee_allocation_total numeric;
  fee_count integer;
  fee_unique_count integer;
  derived_route text;
begin
  if not exists (
    select 1 from public.programs p
    where p.id = target_program_id and p.owner_id = actor_id and p.status in ('draft','awaiting_funding')
  ) then raise exception using errcode = '42501', detail = 'program_not_accessible'; end if;

  select * into escrow_row from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002 and deployment_status = 'confirmed';
  if not found or escrow_row.contract_address is null then
    raise exception using errcode = '22023', detail = 'program_escrow_not_deployed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(escrow_row.id::text || ':funding', 0));
  update public.funding_intents set status = 'cancelled', updated_at = now()
  where escrow_contract_id = escrow_row.id
    and status in ('ready_to_sign','awaiting_signature')
    and destination_transaction_hash is null and expires_at <= now()
    and not exists (
      select 1 from public.funding_operations operation
      where operation.funding_intent_id = funding_intents.id
    );

  if jsonb_typeof(requested_sources) <> 'array'
     or jsonb_typeof(requested_fee_allocations) <> 'array' then
    raise exception using errcode = '22023', detail = 'funding_sources_invalid';
  end if;
  if gross_base_units <= 0 or gross_base_units > 999999999999999999999999999999
     or fee_reserve_base_units < 0
     or gross_base_units + fee_reserve_base_units > 999999999999999999999999999999 then
    raise exception using errcode = '22023', detail = 'funding_amount_invalid';
  end if;
  select count(*), count(distinct value->>'network'),
         coalesce(sum((value->>'amountBaseUnits')::numeric), 0)
    into source_count, unique_count, allocation_total
  from jsonb_array_elements(requested_sources);
  select count(*), count(distinct value->>'network'),
         coalesce(sum((value->>'amountBaseUnits')::numeric), 0)
    into fee_count, fee_unique_count, fee_allocation_total
  from jsonb_array_elements(requested_fee_allocations);
  if source_count < 1 or source_count > 4 or unique_count <> source_count
     or allocation_total <> gross_base_units
     or fee_count <> source_count or fee_unique_count <> fee_count
     or fee_allocation_total <> fee_reserve_base_units
     or exists (
       select 1 from jsonb_array_elements(requested_fee_allocations) fee
       where fee->>'network' not in (
         select source->>'network' from jsonb_array_elements(requested_sources) source
       ) or (fee->>'amountBaseUnits')::numeric < 0
     )
     or exists (
       select 1 from jsonb_array_elements(requested_sources) s
       where s->>'network' not in ('Arc_Testnet','Ethereum_Sepolia','Arbitrum_Sepolia','Base_Sepolia')
          or (s->>'amountBaseUnits')::numeric <= 0
     ) then raise exception using errcode = '22023', detail = 'funding_sources_invalid'; end if;

  derived_route := case
    when source_count >= 2 then 'unified_balance'
    when requested_sources->0->>'network' = 'Arc_Testnet' then 'send'
    else 'bridge'
  end;

  if initial_quote_quoted_at is null or initial_quote_expires_at is null then
    raise exception using errcode = '22023', detail = 'funding_quote_required';
  end if;
  if (
       initial_quote_quoted_at < now() - interval '5 minutes'
       or initial_quote_quoted_at > now() + interval '1 minute'
       or initial_quote_expires_at <= now()
       or initial_quote_expires_at > now() + interval '30 minutes'
       or initial_quote_expires_at <= initial_quote_quoted_at
     ) then raise exception using errcode = '22023', detail = 'funding_quote_invalid'; end if;

  select * into existing_row from public.funding_intents
  where program_id = target_program_id and idempotency_key = request_idempotency_key
  for update;
  if found then
    if existing_row.wallet_address <> lower(source_wallet)
       or existing_row.gross_amount_base_units <> gross_base_units
       or existing_row.estimated_fee_reserve_base_units <> fee_reserve_base_units
       or existing_row.fee_allocations <> requested_fee_allocations
       or existing_row.sources <> requested_sources
       or existing_row.route_mode <> derived_route
       or existing_row.quote_quoted_at is distinct from initial_quote_quoted_at
       or existing_row.quote_expires_at is distinct from initial_quote_expires_at
    then raise exception using errcode = '22023', detail = 'funding_idempotency_payload_mismatch'; end if;
    return existing_row.id;
  end if;

  insert into public.funding_intents (
    program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
    route_mode, gross_amount_base_units, estimated_fee_reserve_base_units, fee_allocations, sources,
    destination_address, pre_balance_base_units, pre_total_funded_base_units, expires_at,
    quote_quoted_at, quote_expires_at
  ) values (
    target_program_id, escrow_row.id, actor_id, request_idempotency_key, lower(source_wallet),
    derived_route, gross_base_units, fee_reserve_base_units, requested_fee_allocations, requested_sources,
    escrow_row.contract_address, escrow_pre_balance_base_units,
    escrow_pre_total_funded_base_units, intent_expires_at,
    initial_quote_quoted_at, initial_quote_expires_at
  ) returning id into existing_id;
  return existing_id;
end $$;

create or replace function public.refresh_funding_quote_atomic(
  actor_id uuid, target_program_id uuid, target_intent_id uuid,
  refreshed_fee_reserve_base_units numeric,
  refreshed_fee_allocations jsonb,
  refreshed_quoted_at timestamp with time zone,
  refreshed_expires_at timestamp with time zone
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  if not exists (select 1 from public.programs where id = target_program_id and owner_id = actor_id) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row from public.funding_intents
  where id = target_intent_id and program_id = target_program_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  if intent_row.status not in ('ready_to_sign','awaiting_signature','source_submitted')
     or intent_row.destination_transaction_hash is not null
     or exists (
       select 1 from public.funding_operations
       where funding_intent_id = target_intent_id
         and operation_type in ('send','bridge','spend')
         and status <> 'failed'
     )
  then raise exception using errcode = '22023', detail = 'funding_quote_refresh_not_allowed'; end if;
  if refreshed_fee_reserve_base_units < 0
     or refreshed_fee_reserve_base_units + intent_row.gross_amount_base_units
       > 999999999999999999999999999999
     or refreshed_quoted_at < now() - interval '5 minutes'
     or refreshed_quoted_at > now() + interval '1 minute'
     or refreshed_expires_at <= now()
     or refreshed_expires_at > now() + interval '30 minutes'
     or refreshed_expires_at <= refreshed_quoted_at
  then raise exception using errcode = '22023', detail = 'funding_quote_invalid'; end if;
  if jsonb_typeof(refreshed_fee_allocations) <> 'array'
     or jsonb_array_length(refreshed_fee_allocations) <> jsonb_array_length(intent_row.sources)
     or (
       select count(distinct fee->>'network')
       from jsonb_array_elements(refreshed_fee_allocations) fee
     ) <> jsonb_array_length(refreshed_fee_allocations)
     or exists (
       select 1 from jsonb_array_elements(refreshed_fee_allocations) fee
       where fee->>'network' not in (
         select source->>'network' from jsonb_array_elements(intent_row.sources) source
       ) or (fee->>'amountBaseUnits')::numeric < 0
     )
     or (
       select coalesce(sum((fee->>'amountBaseUnits')::numeric), 0)
       from jsonb_array_elements(refreshed_fee_allocations) fee
     ) <> refreshed_fee_reserve_base_units
  then raise exception using errcode = '22023', detail = 'funding_fee_allocations_invalid'; end if;
  update public.funding_intents set
    estimated_fee_reserve_base_units = refreshed_fee_reserve_base_units,
    fee_allocations = refreshed_fee_allocations,
    quote_quoted_at = refreshed_quoted_at, quote_expires_at = refreshed_expires_at,
    updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.create_source_deposit_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  source_network text,
  locked_chain_id bigint,
  locked_token_address text,
  locked_gateway_wallet_address text,
  locked_wallet_address text,
  locked_amount_base_units numeric,
  gateway_pre_balance_base_units numeric
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  existing_row public.funding_operations%rowtype;
  expected_chain_id bigint;
  expected_token text;
  allocated_amount numeric;
  required_confirmed_balance numeric;
  expected_deposit_amount numeric;
  created_id uuid;
  next_attempt integer := 1;
  replaced_id uuid;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_intent_id::text || ':deposit:' || source_network, 0));
  if not exists (select 1 from public.programs where id = target_program_id and owner_id = actor_id) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row from public.funding_intents
  where id = target_intent_id and program_id = target_program_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  if intent_row.route_mode <> 'unified_balance' then
    raise exception using errcode = '22023', detail = 'source_deposit_requires_unified_balance';
  end if;
  if intent_row.status in ('complete','failed','cancelled')
     or (intent_row.expires_at <= now() and not exists (
       select 1 from public.funding_operations
       where funding_intent_id = target_intent_id
     )) then
    raise exception using errcode = '22023', detail = 'funding_intent_not_active';
  end if;
  expected_chain_id := case source_network
    when 'Arc_Testnet' then 5042002 when 'Ethereum_Sepolia' then 11155111
    when 'Arbitrum_Sepolia' then 421614 when 'Base_Sepolia' then 84532 else null end;
  expected_token := case source_network
    when 'Arc_Testnet' then '0x3600000000000000000000000000000000000000'
    when 'Ethereum_Sepolia' then '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'
    when 'Arbitrum_Sepolia' then '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
    when 'Base_Sepolia' then '0x036cbd53842c5426634e7929541ec2318f3dcf7e' else null end;
  select (source->>'amountBaseUnits')::numeric into allocated_amount
  from jsonb_array_elements(intent_row.sources) source
  where source->>'network' = source_network;
  required_confirmed_balance := coalesce(allocated_amount, 0)
    + coalesce((
      select (fee->>'amountBaseUnits')::numeric
      from jsonb_array_elements(intent_row.fee_allocations) fee
      where fee->>'network' = source_network
    ), 0);
  expected_deposit_amount := required_confirmed_balance - gateway_pre_balance_base_units;
  if expected_chain_id is null or locked_chain_id <> expected_chain_id
     or lower(locked_token_address) <> expected_token
     or lower(locked_gateway_wallet_address) <> '0x0077777d7eba4688bdef3e311b846f25870a19b9'
     or lower(locked_wallet_address) <> intent_row.wallet_address
     or allocated_amount is null
     or gateway_pre_balance_base_units < 0
     or expected_deposit_amount <= 0
     or locked_amount_base_units <> expected_deposit_amount
  then raise exception using errcode = '22023', detail = 'source_deposit_parameters_mismatch'; end if;

  select * into existing_row from public.funding_operations
  where funding_intent_id = target_intent_id and operation_type = 'deposit'
    and source_chain = source_network and status not in ('failed','confirmed') for update;
  if found then
    if existing_row.source_chain_id <> locked_chain_id
       or existing_row.source_token_address <> lower(locked_token_address)
       or existing_row.gateway_wallet_address <> lower(locked_gateway_wallet_address)
       or existing_row.source_address <> lower(locked_wallet_address)
       or existing_row.requested_amount_base_units <> locked_amount_base_units
       or existing_row.pre_gateway_balance_base_units <> gateway_pre_balance_base_units
    then raise exception using errcode = '22023', detail = 'source_deposit_parameters_locked'; end if;
    return existing_row.id;
  end if;

  select * into existing_row from public.funding_operations
  where funding_intent_id = target_intent_id and operation_type = 'deposit'
    and source_chain = source_network order by attempt_no desc limit 1 for update;
  if found then
    if existing_row.status = 'failed' then
      if existing_row.failure_code <> 'server.source_deposit_reverted' then
        raise exception using errcode = '23514', detail = 'source_deposit_replacement_not_allowed';
      end if;
      replaced_id := existing_row.id;
    elsif existing_row.status <> 'confirmed' then
      raise exception using errcode = '23514', detail = 'source_deposit_attempt_not_terminal';
    end if;
    next_attempt := existing_row.attempt_no + 1;
  end if;

  insert into public.funding_operations (
    funding_intent_id, attempt_no, replaces_operation_id, operation_type, operation_id, source_chain, source_chain_id,
    event_chain_id,
    source_address, source_token_address, gateway_wallet_address,
    requested_amount_base_units, pre_gateway_balance_base_units, status
  ) values (
    target_intent_id, next_attempt, replaced_id, 'deposit', source_network || ':attempt:' || next_attempt, source_network, locked_chain_id,
    locked_chain_id,
    lower(locked_wallet_address), lower(locked_token_address), lower(locked_gateway_wallet_address),
    locked_amount_base_units, gateway_pre_balance_base_units, 'awaiting_signature'
  ) returning id into created_id;
  return created_id;
end $$;

create or replace function public.observe_source_deposit_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_deposit_id uuid,
  observed_outcome text,
  observed_transaction_hash text,
  observed_failure_code text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare operation_row public.funding_operations%rowtype;
begin
  if not exists (select 1 from public.programs where id = target_program_id and owner_id = actor_id) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select operation.* into operation_row from public.funding_operations operation
  join public.funding_intents intent on intent.id = operation.funding_intent_id
  where operation.id = target_deposit_id and operation.funding_intent_id = target_intent_id
    and intent.program_id = target_program_id and operation.operation_type = 'deposit' for update;
  if not found then raise exception using errcode = 'P0002', detail = 'source_deposit_not_found'; end if;
  if operation_row.status = 'confirmed' then return false; end if;
  if operation_row.status in ('onchain_verified','gateway_finalized') then return false; end if;
  if operation_row.status = 'failed' then
    raise exception using errcode = '22023', detail = 'source_deposit_attempt_terminal';
  end if;
  if observed_outcome not in ('submitted','submission_uncertain')
     or (observed_outcome = 'submitted' and observed_transaction_hash is null)
  then raise exception using errcode = '22023', detail = 'source_deposit_observation_invalid'; end if;
  if observed_transaction_hash is not null and lower(observed_transaction_hash) !~ '^0x[0-9a-f]{64}$' then
    raise exception using errcode = '22023', detail = 'source_deposit_hash_invalid';
  end if;
  if operation_row.transaction_hash is not null and observed_transaction_hash is not null
     and operation_row.transaction_hash <> lower(observed_transaction_hash) then
    raise exception using errcode = '22023', detail = 'source_deposit_hash_locked';
  end if;
  if operation_row.status = 'submitted' and observed_outcome = 'submission_uncertain' then
    raise exception using errcode = '22023', detail = 'source_deposit_state_regression';
  end if;
  update public.funding_operations set
    transaction_hash = coalesce(transaction_hash, lower(observed_transaction_hash)),
    status = observed_outcome,
    submission_uncertain = observed_outcome = 'submission_uncertain',
    failure_code = null,
    updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.fail_source_deposit_reverted_atomic(
  target_deposit_id uuid, verified_transaction_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare operation_row public.funding_operations%rowtype;
begin
  select * into operation_row from public.funding_operations
  where id = target_deposit_id and operation_type = 'deposit' for update;
  if not found then raise exception using errcode = 'P0002', detail = 'source_deposit_not_found'; end if;
  if operation_row.status = 'confirmed' then return false; end if;
  if operation_row.transaction_hash is distinct from lower(verified_transaction_hash) then
    raise exception using errcode = '22023', detail = 'source_deposit_hash_mismatch';
  end if;
  update public.funding_operations set status = 'failed', submission_uncertain = false,
    failure_code = 'server.source_deposit_reverted', updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.ingest_circle_gateway_deposit_finalized_atomic(
  notification_id uuid, event_id uuid, subscription_id uuid, source_domain integer,
  wallet_address text, token_address text, amount_base_units numeric,
  from_address text, to_address text, transaction_hash text,
  event_timestamp timestamp with time zone, payload_version smallint
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  expected_token text;
  inserted_id uuid;
  existing_event public.circle_gateway_deposit_events%rowtype;
begin
  expected_token := case $4
    when 0 then '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'
    when 3 then '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
    when 6 then '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
    when 26 then '0x3600000000000000000000000000000000000000' else null end;
  if expected_token is null or lower($6) <> expected_token
     or lower($5) <> lower($8)
     or lower($9) <> '0x0077777d7eba4688bdef3e311b846f25870a19b9'
     or $7 <= 0 or $12 <> 2 then
    raise exception using errcode = '22023', detail = 'gateway_deposit_finalized_payload_invalid';
  end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended($4::text || ':' || lower($10), 0));
  select * into existing_event from public.circle_gateway_deposit_events
  where circle_gateway_deposit_events.notification_id = $1
     or (circle_gateway_deposit_events.source_domain = $4
       and circle_gateway_deposit_events.transaction_hash = lower($10))
  limit 1 for update;
  if found then
    if existing_event.source_domain <> $4
       or existing_event.wallet_address <> lower($5)
       or existing_event.token_address <> lower($6)
       or existing_event.amount_base_units <> $7
       or existing_event.from_address <> lower($8)
       or existing_event.to_address <> lower($9)
       or existing_event.transaction_hash <> lower($10)
       or existing_event.payload_version <> $12 then
      raise exception using errcode = '22023', detail = 'gateway_deposit_finalized_replay_mismatch';
    end if;
    return false;
  end if;
  insert into public.circle_gateway_deposit_events (
    notification_id,event_id,subscription_id,source_domain,wallet_address,token_address,
    amount_base_units,from_address,to_address,transaction_hash,event_timestamp,payload_version
  ) values (
    $1,$2,$3,$4,lower($5),lower($6),
    $7,lower($8),lower($9),lower($10),$11,$12
  ) returning circle_gateway_deposit_events.notification_id into inserted_id;
  if inserted_id is not null then
    update public.funding_operations operation set status = 'gateway_finalized', updated_at = now()
    where operation.operation_type = 'deposit' and operation.status <> 'confirmed'
      and operation.source_chain_id = case $4
        when 0 then 11155111 when 3 then 421614 when 6 then 84532 when 26 then 5042002 end
      and operation.transaction_hash = lower($10)
      and operation.source_address = lower($5)
      and operation.source_token_address = lower($6)
      and operation.requested_amount_base_units = $7;
  end if;
  return inserted_id is not null;
end $$;

create or replace function public.record_source_deposit_onchain_verified_atomic(
  target_deposit_id uuid, verified_transaction_hash text,
  verified_gateway_log_index integer, verified_transfer_log_index integer,
  verified_block_number bigint, verified_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare operation_row public.funding_operations%rowtype;
begin
  select * into operation_row from public.funding_operations
  where id = target_deposit_id and operation_type = 'deposit' for update;
  if not found then raise exception using errcode = 'P0002', detail = 'source_deposit_not_found'; end if;
  if operation_row.transaction_hash is distinct from lower(verified_transaction_hash) then
    raise exception using errcode = '22023', detail = 'source_deposit_hash_mismatch';
  end if;
  if operation_row.log_index is not null then
    if operation_row.log_index <> verified_gateway_log_index
       or operation_row.transfer_log_index <> verified_transfer_log_index
       or operation_row.block_number <> verified_block_number
       or operation_row.block_hash <> lower(verified_block_hash)
    then raise exception using errcode = '22023', detail = 'source_deposit_evidence_locked'; end if;
    return false;
  end if;
  update public.funding_operations set
    status = case when status = 'gateway_finalized' then status else 'onchain_verified' end,
    log_index = verified_gateway_log_index, transfer_log_index = verified_transfer_log_index,
    block_number = verified_block_number, block_hash = lower(verified_block_hash),
    updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.confirm_source_deposit_atomic(
  target_deposit_id uuid,
  verified_transaction_hash text,
  verified_log_index integer,
  verified_block_number bigint,
  verified_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare operation_row public.funding_operations%rowtype; expected_domain integer;
begin
  select * into operation_row from public.funding_operations
  where id = target_deposit_id and operation_type = 'deposit' for update;
  if not found then raise exception using errcode = 'P0002', detail = 'source_deposit_not_found'; end if;
  if operation_row.status = 'confirmed' then
    return operation_row.transaction_hash = lower(verified_transaction_hash)
      and operation_row.log_index = verified_log_index;
  end if;
  if operation_row.transaction_hash is distinct from lower(verified_transaction_hash) then
    raise exception using errcode = '22023', detail = 'source_deposit_hash_mismatch';
  end if;
  if operation_row.log_index is distinct from verified_log_index
     or operation_row.transfer_log_index is null
     or operation_row.block_number is distinct from verified_block_number
     or operation_row.block_hash is distinct from lower(verified_block_hash) then
    raise exception using errcode = '22023', detail = 'source_deposit_onchain_not_verified';
  end if;
  expected_domain := case operation_row.source_chain
    when 'Ethereum_Sepolia' then 0 when 'Arbitrum_Sepolia' then 3
    when 'Base_Sepolia' then 6 when 'Arc_Testnet' then 26 else null end;
  if not exists (
    select 1 from public.circle_gateway_deposit_events event
    where event.source_domain = expected_domain
      and event.transaction_hash = lower(verified_transaction_hash)
      and event.wallet_address = operation_row.source_address
      and event.token_address = operation_row.source_token_address
      and event.amount_base_units = operation_row.requested_amount_base_units
      and event.from_address = operation_row.source_address
      and event.to_address = operation_row.gateway_wallet_address
  ) then return false; end if;
  update public.funding_operations set status = 'confirmed', submission_uncertain = false,
    failure_code = null, updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.claim_funding_reconciliation_atomic(
  target_intent_id uuid,
  requested_lease_id uuid,
  requested_lease_expires_at timestamp with time zone
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  select * into intent_row from public.funding_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  if intent_row.status = 'complete' then return false; end if;
  if intent_row.status in ('failed','cancelled') then return false; end if;
  if intent_row.expires_at <= now() and intent_row.destination_transaction_hash is null then
    update public.funding_intents set status = 'cancelled', updated_at = now()
    where id = target_intent_id;
    return false;
  end if;
  if requested_lease_expires_at is null
     or requested_lease_expires_at <= now()
     or requested_lease_expires_at > now() + interval '15 minutes' then
    raise exception using errcode = '22023', detail = 'funding_reconciliation_lease_invalid';
  end if;
  if intent_row.reconcile_lease_id is not null
     and intent_row.reconcile_lease_expires_at > now()
     and intent_row.reconcile_lease_id <> requested_lease_id then
    return false;
  end if;
  update public.funding_intents set
    status = 'verifying_destination',
    reconcile_lease_id = requested_lease_id,
    reconcile_lease_expires_at = requested_lease_expires_at,
    failure_code = null,
    updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.store_funding_sync_transaction_atomic(
  target_intent_id uuid,
  requested_lease_id uuid,
  circle_transaction_id uuid
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  prior_operation public.funding_operations%rowtype;
  next_attempt integer := 1;
begin
  select * into intent_row from public.funding_intents
  where id = target_intent_id for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.reconcile_lease_id is distinct from requested_lease_id
     or intent_row.reconcile_lease_expires_at <= now()
     or intent_row.status <> 'syncing_pool'
  then
    raise exception using errcode = '42501', detail = 'funding_reconciliation_lease_invalid';
  end if;
  if intent_row.sync_circle_transaction_id is not null then
    return intent_row.sync_circle_transaction_id = circle_transaction_id;
  end if;

  select * into prior_operation from public.funding_operations
  where funding_intent_id = target_intent_id and operation_type = 'funding_sync'
  order by attempt_no desc, created_at desc limit 1;
  if found then
    if prior_operation.status <> 'failed' then
      raise exception using errcode = '23514', detail = 'funding_sync_attempt_not_terminal';
    end if;
    next_attempt := prior_operation.attempt_no + 1;
  end if;

  insert into public.funding_operations (
    funding_intent_id, attempt_no, replaces_operation_id, operation_type,
    operation_id, event_chain_id, status, provider_state
  ) values (
    target_intent_id, next_attempt,
    case when prior_operation.id is null then null else prior_operation.id end,
    'funding_sync', 'circle:' || circle_transaction_id::text, 5042002,
    'pending', 'pending'
  );
  update public.funding_intents set
    sync_circle_transaction_id = circle_transaction_id,
    failure_code = null,
    updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.fail_funding_sync_atomic(
  target_intent_id uuid,
  requested_lease_id uuid,
  verified_circle_transaction_id uuid,
  verified_failure_code text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  select * into intent_row from public.funding_intents
  where id = target_intent_id for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.reconcile_lease_id is distinct from requested_lease_id
     or intent_row.reconcile_lease_expires_at <= now()
     or intent_row.sync_circle_transaction_id is distinct from verified_circle_transaction_id
  then return false; end if;
  if verified_failure_code is null
     or verified_failure_code !~ '^[a-z][a-z0-9._-]{0,127}$'
  then
    raise exception using errcode = '22023', detail = 'funding_sync_failure_code_invalid';
  end if;

  update public.funding_operations set
    status = 'failed', provider_state = 'error', retryable = true,
    failure_code = verified_failure_code, updated_at = now()
  where funding_intent_id = target_intent_id
    and operation_type = 'funding_sync'
    and operation_id = 'circle:' || verified_circle_transaction_id::text
    and status = 'pending';
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_sync_operation_not_found';
  end if;

  update public.funding_intents set
    status = 'sync_failed',
    sync_circle_transaction_id = null,
    sync_idempotency_key = gen_random_uuid(),
    failure_code = verified_failure_code,
    reconcile_lease_id = null,
    reconcile_lease_expires_at = null,
    updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.observe_funding_operation_atomic(
  target_intent_id uuid,
  observed_operation_id text,
  observed_destination_hash text,
  observed_transfer_id text,
  observed_source_hashes jsonb,
  observed_provider_state text,
  observed_retryable boolean,
  observed_submission_uncertain boolean,
  observed_steps jsonb
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  latest_operation public.funding_operations%rowtype;
  replacement_operation public.funding_operations%rowtype;
  operation_kind text;
  durable_operation_id text;
  telemetry_steps jsonb;
  next_attempt integer := 1;
  replacement_id uuid;
begin
  select * into intent_row from public.funding_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  if intent_row.status in ('complete','failed','cancelled') then return false; end if;
  if intent_row.reconcile_lease_id is not null
     and intent_row.reconcile_lease_expires_at > now() then return false; end if;
  if intent_row.expires_at <= now() and intent_row.destination_transaction_hash is null
     and observed_destination_hash is null
     and not exists (select 1 from public.funding_operations where funding_intent_id = target_intent_id) then
    update public.funding_intents set status = 'cancelled', updated_at = now()
    where id = target_intent_id;
    return false;
  end if;
  if observed_destination_hash is not null
     and intent_row.destination_transaction_hash is not null
     and intent_row.destination_transaction_hash <> lower(observed_destination_hash) then
    raise exception using errcode = '22023', detail = 'funding_destination_mismatch';
  end if;
  if observed_transfer_id is not null
     and intent_row.transfer_id is not null
     and intent_row.transfer_id <> observed_transfer_id then
    raise exception using errcode = '22023', detail = 'funding_transfer_id_mismatch';
  end if;
  if jsonb_typeof(coalesce(observed_source_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_steps, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', detail = 'funding_operation_telemetry_invalid';
  end if;

  -- A quote is advisory until the wallet boundary, but it must be fresh at that
  -- boundary. Unified Balance also requires every locked source deposit to have
  -- both independently verified receipt evidence and a finalized Gateway event.
  if intent_row.destination_transaction_hash is null
     and not exists (
       select 1 from public.funding_operations
       where funding_intent_id = target_intent_id
         and operation_type in ('send','bridge','spend') and status <> 'failed'
     ) then
    if intent_row.quote_expires_at is null or intent_row.quote_expires_at <= now() then
      raise exception using errcode = '22023', detail = 'funding_quote_expired';
    end if;
  end if;

  operation_kind := case intent_row.route_mode
    when 'send' then 'send'
    when 'bridge' then 'bridge'
    else 'spend'
  end;
  durable_operation_id := 'client:' || coalesce(
    nullif(observed_operation_id, ''),
    nullif(observed_transfer_id, ''),
    lower(observed_destination_hash),
    'recovery'
  );
  telemetry_steps := coalesce(observed_steps, '[]'::jsonb) ||
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', 'source_transaction',
        'state', 'success',
        'transactionHash', value
      ))
      from jsonb_array_elements_text(coalesce(observed_source_hashes, '[]'::jsonb))
    ), '[]'::jsonb);

  if observed_destination_hash is not null and exists (
    select 1 from public.funding_operations
    where funding_intent_id = target_intent_id
      and operation_type = operation_kind
      and transaction_hash = lower(observed_destination_hash)
      and status = 'failed' and failure_code = 'server.funding_destination_reverted'
  ) then raise exception using errcode = '22023', detail = 'funding_destination_reverted_hash_reused'; end if;

  select * into latest_operation from public.funding_operations
  where funding_intent_id = target_intent_id and operation_type = operation_kind
  order by attempt_no desc, created_at desc limit 1;
  if found then
    next_attempt := latest_operation.attempt_no + 1;
  end if;
  if observed_destination_hash is not null then
    select * into replacement_operation from public.funding_operations
    where funding_intent_id = target_intent_id and operation_type = operation_kind
      and status = 'failed' and failure_code = 'server.funding_destination_reverted'
    order by attempt_no desc, created_at desc limit 1;
    if found then
      replacement_id := replacement_operation.id;
      if intent_row.route_mode <> 'send'
         and not (
           (observed_transfer_id is not null and replacement_operation.transfer_id = observed_transfer_id)
           or (observed_operation_id is not null
               and replacement_operation.operation_id = 'client:' || observed_operation_id)
         ) then
        raise exception using errcode = '22023', detail = 'funding_destination_manual_recovery_required';
      end if;
    end if;
    if replacement_id is not null then
      durable_operation_id := durable_operation_id || ':attempt:' || next_attempt;
    end if;
  end if;

  insert into public.funding_operations (
    funding_intent_id, attempt_no, replaces_operation_id, operation_type, operation_id, event_chain_id,
    transaction_hash, transfer_id,
    status, provider_state, retryable, submission_uncertain, steps
  ) values (
    intent_row.id, next_attempt, replacement_id, operation_kind, durable_operation_id, 5042002,
    lower(observed_destination_hash),
    observed_transfer_id, 'pending', observed_provider_state,
    coalesce(observed_retryable, false), coalesce(observed_submission_uncertain, false), telemetry_steps
  )
  on conflict (funding_intent_id, operation_type, operation_id) do update set
    transaction_hash = coalesce(public.funding_operations.transaction_hash, excluded.transaction_hash),
    transfer_id = coalesce(public.funding_operations.transfer_id, excluded.transfer_id),
    provider_state = coalesce(excluded.provider_state, public.funding_operations.provider_state),
    retryable = excluded.retryable,
    submission_uncertain = excluded.submission_uncertain,
    steps = case when jsonb_array_length(excluded.steps) > 0 then excluded.steps else public.funding_operations.steps end,
    updated_at = now();

  update public.funding_intents set
    destination_transaction_hash = coalesce(destination_transaction_hash, lower(observed_destination_hash)),
    transfer_id = coalesce(transfer_id, observed_transfer_id),
    status = case
      when observed_destination_hash is not null
       and status in ('ready_to_sign','awaiting_signature','source_submitted','destination_submitted')
      then 'delivery_pending'
      when intent_row.route_mode = 'bridge'
       and status in ('ready_to_sign','awaiting_signature')
       and exists (
         select 1
         from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) as step
         where lower(coalesce(step->>'name', '')) = 'burn'
           and step->>'state' in ('pending', 'success')
           and step->>'transactionHash' is not null
       )
      then 'source_submitted'
      when coalesce(observed_submission_uncertain, false)
       and status in ('ready_to_sign','awaiting_signature')
      then 'source_submitted'
      else status
    end,
    updated_at = now()
  where id = intent_row.id;
  return true;
end $$;

create or replace function public.fail_funding_destination_reverted_atomic(
  target_intent_id uuid,
  verified_transaction_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0));
  select * into intent_row from public.funding_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  if lower(verified_transaction_hash) !~ '^0x[0-9a-f]{64}$'
     or intent_row.destination_transaction_hash is distinct from lower(verified_transaction_hash) then
    raise exception using errcode = '22023', detail = 'funding_destination_mismatch';
  end if;
  select * into operation_row from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type in ('send','bridge','spend')
    and transaction_hash = lower(verified_transaction_hash)
  order by created_at desc limit 1 for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_destination_operation_not_found'; end if;
  if operation_row.status = 'failed'
     and operation_row.failure_code = 'server.funding_destination_reverted' then return false; end if;

  update public.funding_operations set
    status = 'failed', provider_state = 'error', retryable = intent_row.route_mode = 'send',
    submission_uncertain = false, failure_code = 'server.funding_destination_reverted',
    steps = steps || jsonb_build_array(jsonb_build_object(
      'name', 'Destination', 'state', 'error',
      'transactionHash', lower(verified_transaction_hash),
      'errorCode', 'server.funding_destination_reverted'
    )),
    updated_at = now()
  where id = operation_row.id;

  update public.funding_intents set
    destination_transaction_hash = null, transfer_id = null,
    status = case when route_mode = 'send' then 'ready_to_sign' else 'source_submitted' end,
    failure_code = null, reconcile_lease_id = null, reconcile_lease_expires_at = null,
    updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.reconcile_funding_intent_atomic(
  target_intent_id uuid,
  requested_lease_id uuid,
  destination_hash text,
  destination_log_index integer,
  destination_block_number bigint,
  destination_block_hash text,
  sync_hash text,
  sync_log_index integer,
  verified_net_base_units numeric,
  verified_post_total_funded_base_units numeric,
  sync_block_number bigint,
  sync_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  escrow_row public.escrow_contracts%rowtype;
  inserted_id uuid;
  amount_usdc numeric(30,6);
  precredited_row public.escrow_transactions%rowtype;
  destination_precredited boolean := false;
begin
  select * into intent_row from public.funding_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'funding_intent_not_found'; end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    intent_row.escrow_contract_id::text || ':destination-attribution', 0
  ));
  if intent_row.status = 'complete' then return false; end if;
  if intent_row.reconcile_lease_id is distinct from requested_lease_id
     or intent_row.reconcile_lease_expires_at <= now() then
    raise exception using errcode = '42501', detail = 'funding_reconciliation_lease_invalid';
  end if;
  if intent_row.destination_transaction_hash is distinct from lower(destination_hash) then
    raise exception using errcode = '22023', detail = 'funding_destination_mismatch';
  end if;
  if verified_net_base_units <= 0 or verified_net_base_units > intent_row.gross_amount_base_units then
    raise exception using errcode = '22023', detail = 'funding_verified_amount_invalid';
  end if;
  if verified_post_total_funded_base_units
     < intent_row.pre_total_funded_base_units + verified_net_base_units
  then
    raise exception using errcode = '22023', detail = 'funding_total_funded_threshold_invalid';
  end if;
  if (
    select (total_pool * 1000000) + verified_net_base_units
    from public.programs where id = intent_row.program_id
  ) > 999999999999999999999999999999 then
    raise exception using errcode = '22003', detail = 'program_pool_overflow';
  end if;
  select * into escrow_row from public.escrow_contracts where id = intent_row.escrow_contract_id;
  amount_usdc := verified_net_base_units / 1000000;

  select * into precredited_row from public.escrow_transactions
  where escrow_contract_id = escrow_row.id and chain_id = 5042002
    and transaction_hash = lower(destination_hash)
    and log_index = destination_log_index
  for update;
  if found then
    if precredited_row.transaction_type <> 'funding'
       or precredited_row.status <> 'confirmed'
       or precredited_row.token_address <> escrow_row.token_address
       or precredited_row.amount <> amount_usdc
       or precredited_row.to_address <> escrow_row.contract_address
       or precredited_row.block_number <> destination_block_number
       or precredited_row.block_hash <> lower(destination_block_hash)
       or precredited_row.withdrawal_intent_id is not null
       or (precredited_row.funding_intent_id is not null
         and precredited_row.funding_intent_id <> intent_row.id)
    then raise exception using errcode = '23505', detail = 'funding_destination_already_attributed'; end if;
    update public.escrow_transactions
    set funding_intent_id = intent_row.id
    where id = precredited_row.id;
    destination_precredited := true;
  end if;

  insert into public.funding_operations (
    funding_intent_id, operation_type, operation_id, event_chain_id, transaction_hash, log_index, status,
    net_received_base_units, block_number, block_hash
  ) values (
    intent_row.id,
    case intent_row.route_mode when 'send' then 'send' when 'bridge' then 'bridge' else 'spend' end,
    'server:destination_verified', 5042002, lower(destination_hash), destination_log_index, 'confirmed',
    verified_net_base_units, destination_block_number, lower(destination_block_hash)
  ) on conflict (event_chain_id, transaction_hash, log_index) where transaction_hash is not null
    do nothing returning id into inserted_id;
  if inserted_id is null and not exists (
    select 1 from public.funding_operations
    where funding_intent_id = intent_row.id
      and event_chain_id = 5042002
      and transaction_hash = lower(destination_hash) and log_index = destination_log_index
  ) then
    raise exception using errcode = '23505', detail = 'funding_destination_already_attributed';
  end if;
  inserted_id := null;

  insert into public.escrow_transactions (
    program_id, escrow_contract_id, funding_intent_id, chain_id, transaction_hash, log_index,
    transaction_type, status, token_address, amount, block_number, block_hash, confirmations,
    to_address, confirmed_at
  ) values (
    intent_row.program_id, escrow_row.id, intent_row.id, 5042002, lower(sync_hash), sync_log_index,
    'funding_sync', 'confirmed', escrow_row.token_address, amount_usdc,
    sync_block_number, lower(sync_block_hash), 1, escrow_row.contract_address, now()
  ) on conflict (chain_id, transaction_hash, log_index) do nothing returning id into inserted_id;
  if inserted_id is null then return false; end if;

  update public.funding_operations set
    transaction_hash = lower(sync_hash),
    log_index = sync_log_index,
    block_number = sync_block_number,
    block_hash = lower(sync_block_hash),
    status = 'confirmed',
    provider_state = 'success',
    retryable = false,
    failure_code = null,
    updated_at = now()
  where funding_intent_id = intent_row.id
    and operation_type = 'funding_sync'
    and operation_id = 'circle:' || intent_row.sync_circle_transaction_id::text
    and status = 'pending';

  update public.programs set
    total_pool = total_pool + case when destination_precredited then 0 else amount_usdc end,
    status = case when status = 'draft' then 'awaiting_funding' else status end
  where id = intent_row.program_id;
  insert into public.funding_confirmation_artifacts (
    funding_intent_id, program_id, escrow_contract_id, route_mode, escrow_address,
    artifact_version, artifact_checksum, token_address, token_decimals,
    destination_transaction_hash, destination_log_index,
    destination_block_number, destination_block_hash,
    sync_transaction_hash, sync_log_index, sync_block_number, sync_block_hash,
    gross_amount_base_units, estimated_fee_reserve_base_units, net_received_base_units,
    pre_total_funded_base_units, required_total_funded_base_units,
    post_total_funded_base_units,
    total_pool, reserved_pool, paid_pool, withdrawn_pool, available_pool
  )
  select
    intent_row.id, intent_row.program_id, escrow_row.id,
    intent_row.route_mode, escrow_row.contract_address,
    escrow_row.contract_version, escrow_row.artifact_checksum,
    escrow_row.token_address, escrow_row.token_decimals,
    lower(destination_hash), destination_log_index,
    destination_block_number, lower(destination_block_hash),
    lower(sync_hash), sync_log_index, sync_block_number, lower(sync_block_hash),
    intent_row.gross_amount_base_units,
    intent_row.estimated_fee_reserve_base_units,
    verified_net_base_units,
    intent_row.pre_total_funded_base_units,
    intent_row.pre_total_funded_base_units + verified_net_base_units,
    verified_post_total_funded_base_units,
    program.total_pool, program.reserved_pool, program.paid_pool,
    program.withdrawn_pool, program.available_pool
  from public.programs program
  where program.id = intent_row.program_id;
  update public.escrow_contracts set
    last_synced_block = greatest(coalesce(last_synced_block, 0), destination_block_number, sync_block_number)
  where id = escrow_row.id;
  update public.funding_intents set
    status = 'complete', net_received_base_units = verified_net_base_units,
    completed_at = now(), reconcile_lease_id = null, reconcile_lease_expires_at = null,
    updated_at = now()
  where id = intent_row.id;
  return true;
end $$;

create or replace function public.reconcile_late_funding_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_escrow_id uuid,
  scanned_through_block bigint,
  verified_events jsonb,
  advance_cursor boolean
) returns numeric
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  escrow_row public.escrow_contracts%rowtype;
  event_row jsonb;
  event_hash text;
  event_log_index integer;
  event_amount numeric;
  event_block_number bigint;
  inserted_id uuid;
  credited_base_units numeric := 0;
  program_total_base_units numeric;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_program_id::text || ':late-funding', 0));
  if not exists (
    select 1 from public.programs where id = target_program_id and owner_id = actor_id
  ) then raise exception using errcode = 'P0002', detail = 'program_not_found'; end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(
    target_escrow_id::text || ':destination-attribution', 0
  ));
  select trunc(total_pool * 1000000) into program_total_base_units
  from public.programs where id = target_program_id for update;
  select * into escrow_row from public.escrow_contracts
  where id = target_escrow_id and program_id = target_program_id
    and chain_id = 5042002 and deployment_status = 'confirmed' for update;
  if not found or escrow_row.token_address <> '0x3600000000000000000000000000000000000000' then
    raise exception using errcode = '23514', detail = 'verified_arc_escrow_required';
  end if;
  if scanned_through_block < coalesce(escrow_row.deployment_block_number, 0) then
    raise exception using errcode = '22023', detail = 'late_funding_scan_range_invalid';
  end if;
  if jsonb_typeof(coalesce(verified_events, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(verified_events, '[]'::jsonb)) > 1000 then
    raise exception using errcode = '22023', detail = 'late_funding_events_invalid';
  end if;

  for event_row in select value from jsonb_array_elements(coalesce(verified_events, '[]'::jsonb)) loop
    event_hash := lower(event_row->>'transactionHash');
    event_log_index := (event_row->>'logIndex')::integer;
    event_amount := (event_row->>'amountBaseUnits')::numeric;
    event_block_number := (event_row->>'blockNumber')::bigint;
    if event_amount = 0 then continue; end if;
    if event_hash !~ '^0x[0-9a-f]{64}$' or event_log_index < 0 or event_amount < 0
       or event_amount > 999999999999999999999999999999
       or event_block_number < coalesce(escrow_row.deployment_block_number, 0)
       or event_block_number > scanned_through_block
       or lower(event_row->>'blockHash') !~ '^0x[0-9a-f]{64}$'
       or lower(event_row->>'fromAddress') !~ '^0x[0-9a-f]{40}$' then
      raise exception using errcode = '22023', detail = 'late_funding_event_invalid';
    end if;
    if exists (
      select 1 from public.funding_intents intent
      where intent.escrow_contract_id = escrow_row.id
        and intent.destination_transaction_hash = event_hash
    ) then continue; end if;
    if exists (
      select 1 from public.funding_operations operation
      join public.funding_intents intent on intent.id = operation.funding_intent_id
      where operation.event_chain_id = 5042002
        and operation.transaction_hash = event_hash and operation.log_index = event_log_index
        and intent.escrow_contract_id = escrow_row.id
    ) then continue; end if;
    if exists (
      select 1 from public.funding_operations
      where event_chain_id = 5042002
        and transaction_hash = event_hash and log_index = event_log_index
    ) then raise exception using errcode = '23505', detail = 'late_funding_event_already_attributed'; end if;
    inserted_id := null;
    insert into public.escrow_transactions (
      program_id, escrow_contract_id, chain_id, transaction_hash, log_index,
      transaction_type, status, token_address, amount, block_number, block_hash,
      confirmations, from_address, to_address, confirmed_at
    ) values (
      target_program_id, escrow_row.id, 5042002, event_hash, event_log_index,
      'funding', 'confirmed', escrow_row.token_address, event_amount / 1000000,
      event_block_number, lower(event_row->>'blockHash'), 1,
      lower(event_row->>'fromAddress'), escrow_row.contract_address, now()
    ) on conflict (chain_id, transaction_hash, log_index) do nothing returning id into inserted_id;
    if inserted_id is not null then
      credited_base_units := credited_base_units + event_amount;
    elsif not exists (
      select 1 from public.escrow_transactions
      where escrow_contract_id = escrow_row.id and chain_id = 5042002
        and transaction_hash = event_hash and log_index = event_log_index
        and amount = event_amount / 1000000
        and transaction_type = 'funding' and status = 'confirmed'
        and token_address = escrow_row.token_address
        and block_number = event_block_number
        and block_hash = lower(event_row->>'blockHash')
        and from_address = lower(event_row->>'fromAddress')
        and to_address = escrow_row.contract_address
    ) then
      raise exception using errcode = '23505', detail = 'late_funding_event_already_attributed';
    end if;
  end loop;
  if program_total_base_units + credited_base_units
     > 999999999999999999999999999999 then
    raise exception using errcode = '22003', detail = 'program_pool_overflow';
  end if;
  if credited_base_units > 0 then
    update public.programs set total_pool = total_pool + credited_base_units / 1000000
    where id = target_program_id;
  end if;
  if advance_cursor then
    update public.escrow_contracts set
      late_funding_scanned_through_block = greatest(
        coalesce(late_funding_scanned_through_block, deployment_block_number, 0),
        scanned_through_block
      )
    where id = escrow_row.id;
  end if;
  return credited_base_units;
end $$;

create or replace function public.reconcile_late_funding_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_escrow_id uuid,
  scanned_through_block bigint,
  verified_events jsonb
) returns numeric
language sql security definer set search_path = pg_catalog, public
as $$ select public.reconcile_late_funding_atomic($1, $2, $3, $4, $5, true) $$;

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
  program_reserved numeric;
  program_available_base_units numeric;
  created_id uuid;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_program_id::text || ':withdraw', 0));
  select owner_id, reserved_pool, trunc(available_pool * 1000000)
    into program_owner, program_reserved, program_available_base_units
  from public.programs where id = target_program_id for update;
  if not found or program_owner <> actor_id then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into escrow_row from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002
    and deployment_status = 'confirmed' for update;
  if not found or escrow_row.contract_address is null or escrow_row.owner_wallet is null
     or escrow_row.withdraw_recipient is null
     or escrow_row.token_address <> '0x3600000000000000000000000000000000000000'
     or escrow_row.contract_version <> '1.1.0' or escrow_row.program_key is null
     or escrow_row.artifact_checksum is null or escrow_row.runtime_bytecode_checksum is null then
    raise exception using errcode = '23514', detail = 'verified_arc_escrow_required';
  end if;
  if lower(source_wallet) <> escrow_row.owner_wallet then
    raise exception using errcode = '22023', detail = 'withdrawal_owner_wallet_mismatch';
  end if;
  if program_reserved <> 0 then
    raise exception using errcode = '23514', detail = 'withdrawal_reserved_rewards_exist';
  end if;
  if expected_amount_base_units <= 0
     or expected_amount_base_units <> program_available_base_units then
    raise exception using errcode = '22023', detail = 'withdrawal_amount_projection_mismatch';
  end if;

  select * into existing_row from public.withdrawal_intents
  where program_id = target_program_id and idempotency_key = request_idempotency_key;
  if found then
    if existing_row.wallet_address <> lower(source_wallet)
       or existing_row.amount_base_units <> expected_amount_base_units
       or existing_row.pre_total_withdrawn_base_units <> escrow_pre_total_withdrawn_base_units
       or existing_row.close_required <> not escrow_already_closed then
      raise exception using errcode = '22023', detail = 'withdrawal_idempotency_payload_mismatch';
    end if;
    return existing_row.id;
  end if;
  if exists (
    select 1 from public.withdrawal_intents
    where escrow_contract_id = escrow_row.id and status not in ('complete','failed')
  ) then raise exception using errcode = '23505', detail = 'withdrawal_intent_already_active'; end if;

  insert into public.withdrawal_intents (
    program_id, escrow_contract_id, created_by, idempotency_key, wallet_address,
    recipient_address, amount_base_units, pre_total_withdrawn_base_units,
    close_required, status
  ) values (
    target_program_id, escrow_row.id, actor_id, request_idempotency_key,
    lower(source_wallet), escrow_row.withdraw_recipient, expected_amount_base_units,
    escrow_pre_total_withdrawn_base_units, not escrow_already_closed,
    case when escrow_already_closed then 'ready_to_withdraw' else 'ready_to_close' end
  ) returning id into created_id;
  return created_id;
end $$;

create or replace function public.observe_withdrawal_operation_atomic(
  target_intent_id uuid,
  observed_operation text,
  observed_transaction_hash text,
  observed_outcome text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.withdrawal_intents%rowtype;
begin
  select * into intent_row from public.withdrawal_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'withdrawal_intent_not_found'; end if;
  if intent_row.status in ('complete','failed') then return false; end if;
  if observed_outcome not in ('submitted','submission_uncertain')
     or (observed_outcome = 'submitted' and observed_transaction_hash is null)
     or (observed_outcome = 'submission_uncertain' and observed_transaction_hash is not null) then
    raise exception using errcode = '22023', detail = 'withdrawal_observation_invalid';
  end if;
  if observed_operation = 'close' then
    if not intent_row.close_required then
      raise exception using errcode = '22023', detail = 'withdrawal_close_not_required';
    end if;
    if observed_transaction_hash is not null and intent_row.close_transaction_hash is not null
       and intent_row.close_transaction_hash <> lower(observed_transaction_hash) then
      raise exception using errcode = '22023', detail = 'withdrawal_close_hash_mismatch';
    end if;
    update public.withdrawal_intents set
      close_transaction_hash = coalesce(close_transaction_hash, lower(observed_transaction_hash)),
      status = case
        when observed_outcome = 'submission_uncertain' and status = 'ready_to_close' then 'close_submission_uncertain'
        when observed_outcome = 'submitted' and status in ('ready_to_close','close_submission_uncertain') then 'close_submitted'
        else status end,
      updated_at = now()
    where id = target_intent_id;
  elsif observed_operation = 'withdraw' then
    if intent_row.status not in ('ready_to_withdraw','withdraw_submission_uncertain') and intent_row.withdraw_transaction_hash is null then
      raise exception using errcode = '23514', detail = 'withdrawal_close_not_verified';
    end if;
    if observed_transaction_hash is not null and intent_row.withdraw_transaction_hash is not null
       and intent_row.withdraw_transaction_hash <> lower(observed_transaction_hash) then
      raise exception using errcode = '22023', detail = 'withdrawal_hash_mismatch';
    end if;
    update public.withdrawal_intents set
      withdraw_transaction_hash = coalesce(withdraw_transaction_hash, lower(observed_transaction_hash)),
      status = case
        when status in ('withdraw_submitted','verifying') then status
        when observed_outcome = 'submission_uncertain' then 'withdraw_submission_uncertain'
        else 'withdraw_submitted' end,
      updated_at = now()
    where id = target_intent_id;
  else
    raise exception using errcode = '22023', detail = 'withdrawal_operation_invalid';
  end if;
  return true;
end $$;

create or replace function public.observe_withdrawal_operation_atomic(
  target_intent_id uuid, observed_operation text, observed_transaction_hash text
) returns boolean
language sql security definer set search_path = pg_catalog, public
as $$ select public.observe_withdrawal_operation_atomic($1, $2, $3, 'submitted') $$;

create or replace function public.confirm_withdrawal_close_atomic(
  target_intent_id uuid,
  verified_close_hash text,
  verified_close_log_index integer,
  verified_close_block_number bigint,
  verified_close_block_hash text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.withdrawal_intents%rowtype;
begin
  select * into intent_row from public.withdrawal_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'withdrawal_intent_not_found'; end if;
  if not intent_row.close_required then return false; end if;
  if intent_row.close_transaction_hash <> lower(verified_close_hash) then
    raise exception using errcode = '22023', detail = 'withdrawal_close_hash_mismatch';
  end if;
  if intent_row.close_log_index is not null then return true; end if;
  update public.withdrawal_intents set
    close_log_index = verified_close_log_index,
    close_block_number = verified_close_block_number,
    close_block_hash = lower(verified_close_block_hash),
    status = 'ready_to_withdraw', updated_at = now()
  where id = target_intent_id and status = 'close_submitted';
  return found;
end $$;

create or replace function public.fail_withdrawal_intent_atomic(
  target_intent_id uuid,
  expected_transaction_hash text,
  terminal_failure_code text
) returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare intent_row public.withdrawal_intents%rowtype;
begin
  select * into intent_row from public.withdrawal_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'withdrawal_intent_not_found'; end if;
  if intent_row.status = 'complete' then return false; end if;
  if lower(expected_transaction_hash) is distinct from intent_row.close_transaction_hash
     and lower(expected_transaction_hash) is distinct from intent_row.withdraw_transaction_hash then
    raise exception using errcode = '22023', detail = 'withdrawal_terminal_hash_mismatch';
  end if;
  if terminal_failure_code !~ '^[a-z][a-z0-9._-]{0,127}$' then
    raise exception using errcode = '22023', detail = 'withdrawal_failure_code_invalid';
  end if;
  update public.withdrawal_intents set
    status = 'failed', failure_code = terminal_failure_code, updated_at = now()
  where id = target_intent_id and status <> 'failed';
  return true;
end $$;

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
  select * into intent_row from public.withdrawal_intents where id = target_intent_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'withdrawal_intent_not_found'; end if;
  if intent_row.status = 'complete' then return true; end if;
  if intent_row.status <> 'withdraw_submitted'
     or intent_row.withdraw_transaction_hash <> lower(verified_withdraw_hash)
     or intent_row.amount_base_units <> verified_amount_base_units then
    raise exception using errcode = '22023', detail = 'withdrawal_evidence_mismatch';
  end if;
  if intent_row.close_required and intent_row.close_log_index is null then
    raise exception using errcode = '23514', detail = 'withdrawal_close_not_verified';
  end if;
  select reserved_pool, trunc(available_pool * 1000000)
    into program_reserved, program_available_base_units
  from public.programs where id = intent_row.program_id for update;
  if program_reserved <> 0 or program_available_base_units < verified_amount_base_units then
    raise exception using errcode = '23514', detail = 'withdrawal_projection_changed';
  end if;
  select * into escrow_row from public.escrow_contracts where id = intent_row.escrow_contract_id;

  insert into public.escrow_transactions (
    program_id, escrow_contract_id, withdrawal_intent_id, chain_id, transaction_hash,
    log_index, transaction_type, status, token_address, amount, block_number,
    block_hash, confirmations, from_address, to_address, confirmed_at
  ) values (
    intent_row.program_id, escrow_row.id, intent_row.id, 5042002,
    lower(verified_withdraw_hash), verified_withdraw_log_index, 'withdraw_remaining',
    'confirmed', escrow_row.token_address, verified_amount_base_units / 1000000,
    verified_block_number, lower(verified_block_hash), 1, escrow_row.contract_address,
    intent_row.recipient_address, now()
  ) on conflict (chain_id, transaction_hash, log_index) do nothing returning id into inserted_id;
  if inserted_id is null then
    if exists (
      select 1 from public.escrow_transactions
      where withdrawal_intent_id = intent_row.id
        and transaction_hash = lower(verified_withdraw_hash)
        and log_index = verified_withdraw_log_index
    ) then return true; end if;
    raise exception using errcode = '23505', detail = 'withdrawal_event_already_attributed';
  end if;
  update public.programs set
    withdrawn_pool = withdrawn_pool + verified_amount_base_units / 1000000
  where id = intent_row.program_id;
  update public.escrow_contracts set
    last_synced_block = greatest(coalesce(last_synced_block, 0), verified_block_number)
  where id = escrow_row.id;
  update public.withdrawal_intents set
    status = 'complete', withdraw_log_index = verified_withdraw_log_index,
    transfer_log_index = verified_transfer_log_index,
    withdraw_block_number = verified_block_number,
    withdraw_block_hash = lower(verified_block_hash), completed_at = now(), updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.enforce_confirmed_escrow_deadline_lock()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.deadline is distinct from old.deadline and exists (
    select 1 from public.escrow_contracts escrow
    where escrow.program_id = old.id and escrow.chain_id = 5042002
      and escrow.deployment_status in ('accepted','pending','verifying','confirmed')
      and escrow.refund_unlock_at is distinct from new.deadline
  ) then raise exception using errcode = '23514', detail = 'confirmed_escrow_deadline_locked'; end if;
  return new;
end $$;
create trigger programs_confirmed_escrow_deadline_lock
before update of deadline on public.programs
for each row execute function public.enforce_confirmed_escrow_deadline_lock();

create or replace function public.enforce_program_publish_collateral()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.status = 'active'
     and (old.status <> 'active' or new.max_bounty is distinct from old.max_bounty)
     and (old.status <> 'active' or exists (
       select 1 from public.escrow_contracts escrow
       where escrow.program_id = new.id and escrow.chain_id = 5042002
         and escrow.deployment_status = 'confirmed'
     )) then
    if old.status <> 'active'
       and (new.deadline is null or new.deadline <= now())
    then raise exception using errcode = '23514', detail = 'program_deadline_invalid'; end if;
    if old.status <> 'active' and not exists (
      select 1
      from public.funding_confirmation_artifacts artifact
      join public.funding_intents intent
        on intent.id = artifact.funding_intent_id
       and intent.program_id = artifact.program_id
       and intent.escrow_contract_id = artifact.escrow_contract_id
       and intent.status = 'complete'
      join public.escrow_contracts escrow
        on escrow.id = artifact.escrow_contract_id
       and escrow.program_id = artifact.program_id
       and escrow.chain_id = 5042002
       and escrow.deployment_status = 'confirmed'
      where artifact.program_id = new.id
        and artifact.escrow_address = escrow.contract_address
        and artifact.artifact_version = escrow.contract_version
        and artifact.artifact_checksum = escrow.artifact_checksum
        and artifact.token_address = escrow.token_address
    ) then
      raise exception using errcode = '23514',
        detail = 'canonical_funding_confirmation_required';
    end if;
    if (new.total_pool - new.reserved_pool - new.paid_pool - new.withdrawn_pool) < new.max_bounty then
      raise exception using errcode = '23514', detail = 'program_max_bounty_not_collateralized';
    end if;
    if old.status <> 'active' and not exists (
      select 1 from public.escrow_contracts escrow
      where escrow.program_id = new.id and escrow.chain_id = 5042002
        and escrow.deployment_status = 'confirmed'
        and escrow.token_address = '0x3600000000000000000000000000000000000000'
        and escrow.refund_unlock_at = new.deadline
        and escrow.refund_unlock_at > now()
    ) then raise exception using errcode = '23514', detail = 'verified_arc_escrow_required'; end if;
  end if;
  return new;
end $$;
create trigger programs_publish_collateral_guard
before update of status, max_bounty on public.programs
for each row execute function public.enforce_program_publish_collateral();

revoke all on function public.create_escrow_deployment_atomic(uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.confirm_escrow_deployment_atomic(uuid,text,text,bigint,text,text) from public, anon, authenticated;
revoke all on function public.create_funding_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.refresh_funding_quote_atomic(uuid,uuid,uuid,numeric,jsonb,timestamp with time zone,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.store_funding_sync_transaction_atomic(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.fail_funding_sync_atomic(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.create_source_deposit_atomic(uuid,uuid,uuid,text,bigint,text,text,text,numeric,numeric) from public, anon, authenticated;
revoke all on function public.observe_source_deposit_atomic(uuid,uuid,uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.fail_source_deposit_reverted_atomic(uuid,text) from public, anon, authenticated;
revoke all on function public.ingest_circle_gateway_deposit_finalized_atomic(uuid,uuid,uuid,integer,text,text,numeric,text,text,text,timestamp with time zone,smallint) from public, anon, authenticated;
revoke all on function public.record_source_deposit_onchain_verified_atomic(uuid,text,integer,integer,bigint,text) from public, anon, authenticated;
revoke all on function public.confirm_source_deposit_atomic(uuid,text,integer,bigint,text) from public, anon, authenticated;
revoke all on function public.claim_funding_reconciliation_atomic(uuid,uuid,timestamp with time zone) from public, anon, authenticated;
revoke all on function public.observe_funding_operation_atomic(uuid,text,text,text,jsonb,text,boolean,boolean,jsonb) from public, anon, authenticated;
revoke all on function public.fail_funding_destination_reverted_atomic(uuid,text) from public, anon, authenticated;
revoke all on function public.reconcile_funding_intent_atomic(uuid,uuid,text,integer,bigint,text,text,integer,numeric,numeric,bigint,text) from public, anon, authenticated;
revoke all on function public.create_withdrawal_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,boolean) from public, anon, authenticated;
revoke all on function public.reconcile_late_funding_atomic(uuid,uuid,uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_late_funding_atomic(uuid,uuid,uuid,bigint,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.observe_withdrawal_operation_atomic(uuid,text,text) from public, anon, authenticated;
revoke all on function public.observe_withdrawal_operation_atomic(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.confirm_withdrawal_close_atomic(uuid,text,integer,bigint,text) from public, anon, authenticated;
revoke all on function public.fail_withdrawal_intent_atomic(uuid,text,text) from public, anon, authenticated;
revoke all on function public.reconcile_withdrawal_intent_atomic(uuid,text,integer,integer,numeric,bigint,text) from public, anon, authenticated;
grant execute on function public.create_escrow_deployment_atomic(uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid) to service_role;
grant execute on function public.confirm_escrow_deployment_atomic(uuid,text,text,bigint,text,text) to service_role;
grant execute on function public.create_funding_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,timestamp with time zone) to service_role;
grant execute on function public.refresh_funding_quote_atomic(uuid,uuid,uuid,numeric,jsonb,timestamp with time zone,timestamp with time zone) to service_role;
grant execute on function public.store_funding_sync_transaction_atomic(uuid,uuid,uuid) to service_role;
grant execute on function public.fail_funding_sync_atomic(uuid,uuid,uuid,text) to service_role;
grant execute on function public.create_source_deposit_atomic(uuid,uuid,uuid,text,bigint,text,text,text,numeric,numeric) to service_role;
grant execute on function public.observe_source_deposit_atomic(uuid,uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.fail_source_deposit_reverted_atomic(uuid,text) to service_role;
grant execute on function public.ingest_circle_gateway_deposit_finalized_atomic(uuid,uuid,uuid,integer,text,text,numeric,text,text,text,timestamp with time zone,smallint) to service_role;
grant execute on function public.record_source_deposit_onchain_verified_atomic(uuid,text,integer,integer,bigint,text) to service_role;
grant execute on function public.confirm_source_deposit_atomic(uuid,text,integer,bigint,text) to service_role;
grant execute on function public.claim_funding_reconciliation_atomic(uuid,uuid,timestamp with time zone) to service_role;
grant execute on function public.observe_funding_operation_atomic(uuid,text,text,text,jsonb,text,boolean,boolean,jsonb) to service_role;
grant execute on function public.fail_funding_destination_reverted_atomic(uuid,text) to service_role;
grant execute on function public.reconcile_funding_intent_atomic(uuid,uuid,text,integer,bigint,text,text,integer,numeric,numeric,bigint,text) to service_role;
grant execute on function public.create_withdrawal_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,boolean) to service_role;
grant execute on function public.reconcile_late_funding_atomic(uuid,uuid,uuid,bigint,jsonb) to service_role;
grant execute on function public.reconcile_late_funding_atomic(uuid,uuid,uuid,bigint,jsonb,boolean) to service_role;
grant execute on function public.observe_withdrawal_operation_atomic(uuid,text,text) to service_role;
grant execute on function public.observe_withdrawal_operation_atomic(uuid,text,text,text) to service_role;
grant execute on function public.confirm_withdrawal_close_atomic(uuid,text,integer,bigint,text) to service_role;
grant execute on function public.fail_withdrawal_intent_atomic(uuid,text,text) to service_role;
grant execute on function public.reconcile_withdrawal_intent_atomic(uuid,text,integer,integer,numeric,bigint,text) to service_role;

revoke all on function public.fund_program_escrow_atomic(uuid,uuid,numeric,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_program_escrow_atomic(uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;
drop function if exists public.fund_program_escrow_atomic(uuid,uuid,numeric,text,text);
drop function if exists public.record_program_escrow_atomic(uuid,uuid,bigint,text,text);
