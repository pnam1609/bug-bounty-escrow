-- CP-14: durable recovery control plane for locked funding operations.
--
-- Provider payloads remain bounded in `steps`; recovery stores only stable identifiers,
-- canonical transaction evidence and transition metadata. Wallet execution is never performed
-- by these RPCs.

alter table public.funding_operations
  add column idempotency_key uuid,
  add column wallet_claim_token uuid,
  add column released_wallet_claim_token uuid,
  add column delivery_retry_claim_token uuid,
  add column delivery_retry_attempt_no integer not null default 0
    check (delivery_retry_attempt_no >= 0),
  add column unbound_transaction_hashes jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(unbound_transaction_hashes) = 'array'
      and jsonb_array_length(unbound_transaction_hashes) <= 32
    ),
  add column recovery_checked_at timestamp with time zone,
  add column recovery_transaction_hash text
    check (recovery_transaction_hash is null or recovery_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  add column recovery_state text
    check (recovery_state is null or recovery_state in ('pending','success','reverted')),
  add column recovery_block_number bigint
    check (recovery_block_number is null or recovery_block_number >= 0),
  add column recovery_block_hash text
    check (recovery_block_hash is null or recovery_block_hash ~ '^0x[0-9a-f]{64}$'),
  add constraint funding_operations_recovery_block_evidence_check
    check (
      (recovery_block_number is null and recovery_block_hash is null)
      or (recovery_block_number is not null and recovery_block_hash is not null)
    );

create table public.funding_operation_recovery_checks (
  funding_operation_id uuid not null references public.funding_operations(id) on delete cascade,
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  evidence_role text not null check (evidence_role in ('source','destination')),
  network text not null check (
    network in (
      'Ethereum_Sepolia','Arbitrum_Sepolia','Base_Sepolia','Arc_Testnet'
    )
  ),
  state text not null check (state in ('pending','success','reverted')),
  block_number bigint check (block_number is null or block_number >= 0),
  block_hash text check (block_hash is null or block_hash ~ '^0x[0-9a-f]{64}$'),
  checked_at timestamp with time zone not null default now(),
  primary key (funding_operation_id, transaction_hash),
  unique (network, transaction_hash),
  check (evidence_role <> 'destination' or network = 'Arc_Testnet'),
  check (
    (state = 'pending' and block_number is null and block_hash is null)
    or (state in ('success','reverted') and block_number is not null and block_hash is not null)
  )
);

alter table public.funding_operation_recovery_checks enable row level security;

create policy authenticated_user_must_be_active
on public.funding_operation_recovery_checks
as restrictive
for all
to authenticated
using ((select public.is_active_auth_user()))
with check ((select public.is_active_auth_user()));

revoke all on table public.funding_operation_recovery_checks from public, anon, authenticated;
grant select, insert, update on table public.funding_operation_recovery_checks to service_role;

-- Existing rows predate operation idempotency. Backfill from their immutable operation identity;
-- never use a random migration default because the same logical row must derive the same key in
-- every clean-room migration and fixture.
with operation_keys as (
  select operation.id, md5(
    operation.funding_intent_id::text || ':' ||
    operation.operation_type || ':' ||
    coalesce(operation.source_chain, '') || ':' ||
    operation.attempt_no::text || ':' ||
    coalesce(operation.operation_id, operation.id::text)
  ) as identity_digest
  from public.funding_operations operation
)
update public.funding_operations operation
set idempotency_key = (
  substr(operation_keys.identity_digest, 1, 8) || '-' ||
  substr(operation_keys.identity_digest, 9, 4) || '-4' ||
  substr(operation_keys.identity_digest, 14, 3) || '-8' ||
  substr(operation_keys.identity_digest, 18, 3) || '-' ||
  substr(operation_keys.identity_digest, 21, 12)
)::uuid
from operation_keys
where operation_keys.id = operation.id;

alter table public.funding_operations
  alter column idempotency_key set not null;

create or replace function public.set_funding_operation_idempotency_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  identity_digest text;
begin
  if new.idempotency_key is null then
    identity_digest := md5(
      new.funding_intent_id::text || ':' ||
      new.operation_type || ':' ||
      coalesce(new.source_chain, '') || ':' ||
      new.attempt_no::text || ':' ||
      coalesce(new.operation_id, '')
    );
    new.idempotency_key := (
      substr(identity_digest, 1, 8) || '-' ||
      substr(identity_digest, 9, 4) || '-4' ||
      substr(identity_digest, 14, 3) || '-8' ||
      substr(identity_digest, 18, 3) || '-' ||
      substr(identity_digest, 21, 12)
    )::uuid;
  end if;
  return new;
end $$;

create trigger funding_operations_set_idempotency_key
before insert on public.funding_operations
for each row execute function public.set_funding_operation_idempotency_key();

create unique index funding_operations_intent_idempotency_key
  on public.funding_operations (funding_intent_id, idempotency_key);

create unique index funding_operations_destination_attempt_key
  on public.funding_operations (funding_intent_id, operation_type, attempt_no)
  where operation_type in ('send','bridge','spend')
    and operation_id is distinct from 'server:destination_verified';

create unique index funding_operations_one_active_destination_attempt
  on public.funding_operations (funding_intent_id, operation_type)
  where operation_type in ('send','bridge','spend')
    and status not in ('failed','confirmed');

create unique index funding_operations_one_direct_replacement
  on public.funding_operations (replaces_operation_id)
  where replaces_operation_id is not null;

-- A fresh quote can require an additive deposit after a prior source attempt was confirmed. Link
-- that immutable top-up to the immediately preceding confirmed attempt without rewriting either
-- attempt's amount or evidence.
create or replace function public.link_confirmed_source_deposit_top_up()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare prior_id uuid;
begin
  if new.operation_type = 'deposit'
     and new.replaces_operation_id is null
     and new.attempt_no > 1
  then
    select id into prior_id
    from public.funding_operations
    where funding_intent_id = new.funding_intent_id
      and operation_type = 'deposit'
      and source_chain = new.source_chain
      and attempt_no = new.attempt_no - 1
      and status = 'confirmed'
    for share;
    if found then new.replaces_operation_id := prior_id; end if;
  end if;
  return new;
end $$;

create trigger funding_operations_link_confirmed_source_top_up
before insert on public.funding_operations
for each row execute function public.link_confirmed_source_deposit_top_up();

-- Normalize pre-CP14 quotes before enforcing bounded component evidence. Components express the
-- USDC fee reserve only; native gas readiness is still independently checked by the wallet.
update public.funding_intents intent
set fee_allocations = (
  select jsonb_agg(
    allocation || jsonb_build_object(
      'components',
      jsonb_build_array(
        jsonb_build_object(
          'network', allocation->>'network',
          'type', 'provider',
          'token', 'USDC',
          'amountBaseUnits', allocation->>'amountBaseUnits'
        ),
        jsonb_build_object(
          'network', allocation->>'network',
          'type', 'gas',
          'token', 'USDC',
          'amountBaseUnits', '0'
        ),
        jsonb_build_object(
          'network', allocation->>'network',
          'type', 'kit',
          'token', 'USDC',
          'amountBaseUnits', '0'
        ),
        jsonb_build_object(
          'network', allocation->>'network',
          'type', 'forwarder',
          'token', 'USDC',
          'amountBaseUnits', '0'
        )
      )
    )
    order by ordinal
  )
  from jsonb_array_elements(intent.fee_allocations) with ordinality entry(allocation, ordinal)
);

create or replace function public.validate_funding_fee_components()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare allocation_item jsonb;
begin
  if jsonb_typeof(new.fee_allocations) <> 'array'
     or jsonb_array_length(new.fee_allocations) <> jsonb_array_length(new.sources)
     or (
       select count(distinct fee_entry->>'network')
       from jsonb_array_elements(new.fee_allocations) fee_entry
     ) <> jsonb_array_length(new.fee_allocations)
     or exists (
       select 1
       from jsonb_array_elements(new.fee_allocations) fee_entry
       where not exists (
         select 1
         from jsonb_array_elements(new.sources) source
         where source->>'network' = fee_entry->>'network'
       )
     )
     or exists (
       select 1
       from jsonb_array_elements(new.sources) source
       where not exists (
         select 1
         from jsonb_array_elements(new.fee_allocations) fee_entry
         where fee_entry->>'network' = source->>'network'
       )
     )
     or (
       select coalesce(sum((entry->>'amountBaseUnits')::numeric), 0)
       from jsonb_array_elements(new.fee_allocations) entry
     ) <> new.estimated_fee_reserve_base_units
  then
    raise exception using errcode = '23514', detail = 'funding_fee_allocation_total_invalid';
  end if;

  for allocation_item in select value from jsonb_array_elements(new.fee_allocations)
  loop
    if jsonb_typeof(allocation_item->'components') <> 'array'
       or jsonb_array_length(allocation_item->'components') <> 4
       or (
         select count(distinct component->>'type')
         from jsonb_array_elements(allocation_item->'components') component
       ) <> 4
       or exists (
         select 1
         from jsonb_array_elements(allocation_item->'components') component
         where component->>'type' not in ('provider','gas','kit','forwarder')
            or component->>'network' is distinct from allocation_item->>'network'
            or component->>'token' is distinct from 'USDC'
            or coalesce(component->>'amountBaseUnits', '') !~ '^(0|[1-9][0-9]*)$'
            or (component->>'amountBaseUnits')::numeric < 0
            or (
              component->>'type' in ('kit','forwarder')
              and (component->>'amountBaseUnits')::numeric <> 0
            )
       )
       or (
         select coalesce(sum((component->>'amountBaseUnits')::numeric), 0)
         from jsonb_array_elements(allocation_item->'components') component
       ) <> (allocation_item->>'amountBaseUnits')::numeric
    then
      raise exception using errcode = '23514', detail = 'funding_fee_components_invalid';
    end if;
  end loop;
  return new;
end $$;

create trigger funding_intents_validate_fee_components
before insert or update of fee_allocations, estimated_fee_reserve_base_units, sources
on public.funding_intents
for each row execute function public.validate_funding_fee_components();

create or replace function public.audit_funding_operation_recovery_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (
      actor_type, action, entity_type, entity_id, metadata
    ) values (
      'system',
      'funding.operation_created',
      'funding_operation',
      new.id::text,
      jsonb_build_object(
        'fundingIntent', new.funding_intent_id,
        'operationType', new.operation_type,
        'attempt', new.attempt_no,
        'toStatus', new.status,
        'hasTransactionHash', new.transaction_hash is not null,
        'submissionUncertain', new.submission_uncertain,
        'providerState', new.provider_state,
        'transferId', new.transfer_id,
        'retryable', new.retryable,
        'steps', new.steps
      )
    );
  elsif old.status is distinct from new.status
     or old.transaction_hash is distinct from new.transaction_hash
     or old.failure_code is distinct from new.failure_code
     or old.recovery_state is distinct from new.recovery_state
  then
    insert into public.audit_logs (
      actor_type, action, entity_type, entity_id, metadata
    ) values (
      'system',
      'funding.operation_transition',
      'funding_operation',
      new.id::text,
      jsonb_build_object(
        'fundingIntent', new.funding_intent_id,
        'operationType', new.operation_type,
        'attempt', new.attempt_no,
        'fromStatus', old.status,
        'toStatus', new.status,
        'hasTransactionHash', new.transaction_hash is not null,
        'submissionUncertain', new.submission_uncertain,
        'recoveryState', new.recovery_state,
        'failureCode', new.failure_code,
        'providerState', new.provider_state,
        'transferId', new.transfer_id,
        'retryable', new.retryable,
        'steps', new.steps
      )
    );
  end if;
  return new;
end $$;

create trigger funding_operations_audit_recovery_transition
after insert or update on public.funding_operations
for each row execute function public.audit_funding_operation_recovery_transition();

create or replace function public.enforce_funding_intent_locked_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.program_id is distinct from new.program_id
     or old.escrow_contract_id is distinct from new.escrow_contract_id
     or old.wallet_address is distinct from new.wallet_address
     or old.route_mode is distinct from new.route_mode
     or old.gross_amount_base_units is distinct from new.gross_amount_base_units
     or old.sources is distinct from new.sources
     or old.destination_chain is distinct from new.destination_chain
     or old.destination_address is distinct from new.destination_address
     or old.pre_balance_base_units is distinct from new.pre_balance_base_units
     or old.pre_total_funded_base_units is distinct from new.pre_total_funded_base_units
     or old.idempotency_key is distinct from new.idempotency_key
  then
    raise exception using errcode = '23514', detail = 'funding_intent_identity_locked';
  end if;
  return new;
end $$;

create trigger funding_intents_enforce_locked_identity
before update on public.funding_intents
for each row execute function public.enforce_funding_intent_locked_identity();

create or replace function public.audit_funding_intent_recovery_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.status is distinct from new.status
     or old.funding_phase is distinct from new.funding_phase
  then
    insert into public.audit_logs (
      actor_type, action, entity_type, entity_id, metadata
    ) values (
      'system',
      'funding.intent_transition',
      'funding_intent',
      new.id::text,
      jsonb_build_object(
        'fromStatus', old.status,
        'toStatus', new.status,
        'fromPhase', old.funding_phase,
        'toPhase', new.funding_phase
      )
    );
  end if;
  if old.estimated_fee_reserve_base_units is distinct from new.estimated_fee_reserve_base_units
     or old.fee_allocations is distinct from new.fee_allocations
     or old.quote_quoted_at is distinct from new.quote_quoted_at
     or old.quote_expires_at is distinct from new.quote_expires_at
  then
    insert into public.audit_logs (
      actor_type, action, entity_type, entity_id, metadata
    ) values (
      'system',
      'funding.quote_refreshed',
      'funding_intent',
      new.id::text,
      jsonb_build_object(
        'oldFeeReserveBaseUnits', old.estimated_fee_reserve_base_units::text,
        'newFeeReserveBaseUnits', new.estimated_fee_reserve_base_units::text,
        'oldQuotedAt', old.quote_quoted_at,
        'newQuotedAt', new.quote_quoted_at,
        'oldExpiresAt', old.quote_expires_at,
        'newExpiresAt', new.quote_expires_at,
      'sourceCount', jsonb_array_length(new.sources),
      'componentEvidenceBounded', true,
      'evidenceVersion', 1,
      'oldFeeComponentChecksum', md5(old.fee_allocations::text),
      'newFeeComponentChecksum', md5(new.fee_allocations::text)
      )
    );
  end if;
  return new;
end $$;

create trigger funding_intents_audit_recovery_transition
after update on public.funding_intents
for each row execute function public.audit_funding_intent_recovery_transition();

create or replace function public.prepare_funding_destination_checked_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  expected_quote_quoted_at timestamp with time zone,
  expected_fee_allocations jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.quote_quoted_at is distinct from expected_quote_quoted_at
     or intent_row.fee_allocations is distinct from expected_fee_allocations
  then
    raise exception using errcode = '40001', detail = 'funding_readiness_snapshot_stale';
  end if;
  return public.prepare_funding_destination_atomic(
    actor_id, target_program_id, target_intent_id
  );
end $$;

create or replace function public.reopen_funding_source_collection_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  expected_quote_quoted_at timestamp with time zone,
  expected_fee_allocations jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or expected_quote_quoted_at is null or expected_fee_allocations is null
  then
    raise exception using errcode = '22023', detail = 'funding_reopen_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.quote_quoted_at is distinct from expected_quote_quoted_at
     or intent_row.fee_allocations is distinct from expected_fee_allocations
  then
    raise exception using errcode = '40001', detail = 'funding_readiness_snapshot_stale';
  end if;
  if intent_row.funding_phase = 'collecting_deposits' then return false; end if;
  if intent_row.route_mode <> 'unified_balance'
     or intent_row.status <> 'ready_to_sign'
     or intent_row.funding_phase <> 'ready_for_destination'
     or intent_row.destination_transaction_hash is not null
     or intent_row.transfer_id is not null
     or intent_row.sync_circle_transaction_id is not null
     or intent_row.net_received_base_units is not null
     or intent_row.reconcile_lease_id is not null
     or intent_row.reconcile_lease_expires_at is not null
     or exists (
       select 1 from public.funding_operations
       where funding_intent_id = target_intent_id
         and operation_type in ('send','bridge','spend','funding_sync')
     )
     or exists (
       select 1 from public.funding_confirmation_artifacts
       where funding_intent_id = target_intent_id
     )
  then
    raise exception using errcode = '23514', detail = 'funding_source_collection_reopen_not_safe';
  end if;
  update public.funding_intents
  set funding_phase = 'collecting_deposits',
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.source_collection_reopened',
    'funding_intent', target_intent_id::text,
    jsonb_build_object('fundingPhase', 'collecting_deposits')
  );
  return true;
