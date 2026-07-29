-- CP-13 security boundary:
-- 1. A browser wallet must prove control of the immutable owner address before
--    a Circle contract deployment record can be created or resumed.
-- 2. Remaining escrow funds may only be withdrawn after the product lifecycle
--    has reached an ended state. The status check is performed while holding
--    the same program-row lock used to create the withdrawal intent.

create table public.escrow_wallet_control_challenges (
  id uuid primary key,
  program_id uuid not null references public.programs(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  owner_wallet text not null
    check (
      owner_wallet = lower(owner_wallet)
      and owner_wallet ~ '^0x[0-9a-f]{40}$'
      and owner_wallet <> '0x0000000000000000000000000000000000000000'
    ),
  withdraw_recipient text not null
    check (
      withdraw_recipient = lower(withdraw_recipient)
      and withdraw_recipient ~ '^0x[0-9a-f]{40}$'
      and withdraw_recipient <> '0x0000000000000000000000000000000000000000'
    ),
  chain_id bigint not null default 5042002 check (chain_id = 5042002),
  nonce text not null unique
    check (nonce = lower(nonce) and nonce ~ '^0x[0-9a-f]{64}$'),
  issued_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  invalidated_at timestamp with time zone,
  consumed_at timestamp with time zone,
  deployment_id uuid unique references public.escrow_contracts(id) on delete restrict,
  created_at timestamp with time zone not null default now(),
  check (expires_at > issued_at),
  check ((consumed_at is null) = (deployment_id is null))
);

create index escrow_wallet_control_challenges_program_actor_idx
  on public.escrow_wallet_control_challenges(program_id, actor_id, created_at desc);

alter table public.escrow_wallet_control_challenges enable row level security;
revoke all on public.escrow_wallet_control_challenges from public, anon, authenticated;
grant select, insert, update on public.escrow_wallet_control_challenges to service_role;
create policy authenticated_user_must_be_active
  on public.escrow_wallet_control_challenges
  as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));

