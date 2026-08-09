-- Verified multi-wallet ownership, one-time challenges, immutable report selection, and
-- settlement/edit serialization.

begin;

do $wallet_verification_and_submission$
declare
  researcher constant uuid := '30000000-0000-4000-8000-000000000002';
  other_actor constant uuid := '30000000-0000-4000-8000-000000000001';
  program_id constant uuid := '31000000-0000-4000-8000-000000000001';
  scope_id constant uuid := '32000000-0000-4000-8000-000000000001';
  impact_id constant uuid := '32200000-0000-4000-8001-000000000004';
  first_challenge uuid;
  active_challenge uuid;
  second_challenge uuid;
  first_wallet uuid;
  second_wallet uuid;
  created_report uuid;
  rejected_code text;
begin
  first_challenge := public.create_researcher_wallet_verification_challenge_atomic(
    '38000000-0000-4000-8000-000000000011',
    researcher,
    '0x1111111111111111111111111111111111111111',
    'bountyescrow.xyz',
    'https://bountyescrow.xyz/reports/wallets',
    'researcher_payout_wallet_verification',
    'nonce-wallet-test-000001',
    'Verify researcher payout wallet 1',
    '0x' || repeat('11', 32),
    now(),
    now() + interval '5 minutes'
  );
  active_challenge := public.create_researcher_wallet_verification_challenge_atomic(
    '38000000-0000-4000-8000-000000000012',
    researcher,
    '0x1111111111111111111111111111111111111111',
    'bountyescrow.xyz',
    'https://bountyescrow.xyz/reports/wallets',
    'researcher_payout_wallet_verification',
    'nonce-wallet-test-000002',
    'Verify researcher payout wallet 1 again',
    '0x' || repeat('12', 32),
    now(),
    now() + interval '5 minutes'
  );

  if not exists (
    select 1 from public.researcher_wallet_verification_challenges
    where id = first_challenge and invalidated_at is not null and consumed_at is null
  ) then
    raise exception 'Issuing a replacement challenge did not invalidate the prior challenge';
  end if;

  begin
    insert into public.researcher_wallet_verification_challenges (
      researcher_id, address, chain_id, domain, uri, purpose, nonce, message, message_hash,
      issued_at, expires_at
    ) values (
      researcher, '0x1111111111111111111111111111111111111111', 5042002,
      'bountyescrow.xyz', 'https://bountyescrow.xyz/reports/wallets',
      'researcher_payout_wallet_verification', 'nonce-wallet-test-duplicate',
      'Concurrent duplicate challenge', '0x' || repeat('13', 32), now(),
      now() + interval '5 minutes'
    );
    raise exception 'The active-challenge uniqueness boundary accepted two active challenges';
  exception
    when unique_violation then null;
  end;

  begin
    perform public.complete_researcher_wallet_verification_atomic(
      other_actor, active_challenge, '0x1111111111111111111111111111111111111111',
      '0x' || repeat('12', 32), 'Wrong actor'
    );
    raise exception 'Another actor consumed a researcher challenge';
  exception
    when sqlstate '42501' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'wallet_verification_challenge_not_accessible' then
        raise exception 'Unexpected wrong-actor challenge code %', rejected_code;
      end if;
  end;

  first_wallet := public.complete_researcher_wallet_verification_atomic(
    researcher, active_challenge, '0x1111111111111111111111111111111111111111',
    '0x' || repeat('12', 32), 'Primary Arc wallet'
  );
  begin
    perform public.complete_researcher_wallet_verification_atomic(
      researcher, active_challenge, '0x1111111111111111111111111111111111111111',
      '0x' || repeat('12', 32), 'Replay'
    );
    raise exception 'A consumed wallet challenge was replayed';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'wallet_verification_challenge_consumed' then
        raise exception 'Unexpected replay code %', rejected_code;
      end if;
  end;

  second_challenge := public.create_researcher_wallet_verification_challenge_atomic(
    '38000000-0000-4000-8000-000000000013',
    researcher,
    '0x2222222222222222222222222222222222222222',
    'bountyescrow.xyz',
    'https://bountyescrow.xyz/reports/wallets',
    'researcher_payout_wallet_verification',
    'nonce-wallet-test-000003',
    'Verify researcher payout wallet 2',
    '0x' || repeat('22', 32),
    now(),
    now() + interval '5 minutes'
  );
  second_wallet := public.complete_researcher_wallet_verification_atomic(
    researcher, second_challenge, '0x2222222222222222222222222222222222222222',
    '0x' || repeat('22', 32), 'Backup Arc wallet'
  );

  if first_wallet = second_wallet
    or (select count(*) from public.researcher_payout_wallets
        where researcher_id = researcher and status = 'verified') <> 2
  then
    raise exception 'A researcher could not retain multiple verified wallets';
  end if;

  begin
    perform public.submit_report_atomic(
      researcher,
      program_id,
      jsonb_build_object(
        'affectedScopeId', scope_id,
        'title', 'Missing payout wallet fixture',
        'description', 'The full report must rollback without a selected verified wallet.',
        'reproductionSteps', 'Run the synthetic steps.',
        'proposedSeverity', 'high',
        'programImpactIds', jsonb_build_array(impact_id),
        'customImpacts', '[]'::jsonb
      ),
      '0x' || repeat('31', 32)
    );
    raise exception 'A report was submitted without a payout wallet';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'researcher_payout_wallet_required' then
        raise exception 'Unexpected missing-wallet submission code %', rejected_code;
      end if;
  end;
  if exists (select 1 from public.reports where content_hash = '0x' || repeat('31', 32)) then
    raise exception 'Rejected wallet-less submission left a report row behind';
  end if;

  created_report := public.submit_report_atomic(
    researcher,
    program_id,
    jsonb_build_object(
      'affectedScopeId', scope_id,
      'title', 'Verified payout wallet fixture',
      'description', 'The selected wallet is snapshotted separately from report content.',
      'reproductionSteps', 'Run the synthetic steps.',
      'proposedSeverity', 'high',
      'programImpactIds', jsonb_build_array(impact_id),
      'customImpacts', '[]'::jsonb,
      'payoutWalletId', first_wallet
    ),
    '0x' || repeat('32', 32)
  );

  if not exists (
    select 1
    from public.reports report
    join public.report_payout_wallet_snapshots snapshot
      on snapshot.id = report.payout_wallet_snapshot_id
    where report.id = created_report
      and report.payout_wallet_version = 1
      and snapshot.version = 1
      and snapshot.source = 'submission'
      and snapshot.researcher_payout_wallet_id = first_wallet
      and snapshot.address = '0x1111111111111111111111111111111111111111'
  ) then
    raise exception 'Submission did not atomically snapshot its verified payout wallet';
  end if;

  perform public.set_report_payout_wallet_atomic(
    researcher, created_report, second_wallet, 1
  );
  if not exists (
    select 1 from public.reports report
    join public.report_payout_wallet_snapshots snapshot
      on snapshot.id = report.payout_wallet_snapshot_id
    where report.id = created_report
      and report.payout_wallet_version = 2
      and snapshot.researcher_payout_wallet_id = second_wallet
      and snapshot.source = 'researcher_edit'
  ) or (
    select count(*) from public.report_payout_wallet_snapshots where report_id = created_report
  ) <> 2 then
    raise exception 'Wallet edit did not append history and advance the current pointer';
  end if;

  begin
    perform public.set_report_payout_wallet_atomic(
      researcher, created_report, first_wallet, 1
    );
    raise exception 'A stale wallet edit version was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'report_payout_wallet_version_conflict' then
        raise exception 'Unexpected stale-wallet version code %', rejected_code;
      end if;
  end;

  begin
    update public.programs set status = 'paused' where id = program_id;
    perform public.set_report_payout_wallet_atomic(
      researcher, created_report, first_wallet, 2
    );
    perform 1 / 0;
  exception
    when division_by_zero then null;
  end;

  update public.reports set status = 'duplicate' where id = created_report;
  begin
    perform public.set_report_payout_wallet_atomic(
      researcher, created_report, second_wallet, 2
    );
    raise exception 'A duplicate report accepted a payout-wallet edit';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'report_payout_wallet_report_closed' then
        raise exception 'Unexpected closed-report wallet code %', rejected_code;
      end if;
  end;
  update public.reports set status = 'submitted' where id = created_report;

  begin
    update public.programs set status = 'expired' where id = program_id;
    begin
      perform public.set_report_payout_wallet_atomic(
        researcher, created_report, second_wallet, 2
      );
      raise exception 'An ended program accepted a payout-wallet edit';
    exception
      when sqlstate '22023' then
        get stacked diagnostics rejected_code = pg_exception_detail;
        if rejected_code <> 'report_payout_wallet_program_ended' then
          raise exception 'Unexpected ended-program wallet code %', rejected_code;
        end if;
    end;
    -- Force this nested block to rollback the synthetic lifecycle change. Re-publishing an
    -- expired program is intentionally forbidden by the production collateral trigger.
    perform 1 / 0;
  exception
    when division_by_zero then null;
  end;

  begin
    update public.report_payout_wallet_snapshots
    set address = '0x3333333333333333333333333333333333333333'
    where report_id = created_report and version = 1;
    raise exception 'A historical payout snapshot was mutable';
  exception
    when sqlstate '55000' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'report_payout_wallet_snapshot_immutable' then
        raise exception 'Unexpected immutable snapshot code %', rejected_code;
      end if;
  end;