end $$;

create or replace function public.cancel_funding_intent_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':recovery', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.status = 'cancelled' then return false; end if;
  if intent_row.status in ('complete','failed')
     or intent_row.destination_transaction_hash is not null
     or exists (
       select 1
       from public.funding_operations operation
       where operation.funding_intent_id = target_intent_id
         and (
           operation.transaction_hash is not null
           or operation.submission_uncertain
           or operation.status in (
             'submitted','pending','submission_uncertain','onchain_verified',
             'gateway_finalized','confirmed'
           )
           or exists (
             select 1
             from jsonb_array_elements(operation.steps) step
             where coalesce(step->>'transactionHash', '') <> ''
           )
         )
     )
  then
    raise exception using errcode = '23514', detail = 'funding_cancellation_irreversible';
  end if;

  update public.funding_operations
  set status = 'failed',
      retryable = false,
      failure_code = 'owner.cancelled_before_submission',
      updated_at = now()
  where funding_intent_id = target_intent_id
    and status = 'awaiting_signature';
  update public.funding_intents
  set status = 'cancelled',
      failure_code = null,
      reconcile_lease_id = null,
      reconcile_lease_expires_at = null,
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.intent_cancelled', 'funding_intent',
    target_intent_id::text,
    jsonb_build_object('program', target_program_id, 'beforeSubmission', true)
  );
  return true;