create or replace function public.create_escrow_wallet_challenge_atomic(
  target_challenge_id uuid,
  actor_id uuid,
  target_program_id uuid,
  target_owner_wallet text,
  target_withdraw_recipient text,
  target_nonce text,
  target_issued_at timestamp with time zone,
  target_expires_at timestamp with time zone
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':wallet-control', 0)
  );
  if not exists (
    select 1
    from public.programs
    where id = target_program_id and owner_id = actor_id
    for update
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  if target_owner_wallet <> lower(target_owner_wallet)
     or target_owner_wallet !~ '^0x[0-9a-f]{40}$'
     or target_owner_wallet = '0x0000000000000000000000000000000000000000'
     or target_withdraw_recipient <> lower(target_withdraw_recipient)
     or target_withdraw_recipient !~ '^0x[0-9a-f]{40}$'
     or target_withdraw_recipient = '0x0000000000000000000000000000000000000000'
  then
    raise exception using errcode = '22023', detail = 'wallet_control_address_invalid';
  end if;
  if target_nonce <> lower(target_nonce) or target_nonce !~ '^0x[0-9a-f]{64}$' then
    raise exception using errcode = '22023', detail = 'wallet_control_nonce_invalid';
  end if;
  if target_issued_at > statement_timestamp() + interval '30 seconds'
     or target_issued_at < statement_timestamp() - interval '1 minute'
     or target_expires_at <= statement_timestamp()
     or target_expires_at > target_issued_at + interval '10 minutes'
  then
    raise exception using errcode = '22023', detail = 'wallet_control_challenge_window_invalid';
  end if;

  update public.escrow_wallet_control_challenges as challenge
  set invalidated_at = statement_timestamp()
  where challenge.program_id = target_program_id
    and challenge.actor_id = create_escrow_wallet_challenge_atomic.actor_id
    and challenge.consumed_at is null
    and challenge.invalidated_at is null;

  insert into public.escrow_wallet_control_challenges (
    id, program_id, actor_id, owner_wallet, withdraw_recipient, nonce, issued_at, expires_at
  ) values (
    target_challenge_id, target_program_id, actor_id, lower(target_owner_wallet),
    lower(target_withdraw_recipient), lower(target_nonce), target_issued_at, target_expires_at
  );
  return target_challenge_id;
end $$;

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
  deployment_row public.escrow_contracts%rowtype;
  program_deadline timestamp with time zone;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_program_id::text || ':5042002', 0)
  );
  select deadline into program_deadline
  from public.programs
  where id = target_program_id and owner_id = actor_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  if program_deadline is null then
    raise exception using errcode = '23514', detail = 'program_deadline_required_for_escrow';
  end if;
  if target_refund_unlock_at <> program_deadline then
    raise exception using errcode = '22023', detail = 'refund_unlock_must_equal_program_deadline';
  end if;

  select * into challenge_row
  from public.escrow_wallet_control_challenges
  where id = target_wallet_challenge_id
  for update;
  if not found
     or challenge_row.program_id <> target_program_id
     or challenge_row.actor_id <> actor_id
  then
    raise exception using errcode = 'P0002', detail = 'wallet_control_challenge_not_found';
  end if;
  if challenge_row.owner_wallet <> lower(target_owner_wallet)
     or challenge_row.withdraw_recipient <> lower(target_withdraw_recipient)
     or challenge_row.chain_id <> 5042002
  then
    raise exception using errcode = '22023', detail = 'wallet_control_challenge_binding_mismatch';
  end if;
  if challenge_row.invalidated_at is not null then
    raise exception using errcode = '23514', detail = 'wallet_control_challenge_invalidated';
  end if;
  if challenge_row.expires_at <= statement_timestamp() then
    raise exception using errcode = '23514', detail = 'wallet_control_challenge_expired';
  end if;
  if challenge_row.consumed_at is not null then
    raise exception using errcode = '23505', detail = 'wallet_control_challenge_replayed';
  end if;

  select * into deployment_row
  from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002
  for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
       or deployment_row.owner_wallet is distinct from lower(target_owner_wallet)
       or deployment_row.withdraw_recipient is distinct from lower(target_withdraw_recipient)
       or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at
       or deployment_row.artifact_checksum is distinct from lower(target_artifact_checksum)
       or deployment_row.runtime_bytecode_checksum is distinct from lower(target_runtime_checksum)
    then
      raise exception using errcode = '22023', detail = 'escrow_deployment_parameters_locked';
    end if;
  else
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
    ) returning * into deployment_row;
  end if;

  update public.escrow_wallet_control_challenges
  set consumed_at = statement_timestamp(), deployment_id = deployment_row.id
  where id = target_wallet_challenge_id;
  return deployment_row.id;
end $$;

-- Expand/contract deployment compatibility:
-- The previous production image still calls this RPC. Keep service_role access
-- for exactly one rollback window while the new HTTP API exclusively uses the
-- wallet-proof RPC above. Public browser roles remain denied. A later release,
-- whose previous image no longer depends on this function, may remove the
-- service_role grant in a separate cleanup migration.
revoke all on function public.create_escrow_deployment_atomic(
  uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.create_escrow_deployment_atomic(
  uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) to service_role;
comment on function public.create_escrow_deployment_atomic(
  uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) is
  'Temporary previous-image rollback compatibility. New API code must use create_escrow_deployment_with_wallet_proof_atomic; remove this service_role grant only in a later release.';

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

  select * into escrow_row
  from public.escrow_contracts
  where program_id = target_program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
  for update;
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

  select * into existing_row
  from public.withdrawal_intents
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
    select 1
    from public.withdrawal_intents
    where escrow_contract_id = escrow_row.id and status not in ('complete','failed')
  ) then
    raise exception using errcode = '23505', detail = 'withdrawal_intent_already_active';
  end if;

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

revoke all on function public.create_escrow_wallet_challenge_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.create_escrow_deployment_with_wallet_proof_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) from public, anon, authenticated;
grant execute on function public.create_escrow_wallet_challenge_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,timestamp with time zone
) to service_role;
grant execute on function public.create_escrow_deployment_with_wallet_proof_atomic(
  uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid
) to service_role;