end;
$wallet_verification_and_submission$;

do $wallet_edit_settlement_serialization$
declare
  researcher constant uuid := '30000000-0000-4000-8000-000000000002';
  owner_id constant uuid := '30000000-0000-4000-8000-000000000001';
  report_id constant uuid := '33000000-0000-4000-8000-000000000029';
  first_wallet uuid;
  second_wallet uuid;
  intent_id uuid;
  current_snapshot uuid;
  rejected_code text;
begin
  select id into first_wallet from public.researcher_payout_wallets
  where researcher_id = researcher and address = '0x1111111111111111111111111111111111111111';
  select id into second_wallet from public.researcher_payout_wallets
  where researcher_id = researcher and address = '0x2222222222222222222222222222222222222222';

  if (
    select count(*) from public.get_report_payout_wallet_state(researcher, report_id)
  ) <> 1 or not exists (
    select 1 from public.get_report_payout_wallet_state(researcher, report_id)
    where snapshot_id is null
      and wallet_id is null
      and wallet_address is null
      and version = 0
      and can_edit
      and blocked_reason is null
  ) then
    raise exception 'Legacy report without a wallet did not return an editable version-zero state';
  end if;

  perform public.set_report_payout_wallet_atomic(researcher, report_id, first_wallet, 0);
  -- Edit wins first: settlement must lock and persist the newly current immutable snapshot.
  current_snapshot := public.set_report_payout_wallet_atomic(
    researcher, report_id, second_wallet, 1
  );

  insert into public.escrow_contracts (
    id, program_id, chain_id, contract_address, deployment_transaction_hash,
    deployment_status, deployed_at, program_key, contract_version, artifact_checksum,
    runtime_bytecode_checksum, immutable_references, token_address, token_decimals,
    owner_wallet, withdraw_recipient, refund_unlock_at, circle_contract_id,
    circle_transaction_id, deployment_wallet_reference, deploy_idempotency_key,
    deployment_block_number, deployment_block_hash
  ) values (
    '39000000-0000-4000-8000-000000000091',
    '31000000-0000-4000-8000-000000000001', 5042002,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa91',
    '0x9100000000000000000000000000000000000000000000000000000000000001',
    'confirmed', now(),
    '0x9200000000000000000000000000000000000000000000000000000000000001',
    '1.1.0',
    '0x9300000000000000000000000000000000000000000000000000000000000001',
    '0x9400000000000000000000000000000000000000000000000000000000000001',
    '{}'::jsonb, '0x3600000000000000000000000000000000000000', 6,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab',
    (select deadline from public.programs where id = '31000000-0000-4000-8000-000000000001'),
    'circle-contract-wallet-race', 'circle-transaction-wallet-race',
    'circle-wallet-wallet-race', '39000000-0000-4000-8000-000000000092', 90,
    '0x9500000000000000000000000000000000000000000000000000000000000001'
  );

  intent_id := public.create_reward_settlement_intent_atomic(
    owner_id, report_id, null, 10000,
    '0x9600000000000000000000000000000000000000000000000000000000000001',
    (select content_hash from public.reports where id = report_id),
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '39000000-0000-4000-8000-000000000093'
  );

  if not exists (
    select 1 from public.reward_settlement_intents
    where id = intent_id
      and report_payout_wallet_snapshot_id = current_snapshot
      and researcher_payout_wallet_id = second_wallet
      and recipient_address = '0x2222222222222222222222222222222222222222'
      and recipient_chain_id = 5042002
      and recipient_verification_method = 'eip191_personal_sign'
      and recipient_wallet_verified_at is not null
  ) then
    raise exception 'Settlement did not preserve the edit-winning wallet snapshot';
  end if;

  update public.profiles
  set wallet_address = '0x4444444444444444444444444444444444444444',
      wallet_updated_at = now()
  where id = researcher;
  if (
    select recipient_address from public.reward_settlement_intents where id = intent_id
  ) <> '0x2222222222222222222222222222222222222222' then
    raise exception 'A legacy profile-wallet mutation changed the settlement recipient';
  end if;

  -- Settlement wins next: set_report takes the same report/program locks and must fail closed.
  begin
    perform public.set_report_payout_wallet_atomic(researcher, report_id, first_wallet, 2);
    raise exception 'A wallet edit raced past an existing settlement intent';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'report_payout_wallet_settlement_started' then
        raise exception 'Unexpected settlement-lock code %', rejected_code;
      end if;
  end;

  begin
    update public.reward_settlement_intents
    set recipient_address = '0x1111111111111111111111111111111111111111'
    where id = intent_id;
    raise exception 'Settlement recipient identity was mutable after insert';
  exception
    when sqlstate '55000' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'reward_settlement_recipient_snapshot_immutable' then
        raise exception 'Unexpected settlement recipient immutability code %', rejected_code;
      end if;
  end;
end;
$wallet_edit_settlement_serialization$;

rollback;