end $$;

create or replace function public.create_funding_destination_replacement_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  active_row public.funding_operations%rowtype;
  prior_row public.funding_operations%rowtype;
  operation_kind text;
  created_id uuid;
  next_attempt integer;
  replacement_key uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.status in ('complete','failed','cancelled')
     or intent_row.funding_phase <> 'ready_for_destination'
  then
    raise exception using errcode = '23514', detail = 'funding_replacement_intent_not_active';
  end if;
  operation_kind := case intent_row.route_mode
    when 'send' then 'send'
    when 'bridge' then 'bridge'
    else 'spend'
  end;
  if operation_kind <> 'send' then
    raise exception using
      errcode = '23514',
      detail = 'funding_destination_manual_recovery_required';
  end if;

  select * into active_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
    and status not in ('failed','confirmed')
  order by attempt_no desc
  limit 1
  for update;
  if found then
    if active_row.replaces_operation_id is not null then return active_row.id; end if;
    raise exception using errcode = '23505', detail = 'funding_destination_attempt_active';
  end if;

  select * into prior_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
  order by attempt_no desc
  limit 1
  for update;
  if not found
     or prior_row.status <> 'failed'
     or prior_row.failure_code <> 'server.funding_destination_reverted'
  then
    raise exception using errcode = '23514', detail = 'funding_replacement_not_allowed';
  end if;
  next_attempt := prior_row.attempt_no + 1;

  insert into public.funding_operations (
    funding_intent_id, attempt_no, replaces_operation_id, operation_type,
    operation_id, idempotency_key, status, retryable, submission_uncertain, steps
  ) values (
    target_intent_id, next_attempt, prior_row.id, operation_kind,
    'client:uncertain-after-sign:' || target_intent_id::text || ':attempt:' || next_attempt::text,
    replacement_key, 'awaiting_signature', false, false,
    jsonb_build_array(jsonb_build_object(
      'name', 'replacement_created',
      'state', 'pending'
    ))
  )
  returning id into created_id;

  update public.funding_intents
  set destination_transaction_hash = null,
      transfer_id = null,
      status = case
        when route_mode = 'send' then 'ready_to_sign'
        else 'source_submitted'
      end,
      failure_code = null,
      reconcile_lease_id = null,
      reconcile_lease_expires_at = null,
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.destination_replacement_created',
    'funding_operation', created_id::text,
    jsonb_build_object(
      'fundingIntent', target_intent_id,
      'replacesOperation', prior_row.id,
      'operationType', operation_kind,
      'attempt', next_attempt
    )
  );
  return created_id;
end $$;

create or replace function public.claim_funding_destination_attempt_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  request_idempotency_key uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  latest_row public.funding_operations%rowtype;
  operation_kind text;
  created_id uuid;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or request_idempotency_key is null
  then
    raise exception using errcode = '22023', detail = 'funding_destination_claim_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.status in ('complete','failed','cancelled')
     or intent_row.funding_phase <> 'ready_for_destination'
  then
    raise exception using errcode = '23514', detail = 'funding_destination_attempt_not_active';
  end if;
  if intent_row.quote_expires_at is null or intent_row.quote_expires_at <= now() then
    raise exception using errcode = '23514', detail = 'funding_quote_expired';
  end if;
  operation_kind := case intent_row.route_mode
    when 'send' then 'send'
    when 'bridge' then 'bridge'
    else 'spend'
  end;

  select * into operation_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
    and idempotency_key = request_idempotency_key
  limit 1
  for update;
  if found then return operation_row.id; end if;

  select * into operation_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
    and status not in ('failed','confirmed')
  order by attempt_no desc
  limit 1
  for update;
  if found then
    -- A pre-prompt awaiting-signature attempt is intentionally reusable after an explicit
    -- wallet rejection. Any hash/uncertain/progress evidence remains a no-replay boundary.
    return operation_row.id;
  end if;

  select * into latest_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
  order by attempt_no desc
  limit 1
  for update;
  if found then
    raise exception using errcode = '23514', detail = case
      when operation_kind = 'send'
        then 'funding_destination_replacement_required'
      else 'funding_destination_manual_recovery_required'
    end;
  end if;

  insert into public.funding_operations (
    funding_intent_id, attempt_no, operation_type, operation_id,
    idempotency_key, event_chain_id, status, retryable,
    submission_uncertain, steps
  ) values (
    target_intent_id, 1, operation_kind,
    'client:attempt:' || request_idempotency_key::text,
    request_idempotency_key, 5042002, 'awaiting_signature', true,
    false, jsonb_build_array(jsonb_build_object(
      'name', 'wallet_signature',
      'state', 'pending'
    ))
  )
  returning id into created_id;

  update public.funding_intents
  set status = 'awaiting_signature',
      failure_code = null,
      updated_at = now()
  where id = target_intent_id;
  return created_id;
