\set ON_ERROR_STOP on

-- Structural verification for the full schema.
-- Executed by scripts/verify-offchain.mjs against PGlite, and safe to run with psql against a
-- fresh disposable database through apply-and-verify.sql.

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

------------------------------------------------------------------ tables and RLS

do $tables_and_rls$
declare
  expected_table text;
begin
  foreach expected_table in array array[
    'profiles',
    'programs',
    'program_scopes',
    'program_reward_tiers',
    'program_tags',
    'program_resources',
    'program_impacts',
    'program_prohibited_activities',
    'program_reviewers',
    'reports',
    'report_impacts',
    'report_disclosures',
    'report_attachments',
    'report_comments',
    'report_reviews',
    'ai_triage_results',
    'escrow_contracts',
    'escrow_transactions',
    'notifications',
    'audit_logs'
  ]
  loop
    if to_regclass('public.' || expected_table) is null then
      raise exception 'Missing table public.%', expected_table;
    end if;

    if not (
      select relrowsecurity from pg_class where oid = to_regclass('public.' || expected_table)
    ) then
      raise exception 'RLS is not enabled on public.%', expected_table;
    end if;
  end loop;
end;
$tables_and_rls$;

------------------------------------------------------------------ no private content leaks

do $no_content_leaks$
begin
  -- Attachments store bucket/object identifiers only; a persisted link would outlive its signature.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'report_attachments'
      and column_name in ('url', 'public_url', 'signed_url')
  ) then
    raise exception 'report_attachments persists a link column';
  end if;

  -- reports.impact was replaced by the structured report_impacts relation.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'reports' and column_name = 'impact'
  ) then
    raise exception 'reports still carries a free-text impact column';
  end if;

  -- Fields the submit flow added: an optional secret Gist pointer and the severity-mismatch
  -- audit signal.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reports'
      and column_name in ('secret_gist_url', 'severity_mismatch_acknowledged')
    having count(*) = 2
  ) then
    raise exception 'reports is missing the secret Gist or severity acknowledgement columns';
  end if;

  -- Public disclosure content must live outside the private report row.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'report_disclosures'
      and column_name = 'public_summary'
  ) then
    raise exception 'report_disclosures does not hold public-safe content';
  end if;
end;
$no_content_leaks$;

------------------------------------------------------------------ pool accounting

do $pool_accounting$
declare
  owner_uuid uuid := '90000000-0000-4000-8000-000000000001';
  program_uuid uuid := '90000000-0000-4000-8000-000000000100';
  escrow_uuid uuid;
  computed numeric;
  caught text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (owner_uuid, 'schema-owner@example.test', '{"display_name":"Schema Owner"}');
  update public.profiles set role = 'owner' where id = owner_uuid;

  insert into public.programs (
    id, owner_id, name, slug, short_summary, description, website_url,
    status, total_pool, reserved_pool, paid_pool, deadline
  )
  values (
    program_uuid, owner_uuid, 'Schema program', 'schema-program',
    'Summary', 'Description', 'https://schema.example.test',
    'draft', 1000, 250, 100, now() + interval '1 day'
  );

  select available_pool into computed from public.programs where id = program_uuid;
  if computed <> 650 then
    raise exception 'available_pool is not total minus reserved and paid (got %)', computed;
  end if;

  -- public_status hides every pre-publication and paused state.
  if (select public_status from public.programs where id = program_uuid) is not null then
    raise exception 'A draft program has a public status';
  end if;

  update public.programs set status = 'awaiting_funding' where id = program_uuid;
  if (select public_status from public.programs where id = program_uuid) is not null then
    raise exception 'An unfunded program has a public status';
  end if;

  insert into public.escrow_contracts (
    program_id, chain_id, contract_address, deployment_transaction_hash,
    deployment_status, deployed_at, token_address, token_decimals,
    refund_unlock_at, contract_version, artifact_checksum
  ) values (
    program_uuid, 5042002, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'confirmed', now(), '0x3600000000000000000000000000000000000000', 6,
    (select deadline from public.programs where id = program_uuid), '1.1.0',
    '0x1111111111111111111111111111111111111111111111111111111111111111'
  ) returning id into escrow_uuid;

  insert into public.funding_intents (
    id, program_id, escrow_contract_id, created_by, idempotency_key,
    wallet_address, route_mode, gross_amount_base_units,
    estimated_fee_reserve_base_units, fee_allocations, sources,
    destination_address, pre_balance_base_units, pre_total_funded_base_units,
    status, destination_transaction_hash, net_received_base_units,
    expires_at, completed_at
  ) values (
    '90000000-0000-4000-8000-000000000110', program_uuid, escrow_uuid,
    owner_uuid, '90000000-0000-4000-8000-000000000111',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'send', 1000000, 0,
    pg_temp.funding_fee_allocations(
      '[{"network":"Arc_Testnet","amountBaseUnits":"0"}]'::jsonb
    ),
    '[{"network":"Arc_Testnet","amountBaseUnits":"1000000"}]'::jsonb,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 0, 0, 'complete',
    '0x2222222222222222222222222222222222222222222222222222222222222222',
    1000000, now() + interval '1 day', now()
  );
  insert into public.funding_confirmation_artifacts (
    funding_intent_id, program_id, escrow_contract_id, route_mode, escrow_address,
    artifact_version, artifact_checksum, token_address, token_decimals,
    destination_transaction_hash, destination_log_index,
    destination_block_number, destination_block_hash,
    sync_transaction_hash, sync_log_index, sync_block_number, sync_block_hash,
    gross_amount_base_units, estimated_fee_reserve_base_units,
    net_received_base_units, pre_total_funded_base_units,
    required_total_funded_base_units, post_total_funded_base_units,
    total_pool, reserved_pool, paid_pool, withdrawn_pool, available_pool
  ) values (
    '90000000-0000-4000-8000-000000000110', program_uuid, escrow_uuid,
    'send', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '1.1.0',
    '0x1111111111111111111111111111111111111111111111111111111111111111',
    '0x3600000000000000000000000000000000000000', 6,
    '0x2222222222222222222222222222222222222222222222222222222222222222',
    0, 1,
    '0x3333333333333333333333333333333333333333333333333333333333333333',
    '0x4444444444444444444444444444444444444444444444444444444444444444',
    0, 2,
    '0x5555555555555555555555555555555555555555555555555555555555555555',
    1000000, 0, 1000000, 0, 1000000, 1000000,
    1000, 250, 100, 0, 650
  );

  update public.programs
  set status = 'active', published_at = now()
  where id = program_uuid;
  if (select public_status from public.programs where id = program_uuid) <> 'active' then
    raise exception 'An active program is not publicly listed';
  end if;

  update public.programs set status = 'paused' where id = program_uuid;
  if (select public_status from public.programs where id = program_uuid) is not null then
    raise exception 'A paused program is publicly listed';
  end if;

  update public.programs set status = 'expired' where id = program_uuid;
  if (select public_status from public.programs where id = program_uuid) <> 'ended' then
    raise exception 'An expired program is not publicly listed as ended';
  end if;

  -- Committing more than was funded must be impossible.
  begin
    update public.programs set reserved_pool = 950 where id = program_uuid;
    raise exception 'Program pool solvency was not enforced';
  exception
    when check_violation then
      get stacked diagnostics caught = constraint_name;
      if caught <> 'programs_pool_solvency_check' then
        raise exception 'Unexpected solvency constraint %', caught;
      end if;
  end;
