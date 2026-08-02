-- CP-13: bounded recovery for provider-side deployment validation failures.
-- A Circle idempotency key is immutable for one provider attempt.  Only a
-- request rejected before Circle returns identifiers may be retried with a new
-- key, and the database enforces a single rotation.

alter table public.escrow_contracts
  add column if not exists deployment_attempt smallint not null default 1,
  add column if not exists deployment_request_hash text;

alter table public.escrow_contracts
  add constraint escrow_contracts_deployment_attempt_check
    check (deployment_attempt between 1 and 2),
  add constraint escrow_contracts_deployment_request_hash_check
    check (
      deployment_request_hash is null
      or deployment_request_hash ~ '^0x[0-9a-f]{64}$'
    );

-- New server deployments persist the immutable request fingerprint.  The old
-- overload remains available for already deployed clients, but the API uses
-- this overload so an idempotency key can never be silently reused for a
-- different artifact or constructor payload.
create or replace function public.create_escrow_deployment_server_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_program_key text,
  target_platform_admin_wallet text,
  target_program_owner_wallet text,
  target_withdraw_recipient text,
  target_refund_unlock_at timestamptz,
  target_artifact_checksum text,
  target_runtime_checksum text,
  target_immutable_references jsonb,
  target_idempotency_key uuid,
  target_request_hash text,
  target_fee_quote_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  deployment_row public.escrow_contracts%rowtype;
  program_deadline timestamptz;
begin
  if target_request_hash is null
     or target_request_hash !~ '^0x[0-9a-fA-F]{64}$'
  then
    raise exception using errcode = '22023', detail = 'escrow_deployment_request_hash_required';
  end if;

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
  if program_deadline is null or target_refund_unlock_at <> program_deadline then
    raise exception using errcode = '22023', detail = 'refund_unlock_must_equal_program_deadline';
  end if;
  if target_program_owner_wallet !~ '^0x[0-9a-fA-F]{40}$'
     or lower(target_program_owner_wallet) = '0x0000000000000000000000000000000000000000'
  then
    raise exception using errcode = '22023', detail = 'program_owner_wallet_required';
  end if;
  if target_withdraw_recipient is distinct from lower(target_program_owner_wallet) then
    raise exception using errcode = '22023', detail = 'withdraw_recipient_must_equal_program_owner';
  end if;
  if not exists (
    select 1
    from public.escrow_deployment_fee_quotes
    where id = target_fee_quote_id
      and program_id = target_program_id
      and status in ('paid', 'waived')
  ) then
    raise exception using errcode = '42501', detail = 'deployment_fee_payment_required';
  end if;

  select * into deployment_row
  from public.escrow_contracts
  where program_id = target_program_id and chain_id = 5042002
  for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
       or coalesce(deployment_row.platform_admin_wallet, '')
          is distinct from lower(target_platform_admin_wallet)
       or coalesce(deployment_row.owner_wallet, '')
          is distinct from lower(target_program_owner_wallet)
       or deployment_row.withdraw_recipient is distinct from lower(target_withdraw_recipient)
       or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at
       or (
         deployment_row.deployment_request_hash is not null
         and deployment_row.deployment_request_hash is distinct from lower(target_request_hash)
       )
    then
      raise exception using errcode = '22023', detail = 'escrow_deployment_parameters_locked';
    end if;
    update public.escrow_contracts
    set deployment_fee_quote_id = target_fee_quote_id,
        platform_admin_wallet = lower(target_platform_admin_wallet),
        deployment_request_hash = coalesce(
          deployment_row.deployment_request_hash,
          lower(target_request_hash)
        )
    where id = deployment_row.id;
  else
    insert into public.escrow_contracts (
      program_id, chain_id, deployment_status, program_key, contract_version,
      artifact_checksum, runtime_bytecode_checksum, immutable_references,
      token_address, token_decimals, owner_wallet, platform_admin_wallet,
      withdraw_recipient, refund_unlock_at, deploy_idempotency_key,
      deployment_request_hash, deployment_fee_quote_id
    ) values (
      target_program_id, 5042002, 'accepted', lower(target_program_key), '1.1.0',
      lower(target_artifact_checksum), lower(target_runtime_checksum),
      target_immutable_references,
      '0x3600000000000000000000000000000000000000', 6,
      lower(target_program_owner_wallet), lower(target_platform_admin_wallet),
      lower(target_withdraw_recipient), target_refund_unlock_at,
      target_idempotency_key, lower(target_request_hash), target_fee_quote_id
    );
  end if;
  return coalesce(deployment_row.id, (
    select id from public.escrow_contracts
    where program_id = target_program_id and chain_id = 5042002
  ));
end;
$$;

create or replace function public.rotate_escrow_deployment_idempotency_key_atomic(
  target_deployment_id uuid,
  target_idempotency_key uuid,
  target_request_hash text,
  target_reason text
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  deployment_row public.escrow_contracts%rowtype;
  next_attempt smallint;
begin
  if target_idempotency_key is null
     or target_request_hash is null
     or target_request_hash !~ '^0x[0-9a-fA-F]{64}$'
  then
    raise exception using errcode = '22023', detail = 'escrow_deployment_rotation_parameters_required';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_deployment_id::text || ':idempotency', 0)
  );
  select * into deployment_row
  from public.escrow_contracts
  where id = target_deployment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'escrow_deployment_not_found';
  end if;
  if deployment_row.deployment_status <> 'accepted'
     or deployment_row.circle_contract_id is not null
     or deployment_row.circle_transaction_id is not null
  then
    raise exception using errcode = '55000', detail = 'escrow_deployment_identifiers_already_recorded';
  end if;
  if deployment_row.deployment_attempt >= 2 then
    raise exception using errcode = '55000', detail = 'escrow_deployment_idempotency_rotation_exhausted';
  end if;
  if deployment_row.deploy_idempotency_key = target_idempotency_key then
    raise exception using errcode = '22023', detail = 'escrow_deployment_idempotency_key_must_change';
  end if;

  next_attempt := deployment_row.deployment_attempt + 1;
  update public.escrow_contracts
  set deploy_idempotency_key = target_idempotency_key,
      deployment_attempt = next_attempt,
      deployment_request_hash = lower(target_request_hash)
  where id = deployment_row.id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    null, 'system', 'escrow.deployment.idempotency_rotated', 'escrow_contract',
    deployment_row.id::text,
    jsonb_build_object(
      'fromAttempt', deployment_row.deployment_attempt,
      'toAttempt', next_attempt,
      'reason', left(target_reason, 128),
      'hasCircleIdentifiers', false
    )
  );
  return deployment_row.id;
end;
$$;

revoke all on function public.create_escrow_deployment_server_atomic(
  uuid, uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, text, uuid
) from public, anon, authenticated;
revoke all on function public.rotate_escrow_deployment_idempotency_key_atomic(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.create_escrow_deployment_server_atomic(
  uuid, uuid, text, text, text, text, timestamptz, text, text, jsonb, uuid, text, uuid
) to service_role;
grant execute on function public.rotate_escrow_deployment_idempotency_key_atomic(
  uuid, uuid, text, text
) to service_role;