end $$;

create or replace function public.arm_funding_destination_attempt_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  operation_kind text;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or claim_token is null
  then
    raise exception using errcode = '22023', detail = 'funding_wallet_claim_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  operation_kind := case intent_row.route_mode
    when 'send' then 'send'
    when 'bridge' then 'bridge'
    else 'spend'
  end;
  select * into operation_row
  from public.funding_operations
  where funding_intent_id = target_intent_id
    and operation_type = operation_kind
    and status not in ('failed','confirmed')
  order by attempt_no desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_destination_attempt_not_found';
  end if;
  if operation_row.wallet_claim_token is not distinct from claim_token
     and operation_row.status = 'submission_uncertain'
     and operation_row.submission_uncertain
  then
    return true;
  end if;
  if intent_row.funding_phase <> 'ready_for_destination'
     or operation_row.status <> 'awaiting_signature'
     or operation_row.wallet_claim_token is not null
     or operation_row.transaction_hash is not null
     or operation_row.transfer_id is not null
     or operation_row.recovery_state is not null
     or intent_row.destination_transaction_hash is not null
     or exists (
       select 1 from jsonb_array_elements(operation_row.steps) step
       where coalesce(step->>'transactionHash', '') <> ''
          or coalesce(step->>'state', 'pending') <> 'pending'
     )
  then
    return false;
  end if;
  update public.funding_operations
  set wallet_claim_token = claim_token,
      released_wallet_claim_token = null,
      status = 'submission_uncertain',
      submission_uncertain = true,
      retryable = false,
      updated_at = now()
  where id = operation_row.id
    and status = 'awaiting_signature'
    and wallet_claim_token is null;
  if not found then return false; end if;
  update public.funding_intents
  set status = 'source_submitted',
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.destination_wallet_boundary_acquired',
    'funding_operation', operation_row.id::text,
    jsonb_build_object('fundingIntent', target_intent_id)
  );
  return true;
end $$;

create or replace function public.arm_bridge_delivery_retry_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null or claim_token is null
  then
    raise exception using errcode = '22023', detail = 'bridge_delivery_retry_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':bridge-delivery', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row from public.funding_intents
  where id = target_intent_id and program_id = target_program_id for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row from public.funding_operations
  where id = target_operation_id and funding_intent_id = target_intent_id
    and operation_type = 'bridge' for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;
  if operation_row.delivery_retry_claim_token is not distinct from claim_token
     and operation_row.status = 'submission_uncertain'
     and operation_row.submission_uncertain
  then
    return true;
  end if;
  if operation_row.status <> 'pending'
     or operation_row.provider_state <> 'error'
     or not operation_row.retryable
     or operation_row.submission_uncertain
     or operation_row.delivery_retry_claim_token is not null
     or operation_row.transaction_hash is not null
     or intent_row.destination_transaction_hash is not null
  then
    return false;
  end if;
  update public.funding_operations
  set delivery_retry_claim_token = claim_token,
      delivery_retry_attempt_no = delivery_retry_attempt_no + 1,
      status = 'submission_uncertain',
      submission_uncertain = true,
      retryable = false,
      updated_at = now()
  where id = target_operation_id
    and status = 'pending'
    and delivery_retry_claim_token is null;
  if not found then return false; end if;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.bridge_delivery_retry_boundary_acquired',
    'funding_operation', target_operation_id::text,
    jsonb_build_object(
      'fundingIntent', target_intent_id,
      'attempt', operation_row.delivery_retry_attempt_no + 1
    )
  );
  return true;
end $$;

create or replace function public.arm_source_deposit_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_deposit_id uuid,
  claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_deposit_id is null or claim_token is null
  then
    raise exception using errcode = '22023', detail = 'funding_wallet_claim_parameters_required';
  end if;
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row
  from public.funding_operations
  where id = target_deposit_id
    and funding_intent_id = target_intent_id
    and operation_type = 'deposit'
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'source_deposit_not_found';
  end if;
  if operation_row.wallet_claim_token is not distinct from claim_token
     and operation_row.status = 'submission_uncertain'
     and operation_row.submission_uncertain
  then
    return true;
  end if;
  if intent_row.funding_phase <> 'collecting_deposits'
     or operation_row.status <> 'awaiting_signature'
     or operation_row.wallet_claim_token is not null
     or operation_row.transaction_hash is not null
     or operation_row.recovery_state is not null
  then
    return false;
  end if;
  update public.funding_operations
  set wallet_claim_token = claim_token,
      released_wallet_claim_token = null,
      status = 'submission_uncertain',
      submission_uncertain = true,
      retryable = false,
      updated_at = now()
  where id = target_deposit_id
    and status = 'awaiting_signature'
    and wallet_claim_token is null;
  if not found then return false; end if;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.source_wallet_boundary_acquired',
    'funding_operation', target_deposit_id::text,
    jsonb_build_object('fundingIntent', target_intent_id)
  );
  return true;
end $$;

create or replace function public.observe_claimed_source_deposit_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_deposit_id uuid,
  claim_token uuid,
  observed_outcome text,
  observed_transaction_hash text,
  observed_failure_code text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  operation_row public.funding_operations%rowtype;
  normalized_hash text := lower(observed_transaction_hash);
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_deposit_id is null or claim_token is null
     or observed_outcome is null
  then
    raise exception using errcode = '22023', detail = 'source_deposit_observation_parameters_required';
  end if;
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select operation.* into operation_row
  from public.funding_operations operation
  join public.funding_intents intent on intent.id = operation.funding_intent_id
  where operation.id = target_deposit_id
    and operation.funding_intent_id = target_intent_id
    and intent.program_id = target_program_id
    and operation.operation_type = 'deposit'
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'source_deposit_not_found';
  end if;
  if operation_row.wallet_claim_token is not distinct from claim_token
     and operation_row.status = 'submitted'
     and not operation_row.submission_uncertain
     and observed_outcome = 'submitted'
  then
    if operation_row.transaction_hash is not distinct from normalized_hash then return false; end if;
    raise exception using errcode = '23514', detail = 'source_deposit_hash_locked';
  end if;
  if operation_row.wallet_claim_token is null
     or operation_row.wallet_claim_token is distinct from claim_token
     or operation_row.status <> 'submission_uncertain'
     or not operation_row.submission_uncertain
  then
    raise exception using errcode = '23514', detail = 'source_deposit_wallet_claim_not_owned';
  end if;
  if observed_outcome not in ('submitted','submission_uncertain')
     or (observed_outcome = 'submitted' and normalized_hash is null)
     or (normalized_hash is not null and normalized_hash !~ '^0x[0-9a-f]{64}$')
     or (
       operation_row.transaction_hash is not null
       and normalized_hash is not null
       and operation_row.transaction_hash is distinct from normalized_hash
     )
  then
    raise exception using errcode = '22023', detail = 'source_deposit_observation_invalid';
  end if;
  update public.funding_operations
  set transaction_hash = coalesce(transaction_hash, normalized_hash),
      status = observed_outcome,
      submission_uncertain = observed_outcome = 'submission_uncertain',
      failure_code = null,
      updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.attach_source_deposit_hash_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_deposit_id uuid,
  attached_transaction_hash text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  operation_row public.funding_operations%rowtype;
  normalized_hash text := lower(attached_transaction_hash);
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_deposit_id is null or normalized_hash is null
     or normalized_hash !~ '^0x[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', detail = 'source_deposit_attach_invalid';
  end if;
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select operation.* into operation_row
  from public.funding_operations operation
  join public.funding_intents intent on intent.id = operation.funding_intent_id
  where operation.id = target_deposit_id
    and operation.funding_intent_id = target_intent_id
    and intent.program_id = target_program_id
    and operation.operation_type = 'deposit'
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'source_deposit_not_found';
  end if;
  if operation_row.transaction_hash is not null then
    if operation_row.transaction_hash is not distinct from normalized_hash then return false; end if;
    raise exception using errcode = '23514', detail = 'source_deposit_hash_locked';
  end if;
  if operation_row.wallet_claim_token is null
     or operation_row.status <> 'submission_uncertain'
     or not operation_row.submission_uncertain
  then
    raise exception using errcode = '23514', detail = 'source_deposit_attach_not_allowed';
  end if;
  update public.funding_operations
  set transaction_hash = normalized_hash,
      status = 'submitted',
      submission_uncertain = false,
      retryable = false,
      updated_at = now()
  where id = target_deposit_id;
  return true;
