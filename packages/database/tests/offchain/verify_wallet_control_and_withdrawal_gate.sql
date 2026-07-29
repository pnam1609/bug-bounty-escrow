-- CP-13 wallet-control proof and product-lifecycle withdrawal boundary.

do $previous_image_deployment_compatibility$
begin
  if not has_function_privilege(
    'service_role',
    'public.create_escrow_deployment_atomic(uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Previous-image deployment RPC rollback compatibility is missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.create_escrow_deployment_atomic(uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.create_escrow_deployment_atomic(uuid,uuid,text,text,text,timestamp with time zone,text,text,jsonb,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Legacy deployment RPC leaked to a browser role';
  end if;
end;
$previous_image_deployment_compatibility$;

insert into public.programs (
  id, owner_id, name, slug, short_summary, description, status, total_pool, deadline
) values
(
  '31990000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'Wallet proof fixture',
  'wallet-proof-fixture',
  'Wallet-control proof fixture.',
  'Isolated CP-13 security verification fixture.',
  'draft',
  1,
  statement_timestamp() + interval '30 days'
),
(
  '31990000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  'Wallet proof other program',
  'wallet-proof-other-program',
  'Wallet-control cross-program fixture.',
  'Isolated CP-13 cross-program verification fixture.',
  'draft',
  0,
  statement_timestamp() + interval '30 days'
);

select public.create_escrow_wallet_challenge_atomic(
  '31990000-0000-4000-8000-000000000011',
  '30000000-0000-4000-8000-000000000001',
  '31990000-0000-4000-8000-000000000001',
  '0x1111111111111111111111111111111111111111',
  '0x1111111111111111111111111111111111111111',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  statement_timestamp(),
  statement_timestamp() + interval '5 minutes'
);

do $wallet_binding_failures$
declare
  rejected boolean;
  error_detail text;
begin
  rejected := false;
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000004',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000011',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000021'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'program_not_found';
  end;
  if not rejected then raise exception 'Wallet proof accepted the wrong authenticated user'; end if;

  rejected := false;
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000002',
      '31990000-0000-4000-8000-000000000011',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000002'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000022'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'wallet_control_challenge_not_found';
  end;
  if not rejected then raise exception 'Wallet proof crossed its bound program'; end if;

  rejected := false;
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000011',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x2222222222222222222222222222222222222222',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000023'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'wallet_control_challenge_binding_mismatch';
  end;
  if not rejected then raise exception 'Wallet proof accepted a different owner address'; end if;
end
$wallet_binding_failures$;

-- An expired row cannot be issued through the RPC, so insert it directly as a
-- service-owned fixture and prove the consuming boundary rejects it.
insert into public.escrow_wallet_control_challenges (
  id, program_id, actor_id, owner_wallet, withdraw_recipient, nonce, issued_at, expires_at
) values (
  '31990000-0000-4000-8000-000000000012',
  '31990000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '0x1111111111111111111111111111111111111111',
  '0x1111111111111111111111111111111111111111',
  '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  statement_timestamp() - interval '10 minutes',
  statement_timestamp() - interval '5 minutes'
);

do $wallet_expiry$
declare
  rejected boolean := false;
  error_detail text;
begin
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000012',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000024'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'wallet_control_challenge_expired';
  end;
  if not rejected then raise exception 'Expired wallet challenge was consumed'; end if;
end
$wallet_expiry$;

select public.create_escrow_deployment_with_wallet_proof_atomic(
  '30000000-0000-4000-8000-000000000001',
  '31990000-0000-4000-8000-000000000001',
  '31990000-0000-4000-8000-000000000011',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0x1111111111111111111111111111111111111111',
  '0x1111111111111111111111111111111111111111',
  (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000001'),
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '{}'::jsonb,
  '31990000-0000-4000-8000-000000000025'
);

do $wallet_success_and_replay$
declare
  rejected boolean := false;
  error_detail text;
begin
  if not exists (
    select 1
    from public.escrow_wallet_control_challenges challenge
    join public.escrow_contracts deployment on deployment.id = challenge.deployment_id
    where challenge.id = '31990000-0000-4000-8000-000000000011'
      and challenge.consumed_at is not null
      and deployment.program_id = challenge.program_id
  ) then
    raise exception 'Successful wallet proof was not consumed and linked atomically';
  end if;

  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000011',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000026'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'wallet_control_challenge_replayed';
  end;
  if not rejected then raise exception 'Consumed wallet challenge was replayed'; end if;

  -- Concurrency contract: both deployment creation and challenge consumption
  -- are protected by transaction-scoped locks and row locks.
  if pg_get_functiondef(
    'public.create_escrow_deployment_with_wallet_proof_atomic(uuid,uuid,uuid,text,text,text,timestamptz,text,text,jsonb,uuid)'::regprocedure
  ) not like '%pg_advisory_xact_lock%'
     or pg_get_functiondef(
       'public.create_escrow_deployment_with_wallet_proof_atomic(uuid,uuid,uuid,text,text,text,timestamptz,text,text,jsonb,uuid)'::regprocedure
     ) not like '%for update%'
  then
    raise exception 'Wallet proof atomic consume lost its concurrency locks';
  end if;
end
$wallet_success_and_replay$;

select public.create_escrow_wallet_challenge_atomic(
  '31990000-0000-4000-8000-000000000013',
  '30000000-0000-4000-8000-000000000001',
  '31990000-0000-4000-8000-000000000001',
  '0x1111111111111111111111111111111111111111',
  '0x1111111111111111111111111111111111111111',
  '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  statement_timestamp(),
  statement_timestamp() + interval '5 minutes'
);

do $deployment_idempotency_binding$
declare
  rejected boolean;
  error_detail text;
begin
  rejected := false;
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000013',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs
       where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{"changed":true}'::jsonb,
      '31990000-0000-4000-8000-000000000025'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'escrow_deployment_parameters_locked';
  end;
  if not rejected then
    raise exception 'Deployment replay accepted changed immutable references';
  end if;

  rejected := false;
  begin
    perform public.create_escrow_deployment_with_wallet_proof_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000013',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs
       where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '{}'::jsonb,
      '31990000-0000-4000-8000-000000000026'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'escrow_deployment_parameters_locked';
  end;
  if not rejected then
    raise exception 'Deployment replay accepted a changed idempotency key';
  end if;
  if (select consumed_at
      from public.escrow_wallet_control_challenges
      where id = '31990000-0000-4000-8000-000000000013') is not null
  then
    raise exception 'Mismatched deployment replay consumed a fresh wallet challenge';
  end if;

  rejected := false;
  begin
    perform public.create_escrow_deployment_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '0x1111111111111111111111111111111111111111',
      '0x1111111111111111111111111111111111111111',
      (select deadline from public.programs
       where id = '31990000-0000-4000-8000-000000000001'),
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      null,
      '31990000-0000-4000-8000-000000000025'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'escrow_deployment_parameters_required';
  end;
  if not rejected then
    raise exception 'Legacy deployment compatibility accepted NULL parameters';
  end if;
end
$deployment_idempotency_binding$;

update public.escrow_contracts
set deployment_status = 'pending'
where program_id = '31990000-0000-4000-8000-000000000001';

do $deployment_confirmation_evidence$
declare
  target_id uuid := (
    select id
    from public.escrow_contracts
    where program_id = '31990000-0000-4000-8000-000000000001'
  );
  rejected boolean;
  error_detail text;
begin
  rejected := false;
  begin
    perform public.confirm_escrow_deployment_atomic(
      target_id,
      '0x3333333333333333333333333333333333333333',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      100,
      null,
      'circle-wallet-reference'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'escrow_deployment_confirmation_evidence_required';
  end;
  if not rejected then
    raise exception 'Deployment confirmation accepted NULL evidence';
  end if;

  perform public.confirm_escrow_deployment_atomic(
    target_id,
    '0x3333333333333333333333333333333333333333',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    100,
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'circle-wallet-reference'
  );
  perform public.confirm_escrow_deployment_atomic(
    target_id,
    '0x3333333333333333333333333333333333333333',
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    100,
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'circle-wallet-reference'
  );

  rejected := false;
  begin
    perform public.confirm_escrow_deployment_atomic(
      target_id,
      '0x3333333333333333333333333333333333333333',
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      100,
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'different-wallet-reference'
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'escrow_deployment_confirmation_mismatch';
  end;
  if not rejected then
    raise exception 'Deployment replay accepted changed wallet evidence';
  end if;
end
$deployment_confirmation_evidence$;

do $withdrawal_status_gate$
declare
  lifecycle_status text;
  rejected boolean;
  error_detail text;
  created_intent uuid;
  replay_id uuid;
begin
  foreach lifecycle_status in array array['draft','awaiting_funding','active','paused']
  loop
    perform set_config('session_replication_role', 'replica', true);
    update public.programs
    set status = lifecycle_status,
        published_at = case
          when lifecycle_status in ('active','paused') then statement_timestamp()
          else null
        end,
        closed_at = null
    where id = '31990000-0000-4000-8000-000000000001';
    perform set_config('session_replication_role', 'origin', true);

    rejected := false;
    begin
      perform public.create_withdrawal_intent_atomic(
        '30000000-0000-4000-8000-000000000001',
        '31990000-0000-4000-8000-000000000001',
        gen_random_uuid(),
        '0x1111111111111111111111111111111111111111',
        1000000,
        0,
        false
      );
    exception when others then
      get stacked diagnostics error_detail = pg_exception_detail;
      rejected := error_detail = 'withdrawal_program_not_ended';
    end;
    if not rejected then
      raise exception 'Withdrawal accepted non-ended status %', lifecycle_status;
    end if;
  end loop;

  perform set_config('session_replication_role', 'replica', true);
  update public.programs
  set status = 'expired', published_at = statement_timestamp() - interval '1 day', closed_at = null
  where id = '31990000-0000-4000-8000-000000000001';
  perform set_config('session_replication_role', 'origin', true);
  created_intent := public.create_withdrawal_intent_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31990000-0000-4000-8000-000000000001',
    '31990000-0000-4000-8000-000000000031',
    '0x1111111111111111111111111111111111111111',
    1000000,
    0,
    false
  );
  if created_intent is null then raise exception 'Expired program withdrawal was rejected'; end if;
  delete from public.withdrawal_intents where id = created_intent;

  perform set_config('session_replication_role', 'replica', true);
  update public.programs
  set status = 'closed', published_at = null, closed_at = statement_timestamp()
  where id = '31990000-0000-4000-8000-000000000001';
  perform set_config('session_replication_role', 'origin', true);

  rejected := false;
  begin
    perform public.create_withdrawal_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000030',
      null,
      1000000,
      0,
      false
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_parameters_required';
  end;
  if not rejected then
    raise exception 'Withdrawal creation accepted a NULL required parameter';
  end if;

  created_intent := public.create_withdrawal_intent_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31990000-0000-4000-8000-000000000001',
    '31990000-0000-4000-8000-000000000032',
    '0x1111111111111111111111111111111111111111',
    1000000,
    0,
    false
  );
  if created_intent is null then raise exception 'Closed program withdrawal was rejected'; end if;
  if public.create_withdrawal_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000032',
      '0x1111111111111111111111111111111111111111',
      1000000,
      0,
      false
    ) is distinct from created_intent
  then
    raise exception 'Exact withdrawal creation replay was not idempotent';
  end if;

  rejected := false;
  begin
    perform public.create_withdrawal_replacement_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      created_intent,
      '31990000-0000-4000-8000-000000000033',
      '0x1111111111111111111111111111111111111111',
      1000000,
      0,
      false
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_replacement_requires_verified_failure';
  end;
  if not rejected then
    raise exception 'Pending/unknown withdrawal was replaceable';
  end if;

  perform public.observe_withdrawal_operation_atomic(
    created_intent,
    'close',
    '0xf100000000000000000000000000000000000000000000000000000000000001',
    'submitted'
  );
  perform public.fail_withdrawal_intent_atomic(
    created_intent,
    '0xf100000000000000000000000000000000000000000000000000000000000001',
    'escrow_close_reverted'
  );

  rejected := false;
  begin
    perform public.create_withdrawal_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000034',
      '0x1111111111111111111111111111111111111111',
      1000000,
      0,
      false
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_replacement_required';
  end;
  if not rejected then
    raise exception 'Failed withdrawal was replaced without a durable link';
  end if;

  replay_id := public.create_withdrawal_replacement_intent_atomic(
    '30000000-0000-4000-8000-000000000001',
    '31990000-0000-4000-8000-000000000001',
    created_intent,
    '31990000-0000-4000-8000-000000000035',
    '0x1111111111111111111111111111111111111111',
    1000000,
    0,
    false
  );
  if public.create_withdrawal_replacement_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      created_intent,
      '31990000-0000-4000-8000-000000000035',
      '0x1111111111111111111111111111111111111111',
      1000000,
      0,
      false
    ) is distinct from replay_id
  then
    raise exception 'Exact withdrawal replacement replay was not idempotent';
  end if;

  rejected := false;
  begin
    perform public.create_withdrawal_replacement_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      created_intent,
      '31990000-0000-4000-8000-000000000035',
      '0x1111111111111111111111111111111111111111',
      1000000,
      null,
      false
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_parameters_required';
  end;
  if not rejected then
    raise exception 'Withdrawal replacement replay accepted a NULL parameter';
  end if;

  if not exists (
    select 1
    from public.withdrawal_intents prior
    join public.withdrawal_intents replacement
      on replacement.id = prior.replaced_by_intent_id
     and replacement.replaces_intent_id = prior.id
     and replacement.program_id = prior.program_id
     and replacement.escrow_contract_id = prior.escrow_contract_id
    where prior.id = created_intent
      and replacement.id = replay_id
      and prior.close_transaction_hash =
        '0xf100000000000000000000000000000000000000000000000000000000000001'
      and prior.failure_code = 'escrow_close_reverted'
  ) then
    raise exception 'Failed withdrawal evidence/link was not preserved';
  end if;

  rejected := false;
  begin
    perform public.create_withdrawal_replacement_intent_atomic(
      '30000000-0000-4000-8000-000000000001',
      '31990000-0000-4000-8000-000000000001',
      created_intent,
      '31990000-0000-4000-8000-000000000036',
      '0x1111111111111111111111111111111111111111',
      1000000,
      0,
      false
    );
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    rejected := error_detail = 'withdrawal_replacement_already_exists';
  end;
  if not rejected then
    raise exception 'Concurrent second withdrawal replacement was accepted';
  end if;

  rejected := false;
  begin
    update public.withdrawal_intents
    set close_transaction_hash =
      '0xf200000000000000000000000000000000000000000000000000000000000002'
    where id = created_intent;
  exception when sqlstate '55000' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Prior withdrawal transaction evidence was mutable';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where entity_id = created_intent::text
      and action = 'withdrawal.intent.transitioned'
  ) or not exists (
    select 1 from public.audit_logs
    where entity_id = replay_id::text
      and action = 'withdrawal.intent.replaced'
  ) or not exists (
    select 1 from public.audit_logs
    where entity_id = '31990000-0000-4000-8000-000000000011'
      and action = 'escrow.wallet_challenge.consumed'
  ) then
    raise exception 'Required redacted CP-13 audit events are missing';
  end if;

  if pg_get_functiondef(
    'public.create_withdrawal_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,boolean)'::regprocedure
  ) not like '%for update%'
     or pg_get_functiondef(
       'public.create_withdrawal_intent_atomic(uuid,uuid,uuid,text,numeric,numeric,boolean)'::regprocedure
     ) not like '%withdrawal_program_not_ended%'
  then
    raise exception 'Withdrawal status gate is not protected by the program-row lock';
  end if;
end
$withdrawal_status_gate$;