end;
$pool_accounting$;

------------------------------------------------------------------ reward tier shapes

do $reward_tier_shapes$
declare
  program_uuid uuid := '90000000-0000-4000-8000-000000000100';
  website_tier public.program_reward_tiers;
begin
  -- A range tier needs both bounds and nothing else.
  begin
    insert into public.program_reward_tiers (
      program_id, asset_type, severity, calculation_type, min_reward, flat_amount
    )
    values (program_uuid, 'website', 'high', 'range', 100, 200);
    raise exception 'A malformed range tier was accepted';
  exception
    when check_violation then null;
  end;

  -- The same severity may be priced differently per asset type.
  insert into public.program_reward_tiers (
    program_id, asset_type, severity, calculation_type, min_reward, max_reward
  )
  values
    (program_uuid, 'website', 'high', 'range', 100, 500),
    (program_uuid, 'api', 'high', 'range', 200, 900);

  begin
    insert into public.program_reward_tiers (
      program_id, asset_type, severity, calculation_type, flat_amount
    )
    values (program_uuid, 'website', 'high', 'flat', 300);
    raise exception 'A duplicate asset-type/severity tier was accepted';
  exception
    when unique_violation then null;
  end;

  select * into website_tier from public.program_reward_tiers
  where program_id = program_uuid and asset_type = 'website';

  if public.reward_tier_bounds(website_tier) @> 1000::numeric then
    raise exception 'Reward bounds accept an amount above the range maximum';
  end if;

  if not (public.reward_tier_bounds(website_tier) @> 100::numeric) then
    raise exception 'Reward bounds reject the range minimum';
  end if;

  -- Uniqueness is partial: archiving a tier must free its (asset type, severity) slot.
  update public.program_reward_tiers set archived_at = now() where id = website_tier.id;

  insert into public.program_reward_tiers (
    program_id, asset_type, severity, calculation_type, percentage_bps, max_reward_cap
  )
  values (program_uuid, 'website', 'high', 'percentage', 1000, 250000);
end;
$reward_tier_shapes$;

------------------------------------------------------------------ escrow enums match the domain

do $escrow_enums$
declare
  definition text;
begin
  select pg_get_constraintdef(oid) into definition
  from pg_constraint where conname = 'escrow_transactions_type_check';

  if definition not like '%funding%'
    or definition not like '%payout%'
    or definition not like '%refund%'
  then
    raise exception 'escrow_transactions types drifted from ESCROW_TRANSACTION_TYPES';
  end if;

  select pg_get_constraintdef(oid) into definition
  from pg_constraint where conname = 'escrow_transactions_status_check';

  if definition not like '%reverted%' or definition not like '%timeout%' then
    raise exception 'escrow_transactions statuses drifted from ESCROW_TRANSACTION_STATUSES';
  end if;
end;
$escrow_enums$;

------------------------------------------------------------------ attachment upload lifecycle

do $attachment_lifecycle$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'report_attachments'
      and column_name = 'upload_status'
  ) then
    raise exception 'report_attachments has no upload lifecycle';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'report_attachments_upload_state_check'
  ) then
    raise exception 'uploaded_at is not tied to upload_status';
  end if;
end;
$attachment_lifecycle$;

------------------------------------------------------------------ audit log is append-only

do $audit_append_only$
begin
  insert into public.audit_logs (actor_type, action, entity_type, entity_id)
  values ('system', 'schema.verification', 'schema', 'verify');

  begin
    update public.audit_logs set action = 'schema.tampered'
    where action = 'schema.verification';
    raise exception 'audit_logs accepted an update';
  exception
    when sqlstate '55000' then null;
  end;
end;
$audit_append_only$;

rollback;