end $$;

create or replace function public.release_rejected_send_attempt_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  claim_token uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null or claim_token is null
  then
    raise exception using errcode = '22023', detail = 'rejected_send_release_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row
  from public.funding_operations
  where id = target_operation_id and funding_intent_id = target_intent_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;
  if operation_row.status = 'awaiting_signature'
     and operation_row.wallet_claim_token is null
     and operation_row.released_wallet_claim_token is not distinct from claim_token
     and operation_row.transaction_hash is null
     and operation_row.transfer_id is null
  then
    return false;
  end if;
  if intent_row.route_mode <> 'send'
     or operation_row.operation_type <> 'send'
     or claim_token is null
     or operation_row.wallet_claim_token is distinct from claim_token
     or operation_row.status <> 'submission_uncertain'
     or not operation_row.submission_uncertain
     or operation_row.transaction_hash is not null
     or operation_row.transfer_id is not null
     or operation_row.recovery_state is not null
     or intent_row.destination_transaction_hash is not null
     or exists (
       select 1 from jsonb_array_elements(operation_row.steps) step
       where coalesce(step->>'transactionHash', '') <> ''
          or coalesce(step->>'state', 'pending') <> 'pending'
     )
  then
    raise exception using errcode = '23514', detail = 'rejected_send_release_not_proven';
  end if;

  update public.funding_operations
  set status = 'awaiting_signature',
      wallet_claim_token = null,
      released_wallet_claim_token = claim_token,
      submission_uncertain = false,
      retryable = true,
      failure_code = null,
      updated_at = now()
  where id = target_operation_id;
  update public.funding_intents
  set status = 'awaiting_signature',
      failure_code = null,
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.send_signature_rejected', 'funding_operation',
    target_operation_id::text,
    jsonb_build_object('fundingIntent', target_intent_id, 'broadcastEvidence', false)
  );
  return true;
end $$;

create or replace function public.attach_funding_destination_hash_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  attached_transaction_hash text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null
     or attached_transaction_hash is null
     or lower(attached_transaction_hash) !~ '^0x[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', detail = 'funding_destination_attach_invalid';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row
  from public.funding_operations
  where id = target_operation_id
    and funding_intent_id = target_intent_id
    and operation_type in ('send','bridge','spend')
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_destination_attempt_not_found';
  end if;
  if operation_row.transaction_hash is not null then
    if operation_row.transaction_hash = lower(attached_transaction_hash)
       and intent_row.destination_transaction_hash = lower(attached_transaction_hash)
    then
      return false;
    end if;
    raise exception using errcode = '23514', detail = 'funding_destination_hash_locked';
  end if;
  if intent_row.destination_transaction_hash is not null
     and intent_row.destination_transaction_hash <> lower(attached_transaction_hash)
  then
    raise exception using errcode = '23514', detail = 'funding_destination_hash_locked';
  end if;
  if operation_row.wallet_claim_token is null
     or not (
       (
         operation_row.status = 'submission_uncertain'
         and operation_row.submission_uncertain
       )
       or (
         operation_row.operation_type = 'bridge'
         and operation_row.status = 'pending'
         and not operation_row.submission_uncertain
         and intent_row.status = 'source_submitted'
       )
     )
  then
    raise exception using errcode = '23514', detail = 'funding_destination_attach_not_allowed';
  end if;
  update public.funding_operations
  set transaction_hash = lower(attached_transaction_hash),
      status = 'submitted',
      submission_uncertain = false,
      retryable = false,
      updated_at = now()
  where id = target_operation_id;
  update public.funding_intents
  set destination_transaction_hash = lower(attached_transaction_hash),
      status = 'destination_submitted',
      updated_at = now()
  where id = target_intent_id;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.destination_hash_attached',
    'funding_operation', target_operation_id::text,
    jsonb_build_object('fundingIntent', target_intent_id)
  );
  return true;
end $$;

create or replace function public.observe_claimed_funding_destination_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  claim_token uuid,
  observed_outcome text,
  observed_provider_operation_id text,
  observed_destination_hash text,
  observed_transfer_id text,
  observed_source_hashes jsonb,
  observed_provider_state text,
  observed_retryable boolean,
  observed_steps jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  operation_kind text;
  normalized_destination_hash text := lower(observed_destination_hash);
  telemetry_steps jsonb;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  operation_kind := case intent_row.route_mode
    when 'send' then 'send'
    when 'bridge' then 'bridge'
    else 'spend'
  end;
  select * into operation_row
  from public.funding_operations
  where id = target_operation_id
    and funding_intent_id = target_intent_id
    and operation_type = operation_kind
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;
  if claim_token is null
     or operation_row.wallet_claim_token is null
     or operation_row.wallet_claim_token is distinct from claim_token
  then
    raise exception using errcode = '23514', detail = 'funding_wallet_claim_not_owned';
  end if;
  if operation_row.status in ('failed','confirmed') then
    raise exception using errcode = '23514', detail = 'funding_operation_terminal';
  end if;
  if observed_outcome is null
     or observed_provider_state is null
     or observed_outcome not in ('submitted','submission_uncertain','provider_progress')
     or observed_provider_state not in ('pending','success','error')
     or jsonb_typeof(coalesce(observed_source_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 32
     or jsonb_typeof(coalesce(observed_steps, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(observed_steps, '[]'::jsonb)) > 32
     or (
       observed_outcome = 'submitted'
       and (
         normalized_destination_hash is null
         or normalized_destination_hash !~ '^0x[0-9a-f]{64}$'
       )
     )
     or (
       observed_outcome = 'submission_uncertain'
       and observed_destination_hash is not null
     )
      or exists (
        select 1
       from jsonb_array_elements_text(
         coalesce(observed_source_hashes, '[]'::jsonb)
       ) source_hash(value)
        where source_hash.value !~ '^0x[0-9a-fA-F]{64}$'
      )
     or (
       select count(distinct lower(source_hash.value))
       from jsonb_array_elements_text(
         coalesce(observed_source_hashes, '[]'::jsonb)
       ) source_hash(value)
     ) <> jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb))
     or (
       normalized_destination_hash is not null
       and exists (
         select 1
         from jsonb_array_elements_text(
           coalesce(observed_source_hashes, '[]'::jsonb)
         ) source_hash(value)
         where lower(source_hash.value) = normalized_destination_hash
       )
     )
     or (
       operation_kind = 'spend'
       and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0
       and (
         jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb))
           <> jsonb_array_length(coalesce(observed_steps, '[]'::jsonb))
          or (
            select count(distinct step->>'network')
            from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
          ) <> jsonb_array_length(coalesce(observed_steps, '[]'::jsonb))
          or (
            select count(distinct lower(step->>'transactionHash'))
            from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
          ) <> jsonb_array_length(coalesce(observed_steps, '[]'::jsonb))
          or exists (
           select 1
           from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
           where step->>'network' is null
              or not exists (
                select 1
                from jsonb_array_elements(intent_row.sources) source
                where source->>'network' = step->>'network'
              )
              or not exists (
                select 1
                from jsonb_array_elements_text(
                  coalesce(observed_source_hashes, '[]'::jsonb)
                ) source_hash(value)
                where lower(source_hash.value) = lower(step->>'transactionHash')
              )
          )
          or exists (
            select 1
            from jsonb_array_elements_text(
              coalesce(observed_source_hashes, '[]'::jsonb)
            ) source_hash(value)
            where (
              select count(*)
              from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
              where lower(step->>'transactionHash') = lower(source_hash.value)
            ) <> 1
          )
        )
      )
  then
    raise exception using errcode = '22023', detail = 'funding_operation_observation_invalid';
  end if;
  if operation_row.transaction_hash is not null
     and normalized_destination_hash is not null
     and operation_row.transaction_hash <> normalized_destination_hash
  then
    raise exception using errcode = '22023', detail = 'funding_destination_mismatch';
  end if;
  if intent_row.destination_transaction_hash is not null
     and normalized_destination_hash is not null
     and intent_row.destination_transaction_hash <> normalized_destination_hash
  then
    raise exception using errcode = '22023', detail = 'funding_destination_mismatch';
  end if;
  if operation_row.transfer_id is not null
     and observed_transfer_id is not null
     and operation_row.transfer_id <> observed_transfer_id
  then
    raise exception using errcode = '22023', detail = 'funding_transfer_id_mismatch';
  end if;
  if operation_row.status in ('submitted','pending')
     and observed_outcome = 'submission_uncertain'
  then
    raise exception using errcode = '22023', detail = 'funding_operation_state_regression';
  end if;

  telemetry_steps := coalesce(observed_steps, '[]'::jsonb) ||
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', 'source_transaction',
        'state', 'success',
        'transactionHash', lower(source_hash.value)
      ))
      from jsonb_array_elements_text(
        coalesce(observed_source_hashes, '[]'::jsonb)
      ) source_hash(value)
      where not exists (
        select 1
        from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
        where lower(step->>'transactionHash') = lower(source_hash.value)
      )
    ), '[]'::jsonb);

  if jsonb_array_length(telemetry_steps) > 32 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;
  if exists (
       select 1 from jsonb_array_elements(telemetry_steps) step
       where coalesce(step->>'name', '') = ''
          or step->>'state' not in ('pending','success','error')
          or (
            step->>'transactionHash' is not null
            and lower(step->>'transactionHash') !~ '^0x[0-9a-f]{64}$'
          )
     )
     or (
       select count(distinct case
         when step->>'transactionHash' is not null
           then 'tx:' || lower(step->>'transactionHash')
         else 'name:' || lower(step->>'name')
       end)
       from jsonb_array_elements(telemetry_steps) step
     ) <> jsonb_array_length(telemetry_steps)
     or exists (
       select 1
       from jsonb_array_elements(operation_row.steps) old_step
       join jsonb_array_elements(telemetry_steps) new_step
         on case
           when old_step->>'transactionHash' is not null
             then 'tx:' || lower(old_step->>'transactionHash')
           else 'name:' || lower(old_step->>'name')
         end = case
           when new_step->>'transactionHash' is not null
             then 'tx:' || lower(new_step->>'transactionHash')
           else 'name:' || lower(new_step->>'name')
         end
       where old_step->>'state' in ('success','error') and old_step <> new_step
     )
  then
    raise exception using errcode = '23514', detail = 'funding_operation_evidence_conflict';
  end if;
  select coalesce(jsonb_agg(step), '[]'::jsonb) into telemetry_steps
  from (
    select new_step step from jsonb_array_elements(telemetry_steps) new_step
    union all
    select old_step step from jsonb_array_elements(operation_row.steps) old_step
    where not exists (
      select 1 from jsonb_array_elements(telemetry_steps) new_step
      where case
        when new_step->>'transactionHash' is not null
          then 'tx:' || lower(new_step->>'transactionHash')
        else 'name:' || lower(new_step->>'name')
      end = case
        when old_step->>'transactionHash' is not null
          then 'tx:' || lower(old_step->>'transactionHash')
        else 'name:' || lower(old_step->>'name')
      end
    )
  ) merged;
  if jsonb_array_length(telemetry_steps) > 32 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;

  update public.funding_operations
  set operation_id = case
        when observed_provider_operation_id is null
          or observed_provider_operation_id = ''
        then operation_id
        else 'client:' || observed_provider_operation_id
      end,
      transaction_hash = coalesce(transaction_hash, normalized_destination_hash),
      transfer_id = coalesce(transfer_id, observed_transfer_id),
      delivery_retry_claim_token = case
        when normalized_destination_hash is not null then null
        else delivery_retry_claim_token
      end,
      status = case
        when observed_outcome = 'submission_uncertain' then 'submission_uncertain'
        else 'pending'
      end,
      provider_state = observed_provider_state,
      retryable = coalesce(observed_retryable, false),
      submission_uncertain = observed_outcome = 'submission_uncertain',
      steps = case
        when jsonb_array_length(telemetry_steps) = 0 then steps
        else telemetry_steps
      end,
      updated_at = now()
  where id = target_operation_id;

  update public.funding_intents
  set destination_transaction_hash = coalesce(
        destination_transaction_hash,
        normalized_destination_hash
      ),
      transfer_id = coalesce(transfer_id, observed_transfer_id),
      status = case
        when normalized_destination_hash is not null then 'delivery_pending'
        else 'source_submitted'
      end,
      failure_code = null,
      updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

create or replace function public.attach_funding_recovery_telemetry_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  observed_provider_state text,
  observed_retryable boolean,
  observed_source_hashes jsonb,
  observed_unbound_hashes jsonb,
  observed_steps jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  telemetry_steps jsonb;
  merged_unbound jsonb;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null or observed_provider_state is null
     or observed_provider_state not in ('pending','success','error')
     or observed_retryable is null
     or jsonb_typeof(coalesce(observed_source_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_unbound_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_steps, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(observed_steps, '[]'::jsonb)) > 32
     or jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb))
        + jsonb_array_length(coalesce(observed_unbound_hashes, '[]'::jsonb)) > 32
  then
    raise exception using errcode = '22023', detail = 'funding_recovery_telemetry_invalid';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row from public.funding_intents
  where id = target_intent_id and program_id = target_program_id for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row from public.funding_operations
  where id = target_operation_id and funding_intent_id = target_intent_id
    and operation_type in ('bridge','spend') for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;
  if operation_row.wallet_claim_token is null
     or operation_row.status not in ('submission_uncertain','pending','submitted')
     or (
       operation_row.operation_type <> 'bridge'
       and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0
     )
     or (
       operation_row.operation_type <> 'spend'
       and jsonb_array_length(coalesce(observed_unbound_hashes, '[]'::jsonb)) > 0
     )
     or exists (
       select 1 from jsonb_array_elements_text(
         coalesce(observed_source_hashes, '[]'::jsonb)
         || coalesce(observed_unbound_hashes, '[]'::jsonb)
       ) hash(value)
       where hash.value !~ '^0x[0-9a-fA-F]{64}$'
     )
     or (
       select count(distinct lower(hash.value))
       from jsonb_array_elements_text(
         coalesce(observed_source_hashes, '[]'::jsonb)
         || coalesce(observed_unbound_hashes, '[]'::jsonb)
       ) hash(value)
     ) <> jsonb_array_length(
       coalesce(observed_source_hashes, '[]'::jsonb)
       || coalesce(observed_unbound_hashes, '[]'::jsonb)
     )
  then
    raise exception using errcode = '23514', detail = 'funding_recovery_telemetry_not_attachable';
  end if;

  telemetry_steps := coalesce(observed_steps, '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object(
      'name', 'source_transaction',
      'state', 'success',
      'network', intent_row.sources->0->>'network',
      'transactionHash', lower(hash.value)
    ))
    from jsonb_array_elements_text(coalesce(observed_source_hashes, '[]'::jsonb)) hash(value)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
      where lower(coalesce(step->>'transactionHash', '')) = lower(hash.value)
    )
  ), '[]'::jsonb);
  if jsonb_array_length(telemetry_steps) > 32 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;
  if operation_row.transaction_hash is not null and (
       exists (
         select 1 from jsonb_array_elements_text(coalesce(observed_source_hashes, '[]'::jsonb)) hash(value)
         where lower(hash.value) = operation_row.transaction_hash
       )
       or exists (
         select 1 from jsonb_array_elements_text(coalesce(observed_unbound_hashes, '[]'::jsonb)) hash(value)
         where lower(hash.value) = operation_row.transaction_hash
       )
     )
     or exists (
       select 1 from jsonb_array_elements_text(coalesce(observed_source_hashes, '[]'::jsonb)) hash(value)
       where exists (
         select 1 from jsonb_array_elements_text(operation_row.unbound_transaction_hashes) existing(value)
         where lower(existing.value) = lower(hash.value)
       )
     )
     or exists (
       select 1 from jsonb_array_elements_text(coalesce(observed_unbound_hashes, '[]'::jsonb)) hash(value)
       where exists (
         select 1 from jsonb_array_elements(operation_row.steps || telemetry_steps) step
         where lower(coalesce(step->>'transactionHash', '')) = lower(hash.value)
       )
     )
  then
    raise exception using errcode = '23514', detail = 'funding_recovery_evidence_identity_conflict';
  end if;
  if exists (
       select 1
       from jsonb_array_elements(operation_row.steps) old_step
       join jsonb_array_elements(telemetry_steps) new_step
         on coalesce(
           'tx:' || lower(old_step->>'transactionHash'),
           'name:' || lower(old_step->>'name')
         ) = coalesce(
           'tx:' || lower(new_step->>'transactionHash'),
           'name:' || lower(new_step->>'name')
         )
       where old_step->>'state' in ('success','error') and old_step <> new_step
     )
  then
    raise exception using errcode = '23514', detail = 'funding_operation_evidence_conflict';
  end if;
  select coalesce(jsonb_agg(step), '[]'::jsonb) into telemetry_steps
  from (
    select new_step step from jsonb_array_elements(telemetry_steps) new_step
    union all
    select old_step step from jsonb_array_elements(operation_row.steps) old_step
    where not exists (
      select 1 from jsonb_array_elements(telemetry_steps) new_step
      where coalesce(
        'tx:' || lower(new_step->>'transactionHash'),
        'name:' || lower(new_step->>'name')
      ) = coalesce(
        'tx:' || lower(old_step->>'transactionHash'),
        'name:' || lower(old_step->>'name')
      )
    )
  ) merged;
  if jsonb_array_length(telemetry_steps) > 32 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;
  select coalesce(jsonb_agg(value order by value), '[]'::jsonb) into merged_unbound
  from (
    select distinct lower(value) value
    from jsonb_array_elements_text(
      operation_row.unbound_transaction_hashes || coalesce(observed_unbound_hashes, '[]'::jsonb)
    )
  ) hashes;
  if jsonb_array_length(merged_unbound) > 32 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;
  if (
    select count(*) from (
      select operation_row.transaction_hash hash
      where operation_row.transaction_hash is not null
      union
      select lower(step->>'transactionHash')
      from jsonb_array_elements(telemetry_steps) step
      where step->>'transactionHash' is not null
      union
      select lower(value) from jsonb_array_elements_text(merged_unbound)
    ) identities
  ) > 33 then
    raise exception using errcode = '22023', detail = 'funding_operation_evidence_limit_exceeded';
  end if;

  update public.funding_operations
  set provider_state = observed_provider_state,
      retryable = observed_retryable,
      steps = case when jsonb_array_length(telemetry_steps) = 0 then steps else telemetry_steps end,
      unbound_transaction_hashes = merged_unbound,
      status = case
        when status = 'submission_uncertain'
          and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0
        then 'pending'
        else status
      end,
      submission_uncertain = case
        when jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0 then false
        else submission_uncertain
      end,
      updated_at = now()
  where id = target_operation_id;
  if intent_row.destination_transaction_hash is null then
    update public.funding_intents set status = 'source_submitted', updated_at = now()
    where id = target_intent_id;
  end if;
  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.recovery_telemetry_attached', 'funding_operation',
    target_operation_id::text,
    jsonb_build_object(
      'fundingIntent', target_intent_id,
      'sourceHashCount', jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)),
      'unboundHashCount', jsonb_array_length(coalesce(observed_unbound_hashes, '[]'::jsonb))
    )
  );
  return true;
end $$;

create or replace function public.record_funding_recovery_poll_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  checked_transaction_hash text,
  checked_state text,
  checked_block_number bigint,
  checked_block_hash text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  check_row public.funding_operation_recovery_checks%rowtype;
  matched_step jsonb;
  classified_role text;
  classified_network text;
  normalized_hash text := lower(checked_transaction_hash);
  deterministic_failure_code text;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null or checked_transaction_hash is null
     or checked_state is null
  then
    raise exception using errcode = '22023', detail = 'funding_recovery_poll_parameters_required';
  end if;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':recovery', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row
  from public.funding_intents
  where id = target_intent_id and program_id = target_program_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row
  from public.funding_operations
  where id = target_operation_id and funding_intent_id = target_intent_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;
  if normalized_hash !~ '^0x[0-9a-f]{64}$'
     or checked_state not in ('pending','success','reverted')
     or (
       operation_row.transaction_hash is distinct from normalized_hash
       and not exists (
         select 1
         from jsonb_array_elements(operation_row.steps) step
         where lower(coalesce(step->>'transactionHash', '')) = normalized_hash
       )
     )
     or (
       checked_state in ('success','reverted')
       and (checked_block_number is null or checked_block_hash is null)
     )
     or (
       checked_state = 'pending'
       and (checked_block_number is not null or checked_block_hash is not null)
     )
     or (
       checked_block_hash is not null
       and lower(checked_block_hash) !~ '^0x[0-9a-f]{64}$'
     )
  then
    raise exception using errcode = '22023', detail = 'funding_recovery_poll_invalid';
  end if;

  if operation_row.operation_type = 'deposit'
     and operation_row.transaction_hash is not distinct from normalized_hash
  then
    classified_role := 'source';
    classified_network := operation_row.source_chain;
  elsif operation_row.transaction_hash is not distinct from normalized_hash then
    classified_role := 'destination';
    classified_network := 'Arc_Testnet';
  else
    select step into matched_step
    from jsonb_array_elements(operation_row.steps) step
    where lower(coalesce(step->>'transactionHash', '')) = normalized_hash
    limit 1;
    if matched_step is null then
      raise exception using errcode = '22023', detail = 'funding_recovery_hash_not_authoritatively_bound';
    end if;
    classified_role := 'source';
    classified_network := nullif(matched_step->>'network', '');
    if classified_network is null and operation_row.operation_type = 'bridge' then
      classified_network := intent_row.sources->0->>'network';
    end if;
    if classified_network is null then
      raise exception using errcode = '22023', detail = 'funding_recovery_source_network_unbound';
    end if;
  end if;
  if operation_row.status = 'confirmed' and checked_state = 'reverted' then
    raise exception using errcode = '23514', detail = 'funding_recovery_terminal_status_conflict';
  end if;

  select * into check_row
  from public.funding_operation_recovery_checks
  where funding_operation_id = target_operation_id
    and transaction_hash = normalized_hash
  for update;
  if found and check_row.state in ('success','reverted') then
    if check_row.state = checked_state
       and check_row.block_number is not distinct from checked_block_number
       and check_row.block_hash is not distinct from lower(checked_block_hash)
    then
      return false;
    end if;
    raise exception using errcode = '23514', detail = 'funding_recovery_hash_evidence_locked';
  end if;

  insert into public.funding_operation_recovery_checks (
    funding_operation_id, transaction_hash, evidence_role, network,
    state, block_number, block_hash, checked_at
  ) values (
    target_operation_id, normalized_hash, classified_role, classified_network,
    checked_state, checked_block_number, lower(checked_block_hash), now()
  )
  on conflict (funding_operation_id, transaction_hash) do update
  set state = excluded.state,
      block_number = excluded.block_number,
      block_hash = excluded.block_hash,
      checked_at = excluded.checked_at;

  update public.funding_operations
  set recovery_checked_at = now(),
      recovery_transaction_hash = normalized_hash,
      recovery_state = checked_state,
      recovery_block_number = checked_block_number,
      recovery_block_hash = lower(checked_block_hash),
      updated_at = now()
  where id = target_operation_id;

  if checked_state = 'reverted'
     and operation_row.status not in ('failed','confirmed')
  then
    deterministic_failure_code := case
      when operation_row.transaction_hash = normalized_hash
      then 'server.funding_destination_reverted'
      else 'server.funding_source_reverted'
    end;
    update public.funding_operations
    set status = 'failed',
        provider_state = 'error',
        retryable = false,
        submission_uncertain = false,
        failure_code = deterministic_failure_code,
        updated_at = now()
    where id = target_operation_id;
    update public.funding_intents
    set destination_transaction_hash = case
          when destination_transaction_hash = normalized_hash then null
          else destination_transaction_hash
        end,
        transfer_id = case
          when destination_transaction_hash = normalized_hash then null
          else transfer_id
        end,
        status = case
          when route_mode = 'send' then 'ready_to_sign'
          else 'source_submitted'
        end,
        failure_code = null,
        reconcile_lease_id = null,
        reconcile_lease_expires_at = null,
        updated_at = now()
    where id = target_intent_id;
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'funding.recovery_polled', 'funding_operation',
    target_operation_id::text,
    jsonb_build_object(
      'fundingIntent', target_intent_id,
      'transactionHash', normalized_hash,
      'evidenceRole', classified_role,
      'network', classified_network,
      'state', checked_state,
      'hasBlockEvidence', checked_block_number is not null,
      'blockNumber', checked_block_number,
      'blockHash', lower(checked_block_hash)
    )
  );
  return true;
end $$;

revoke all on function public.cancel_funding_intent_atomic(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.release_rejected_send_attempt_atomic(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_funding_destination_checked_atomic(
  uuid,uuid,uuid,timestamp with time zone,jsonb
) from public, anon, authenticated;
revoke all on function public.reopen_funding_source_collection_atomic(
  uuid,uuid,uuid,timestamp with time zone,jsonb
) from public, anon, authenticated;
revoke all on function public.create_funding_destination_replacement_atomic(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.claim_funding_destination_attempt_atomic(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.arm_funding_destination_attempt_atomic(uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.arm_bridge_delivery_retry_atomic(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.arm_source_deposit_atomic(uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.observe_claimed_source_deposit_atomic(
  uuid,uuid,uuid,uuid,uuid,text,text,text
) from public, anon, authenticated;
revoke all on function public.attach_source_deposit_hash_atomic(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.attach_funding_destination_hash_atomic(uuid,uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.observe_claimed_funding_destination_atomic(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text,boolean,jsonb
) from public, anon, authenticated;
revoke all on function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) from public, anon, authenticated;
revoke all on function public.record_funding_recovery_poll_atomic(
  uuid,uuid,uuid,uuid,text,text,bigint,text
) from public, anon, authenticated;
revoke all on function public.set_funding_operation_idempotency_key()
  from public, anon, authenticated;
revoke all on function public.link_confirmed_source_deposit_top_up()
  from public, anon, authenticated;
revoke all on function public.validate_funding_fee_components()
  from public, anon, authenticated;
revoke all on function public.enforce_funding_intent_locked_identity()
  from public, anon, authenticated;
revoke all on function public.audit_funding_operation_recovery_transition()
  from public, anon, authenticated;
revoke all on function public.audit_funding_intent_recovery_transition()
  from public, anon, authenticated;
grant execute on function public.cancel_funding_intent_atomic(uuid,uuid,uuid)
  to service_role;
grant execute on function public.release_rejected_send_attempt_atomic(uuid,uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.prepare_funding_destination_checked_atomic(
  uuid,uuid,uuid,timestamp with time zone,jsonb
) to service_role;
grant execute on function public.reopen_funding_source_collection_atomic(
  uuid,uuid,uuid,timestamp with time zone,jsonb
) to service_role;
grant execute on function public.create_funding_destination_replacement_atomic(uuid,uuid,uuid)
  to service_role;
grant execute on function public.claim_funding_destination_attempt_atomic(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.arm_funding_destination_attempt_atomic(uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.arm_bridge_delivery_retry_atomic(uuid,uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.arm_source_deposit_atomic(uuid,uuid,uuid,uuid,uuid)
  to service_role;
grant execute on function public.observe_claimed_source_deposit_atomic(
  uuid,uuid,uuid,uuid,uuid,text,text,text
) to service_role;
grant execute on function public.attach_source_deposit_hash_atomic(uuid,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.attach_funding_destination_hash_atomic(uuid,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.observe_claimed_funding_destination_atomic(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,text,boolean,jsonb
) to service_role;
grant execute on function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) to service_role;
grant execute on function public.record_funding_recovery_poll_atomic(
  uuid,uuid,uuid,uuid,text,text,bigint,text
) to service_role;
