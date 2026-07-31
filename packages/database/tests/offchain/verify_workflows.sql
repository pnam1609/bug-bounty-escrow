begin;

-- The API response contracts use the shared Zod UUID primitive. PostgreSQL accepts UUID text
-- whose variant nibble is outside 8..b, so guard the demo IDs at the DB/API seam as well.
do $demo_uuid_contract$
declare
  shared_uuid_pattern constant text :=
    '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$';
begin
  if exists (
    select 1
    from public.program_impacts
    where id::text !~ shared_uuid_pattern
  ) then
    raise exception 'Seeded program impact ID violates the shared UUID contract';
  end if;

  if exists (
    select 1
    from public.program_reward_tiers
    where id::text !~ shared_uuid_pattern
  ) then
    raise exception 'Seeded program reward tier ID violates the shared UUID contract';
  end if;

  if exists (
    select 1
    from public.report_impacts
    where program_impact_id is not null
      and program_impact_id::text !~ shared_uuid_pattern
  ) then
    raise exception 'Seeded report impact reference violates the shared UUID contract';
  end if;
end;
$demo_uuid_contract$;

-- Seed layout used below (see seeds/offchain-demo.sql):
--   report 09 -> program 2, status submitted
--   report 10 -> program 3, status triaged
--   report 17 -> program 3, status submitted
--   report 05 -> program 5, status validated
do $reward_workflow$
declare
  before_transactions integer;
  after_transactions integer;
  before_reviews integer;
  after_reviews integer;
  before_reserved numeric;
  after_reserved numeric;
  program_uuid uuid;
begin
  select program_id into program_uuid
  from public.reports
  where id = '33000000-0000-4000-8000-000000000009';

  select count(*) into before_transactions from public.escrow_transactions;
  select count(*) into before_reviews
  from public.report_reviews
  where report_id = '33000000-0000-4000-8000-000000000009';
  select reserved_pool into before_reserved from public.programs where id = program_uuid;

  perform public.validate_report_atomic(
    '30000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000009',
    'low'
  );
  perform public.approve_report_reward_atomic(
    '30000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000009',
    1000
  );

  if (
    select status <> 'reward_approved'
      or approved_reward <> 1000
    from public.reports
    where id = '33000000-0000-4000-8000-000000000009'
  ) then
    raise exception 'Reward approval state was not committed atomically';
  end if;

  -- Approving must reserve the amount, otherwise two reports could each be approved for the
  -- whole balance.
  select reserved_pool into after_reserved from public.programs where id = program_uuid;
  if after_reserved <> before_reserved + 1000 then
    raise exception 'Reward approval did not reserve against the program pool';
  end if;

  select count(*) into after_transactions from public.escrow_transactions;
  if after_transactions <> before_transactions then
    raise exception 'Off-chain reward approval unexpectedly created a payout';
  end if;

  begin
    perform public.approve_report_reward_atomic(
      '30000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000009',
      1000
    );
    raise exception 'Reward approval retry unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  select count(*) into after_reviews
  from public.report_reviews
  where report_id = '33000000-0000-4000-8000-000000000009';
  if after_reviews <> before_reviews + 2 then
    raise exception 'Reward retry created duplicate transition records';
  end if;
end;
$reward_workflow$;

-- The full settlement path moves the amount from reserved to paid exactly once.
do $payment_workflow$
declare
  program_uuid uuid;
  reserved_before numeric;
  paid_before numeric;
  reserved_after numeric;
  paid_after numeric;
begin
  select program_id into program_uuid
  from public.reports
  where id = '33000000-0000-4000-8000-000000000009';
  select reserved_pool, paid_pool into reserved_before, paid_before
  from public.programs where id = program_uuid;

  perform public.start_report_payment_atomic(
    '30000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000009',
    '0x' || repeat('a', 64),
    '0x' || repeat('b', 40)
  );

  if (
    select status <> 'payment_pending'
    from public.reports where id = '33000000-0000-4000-8000-000000000009'
  ) then
    raise exception 'Starting payment did not move the report to payment_pending';
  end if;

  perform public.confirm_report_payment_atomic(
    '30000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000009',
    9001,
    '0x' || repeat('c', 64),
    12
  );

  select reserved_pool, paid_pool into reserved_after, paid_after
  from public.programs where id = program_uuid;

  if reserved_after <> reserved_before - 1000 or paid_after <> paid_before + 1000 then
    raise exception 'Payment confirmation did not move the reservation into paid';
  end if;

  if (
    select status <> 'paid' or paid_at is null
    from public.reports where id = '33000000-0000-4000-8000-000000000009'
  ) then
    raise exception 'Payment confirmation did not settle the report';
  end if;

  begin
    perform public.confirm_report_payment_atomic(
      '30000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000009',
      9002,
      '0x' || repeat('d', 64),
      12
    );
    raise exception 'Payment confirmation retry unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end;
$payment_workflow$;

do $invalid_reward_bounds$
begin
  begin
    perform public.approve_report_reward_atomic(
      '30000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000005',
      999999999
    );
    raise exception 'Out-of-range reward unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end;
$invalid_reward_bounds$;

do $duplicate_rules$
begin
  begin
    perform public.mark_report_duplicate_atomic(
      '30000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000010',
      '33000000-0000-4000-8000-000000000010',
      'same report'
    );
    raise exception 'Self duplicate unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  perform public.mark_report_duplicate_atomic(
    '30000000-0000-4000-8000-000000000001',
    '33000000-0000-4000-8000-000000000010',
    '33000000-0000-4000-8000-000000000017',
    'same synthetic root cause'
  );

  begin
    perform public.mark_report_duplicate_atomic(
      '30000000-0000-4000-8000-000000000001',
      '33000000-0000-4000-8000-000000000010',
      '33000000-0000-4000-8000-000000000017',
      'retry'
    );
    raise exception 'Duplicate transition retry unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end;
$duplicate_rules$;

-- Submitting into a program that is not active must be a distinguishable business rule error,
-- not a generic failure: the composer shows a dedicated "program closed" state for it.
do $closed_program_submission$
declare
  closed_program uuid;
  closed_scope uuid;
begin
  select id into closed_program from public.programs
  where id::text like '31000000-%' and status = 'closed'
  limit 1;

  select id into closed_scope from public.program_scopes
  where program_id = closed_program and is_in_scope
  limit 1;

  begin
    perform public.submit_report_atomic(
      '30000000-0000-4000-8000-000000000002',
      closed_program,
      jsonb_build_object(
        'affectedScopeId', closed_scope,
        'title', 'Attempted late submission',
        'description', 'Synthetic description',
        'reproductionSteps', 'Synthetic steps',
        'proposedSeverity', 'low',
        'programImpactIds', '[]'::jsonb,
        'customImpacts', '[]'::jsonb
      ),
      '0x' || repeat('e', 64)
    );
    raise exception 'Submission into a closed program unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end;
$closed_program_submission$;

-- A report must carry at least one impact, and only impacts published for the affected scope's
-- asset type may be claimed.
do $impact_rules$
declare
  active_program uuid;
  active_scope uuid;
  foreign_impact uuid;
begin
  select id into active_program from public.programs
  where id::text like '31000000-%' and status = 'active'
  order by slug
  limit 1;

  select id into active_scope from public.program_scopes
  where program_id = active_program and is_in_scope and archived_at is null
  limit 1;

  begin
    perform public.submit_report_atomic(
      '30000000-0000-4000-8000-000000000002',
      active_program,
      jsonb_build_object(
        'affectedScopeId', active_scope,
        'title', 'Report without impacts',
        'description', 'Synthetic description',
        'reproductionSteps', 'Synthetic steps',
        'proposedSeverity', 'low',
        'programImpactIds', '[]'::jsonb,
        'customImpacts', '[]'::jsonb
      ),
      '0x' || repeat('1', 64)
    );
    raise exception 'Submission without an impact unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  select id into foreign_impact from public.program_impacts
  where program_id <> active_program
  limit 1;

  begin
    perform public.submit_report_atomic(
      '30000000-0000-4000-8000-000000000002',
      active_program,
      jsonb_build_object(
        'affectedScopeId', active_scope,
        'title', 'Report claiming a foreign impact',
        'description', 'Synthetic description',
        'reproductionSteps', 'Synthetic steps',
        'proposedSeverity', 'low',
        'programImpactIds', jsonb_build_array(foreign_impact),
        'customImpacts', '[]'::jsonb
      ),
      '0x' || repeat('2', 64)
    );
    raise exception 'Submission with an impact from another program unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;
end;
$impact_rules$;

-- Account settings may change the display name and nothing else: the role decides what a person
-- can reach, so an editable role here would be a privilege-escalation path.
do $profile_display_name$
declare
  actor uuid := '30000000-0000-4000-8000-000000000002';
  role_before text;
begin
  select role into role_before from public.profiles where id = actor;

  perform public.update_profile_display_name_atomic(actor, '  Renamed Researcher  ');

  if (select display_name from public.profiles where id = actor) <> 'Renamed Researcher' then
    raise exception 'Display name was not trimmed and stored';
  end if;

  if (select role from public.profiles where id = actor) <> role_before then
    raise exception 'Changing the display name altered the role';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where actor_id = actor and action = 'profile.display_name_changed'
  ) then
    raise exception 'Display name change was not audited';
  end if;

  begin
    perform public.update_profile_display_name_atomic(actor, '   ');
    raise exception 'A blank display name was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  -- Onboarding stays closed: settings must not become a second path to a different role.
  begin
    perform public.complete_profile_onboarding_for_user(actor, 'owner', 'Renamed Researcher');
    raise exception 'A completed profile was allowed to switch role';
  exception
    when sqlstate '23505' then null;
  end;
end;
$profile_display_name$;

-- ONB-08: onboarding is one-shot. The first submit applies the choice and audits exactly once;
-- resending the same choice is an idempotent retry that must not duplicate the audit trail; any
-- different choice conflicts with the machine-readable reason the API forwards, and must never
-- overwrite the stored profile.
do $onb08_onboarding_lifecycle$
declare
  fresh_user uuid := '30000000-0000-4000-8000-000000000099';
  audit_rows integer;
  rejected_code text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (fresh_user, 'onb08@local.demo', '{"display_name":"Pre Onboarding"}'::jsonb);

  -- The signup trigger bootstraps a profile that has not completed onboarding yet.
  if (select onboarding_completed_at from public.profiles where id = fresh_user) is not null then
    raise exception 'A bootstrapped profile must not start as onboarded';
  end if;

  -- First submit: stores the trimmed choice, stamps completion, audits exactly once.
  perform public.complete_profile_onboarding_for_user(fresh_user, 'owner', '  Onboard Once  ');

  if not exists (
    select 1 from public.profiles
    where id = fresh_user
      and role = 'owner'
      and display_name = 'Onboard Once'
      and onboarding_completed_at is not null
  ) then
    raise exception 'First onboarding did not persist the trimmed choice atomically';
  end if;

  select count(*) into audit_rows
  from public.audit_logs
  where actor_id = fresh_user and action = 'profile.onboarding_completed';

  if audit_rows <> 1 then
    raise exception 'First onboarding must write exactly one audit row, found %', audit_rows;
  end if;

  -- Same-data retry: succeeds without duplicating the audit trail.
  perform public.complete_profile_onboarding_for_user(fresh_user, 'owner', 'Onboard Once');

  select count(*) into audit_rows
  from public.audit_logs
  where actor_id = fresh_user and action = 'profile.onboarding_completed';

  if audit_rows <> 1 then
    raise exception 'An idempotent retry duplicated the onboarding audit row (found %)', audit_rows;
  end if;

  -- A different role after completion conflicts with the reason the client branches on.
  begin
    perform public.complete_profile_onboarding_for_user(fresh_user, 'researcher', 'Onboard Once');
    raise exception 'A completed profile accepted a different role';
  exception
    when sqlstate '23505' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'onboarding_already_completed' then
        raise exception 'Expected onboarding_already_completed, got %', rejected_code;
      end if;
  end;

  -- A different display name is a conflict too: post-onboarding renames belong to settings.
  begin
    perform public.complete_profile_onboarding_for_user(fresh_user, 'owner', 'Different Name');
    raise exception 'A completed profile accepted a different display name';
  exception
    when sqlstate '23505' then null;
  end;

  if not exists (
    select 1 from public.profiles
    where id = fresh_user and role = 'owner' and display_name = 'Onboard Once'
  ) then
    raise exception 'A rejected onboarding attempt overwrote the stored profile';
  end if;
end;
$onb08_onboarding_lifecycle$;

-- The resolution metric measures time to a review DECISION, from the FIRST submission.
-- Report 33 -> program 5, status submitted.
do $resolution_metric$
declare
  report_uuid uuid := '33000000-0000-4000-8000-000000000033';
  program_uuid uuid;
  first_submitted_at timestamptz;
  after_resubmit_at timestamptz;
  metric_before integer;
  metric_after integer;
  expected_metric integer;
begin
  select program_id, submitted_at into program_uuid, first_submitted_at
  from public.reports where id = report_uuid;

  -- A needs_information round trip must not restart the clock.
  perform public.request_report_information_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, 'Need a minimal reproduction'
  );
  perform public.update_report_atomic(
    '30000000-0000-4000-8000-000000000002',
    report_uuid,
    jsonb_build_object('description', 'Answered the reviewer question'),
    '0x' || repeat('7', 64),
    true
  );

  select submitted_at into after_resubmit_at from public.reports where id = report_uuid;

  if after_resubmit_at <> first_submitted_at then
    raise exception 'Resubmitting reset submitted_at, which would hide review latency';
  end if;

  perform public.validate_report_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, 'low'
  );

  metric_before := public.program_median_resolution_seconds(program_uuid);

  if metric_before is null or metric_before <= 0 then
    raise exception 'Resolution metric is not populated after a review decision';
  end if;

  -- Settlement is not review: approving and paying must leave the metric untouched.
  perform public.approve_report_reward_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, 1000, null
  );
  perform public.start_report_payment_atomic(
    '30000000-0000-4000-8000-000000000001',
    report_uuid,
    '0x' || repeat('8', 64),
    '0x' || repeat('9', 40)
  );
  perform public.confirm_report_payment_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, 9100, '0x' || repeat('f', 64), 12
  );

  -- now() is transaction time, so every row written above shares one timestamp and an endpoint
  -- regression would be invisible. Push settlement into the future the way it happens in
  -- production, so measuring to the last review instead of the decision is detectable.
  update public.report_reviews
  set created_at = created_at + interval '2 days'
  where report_id = report_uuid
    and to_status in ('reward_approved', 'payment_pending', 'paid');

  metric_after := public.program_median_resolution_seconds(program_uuid);

  if metric_after <> metric_before then
    raise exception
      'Settlement moved the resolution metric (% -> %); it must track review decisions only',
      metric_before, metric_after;
  end if;

  -- The check above cannot fail on its own: the validate review always precedes settlement, so
  -- min() picks it either way. Restate the agreed formula independently so that changing the
  -- function's endpoint, its start, or its aggregate is caught.
  select round(
    percentile_cont(0.5) within group (
      order by extract(epoch from spec.decided_at - spec.submitted_at)
    )
  )::integer
  into expected_metric
  from (
    select
      report.submitted_at,
      min(review.created_at) as decided_at
    from public.reports report
    join public.report_reviews review on review.report_id = report.id
    where report.program_id = program_uuid
      and report.submitted_at is not null
      and review.to_status in ('rejected', 'duplicate', 'validated')
    group by report.id, report.submitted_at
  ) as spec;

  if metric_after is distinct from expected_metric then
    raise exception
      'Resolution metric % does not match median(first review decision - first submission) %',
      metric_after, expected_metric;
  end if;
end;
$resolution_metric$;

-- The median above is robust to a single outlier, so it cannot pin the exact endpoint. This
-- block builds an isolated program with exactly one resolved report and fully controlled
-- timestamps, where the metric has one correct answer.
--
-- Three reports with a skewed spread, so the aggregate itself is pinned: over
-- {2, 6, 22} days the median is 6, the mean is 10 and the p90 is 18.8.
--
--   report A  submitted now - 10 days, decided now -  4 days  ->   6 days
--             reward approved now - 3 days, settled now - 1 day (must be ignored)
--   report B  submitted now - 10 days, decided now -  8 days  ->   2 days
--   report C  submitted now - 30 days, decided now -  8 days  ->  22 days
--   median    6 days
do $resolution_metric_exact$
declare
  program_uuid uuid := '38000000-0000-4000-8000-000000000001';
  scope_uuid uuid := '38000000-0000-4000-8000-000000000002';
  report_uuid uuid := '38000000-0000-4000-8000-000000000003';
  faster_report_uuid uuid := '38000000-0000-4000-8000-000000000004';
  slower_report_uuid uuid := '38000000-0000-4000-8000-000000000005';
  researcher_uuid uuid := '30000000-0000-4000-8000-000000000002';
  reviewer_uuid uuid := '30000000-0000-4000-8000-000000000003';
  expected_median constant integer := 6 * 24 * 60 * 60;
  measured integer;
begin
  insert into public.programs (
    id, owner_id, name, slug, short_summary, description, website_url, status, total_pool
  )
  values (
    program_uuid, '30000000-0000-4000-8000-000000000001',
    'Metric fixture', 'metric-fixture', 'Summary', 'Description',
    'https://metric.example.test', 'draft', 0
  );

  insert into public.program_scopes (id, program_id, asset_type, asset_name)
  values (scope_uuid, program_uuid, 'website', 'Metric asset');

  insert into public.reports (
    id, program_id, researcher_id, affected_scope_id, title, description,
    proposed_severity, final_severity, status, content_hash,
    approved_reward, reward_approved_at, created_at, submitted_at, paid_at
  )
  values (
    report_uuid, program_uuid, researcher_uuid, scope_uuid,
    'Metric fixture report', 'Synthetic description',
    'low', 'low', 'paid', '0x' || repeat('3', 64),
    100, now() - interval '3 days',
    now() - interval '10 days', now() - interval '10 days', now() - interval '1 day'
  );

  insert into public.reports (
    id, program_id, researcher_id, affected_scope_id, title, description,
    proposed_severity, final_severity, status, content_hash, created_at, submitted_at
  )
  values (
    faster_report_uuid, program_uuid, researcher_uuid, scope_uuid,
    'Metric fixture fast report', 'Synthetic description',
    'low', 'low', 'validated', '0x' || repeat('4', 64),
    now() - interval '10 days', now() - interval '10 days'
  );

  insert into public.reports (
    id, program_id, researcher_id, affected_scope_id, title, description,
    proposed_severity, final_severity, status, content_hash, created_at, submitted_at
  )
  values (
    slower_report_uuid, program_uuid, researcher_uuid, scope_uuid,
    'Metric fixture slow report', 'Synthetic description',
    'low', 'low', 'validated', '0x' || repeat('5', 64),
    now() - interval '30 days', now() - interval '30 days'
  );

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, created_at
  )
  values
    (faster_report_uuid, reviewer_uuid, 'validate', 'submitted', 'validated',
     now() - interval '8 days'),
    (slower_report_uuid, reviewer_uuid, 'validate', 'submitted', 'validated',
     now() - interval '8 days'),
    (report_uuid, reviewer_uuid, 'validate', 'submitted', 'validated',
     now() - interval '4 days'),
    (report_uuid, reviewer_uuid, 'approve_reward', 'validated', 'reward_approved',
     now() - interval '3 days'),
    (report_uuid, reviewer_uuid, 'start_payment', 'reward_approved', 'payment_pending',
     now() - interval '2 days'),
    (report_uuid, reviewer_uuid, 'confirm_payment', 'payment_pending', 'paid',
     now() - interval '1 day');

  measured := public.program_median_resolution_seconds(program_uuid);

  if measured is distinct from expected_median then
    raise exception
      'Resolution metric is % seconds; the median time to a review decision is %',
      measured, expected_median;
  end if;
end;
$resolution_metric_exact$;

-- A percentage tier is not guidance text: the reviewer supplies the verified basis and the
-- server derives, caps and snapshots the reward.
do $percentage_reward$
declare
  report_uuid uuid := '33000000-0000-4000-8000-000000000025';
  program_uuid uuid;
  scope_asset text;
  snapshot jsonb;
begin
  select program_id into program_uuid from public.reports where id = report_uuid;
  select scope.asset_type into scope_asset
  from public.reports report
  join public.program_scopes scope on scope.id = report.affected_scope_id
  where report.id = report_uuid;

  perform public.validate_report_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, 'critical'
  );

  -- Tighten the cap so the clamp is observable rather than inferred.
  update public.program_reward_tiers
  set max_reward_cap = 3000
  where program_id = program_uuid
    and asset_type = scope_asset
    and severity = 'critical'
    and archived_at is null;

  begin
    perform public.approve_report_reward_atomic(
      '30000000-0000-4000-8000-000000000001', report_uuid, 5000, null
    );
    raise exception 'A percentage tier accepted an approval without a calculation basis';
  exception
    when sqlstate '22023' then null;
  end;

  -- 10% of 50000 is 5000, above the 3000 cap, so the cap decides the payout.
  perform public.approve_report_reward_atomic(
    '30000000-0000-4000-8000-000000000001', report_uuid, null, 50000
  );

  if (select approved_reward from public.reports where id = report_uuid) <> 3000 then
    raise exception 'Percentage reward was not derived and capped by the server';
  end if;

  select metadata into snapshot
  from public.report_reviews
  where report_id = report_uuid and action = 'approve_reward';

  if snapshot ->> 'calculationType' <> 'percentage'
    or snapshot ->> 'calculationBasisAmount' is null
    or snapshot ->> 'percentageBps' is null
    or snapshot ->> 'maxRewardCap' is null
    or snapshot ->> 'reward' is null
  then
    raise exception 'Percentage approval did not snapshot its inputs: %', snapshot;
  end if;
end;
$percentage_reward$;

-- A reward tier that already priced an approval belongs to that payment record.
do $reward_tier_history$
declare
  program_uuid uuid;
  program_snapshot timestamptz;
  priced_tier uuid;
begin
  select program_id into program_uuid from public.reports
  where id = '33000000-0000-4000-8000-000000000025';

  select id into priced_tier from public.program_reward_tiers
  where program_id = program_uuid and severity = 'critical' and archived_at is null;

  select updated_at into program_snapshot from public.programs where id = program_uuid;

  -- Submit a tier list that omits the critical tier entirely.
  perform public.update_program_atomic(
    '30000000-0000-4000-8000-000000000001',
    program_uuid,
    jsonb_build_object(
      'expectedUpdatedAt', program_snapshot,
      'rewardTiers', jsonb_build_array(
        jsonb_build_object(
          'assetType', (
            select asset_type from public.program_reward_tiers where id = priced_tier
          ),
          'severity', 'low',
          'calculationType', 'range',
          'minReward', '500',
          'maxReward', '5000'
        )
      )
    )
  );

  if not exists (
    select 1 from public.program_reward_tiers
    where id = priced_tier and archived_at is not null
  ) then
    raise exception 'A reward tier with an approval history was deleted instead of archived';
  end if;
end;
$reward_tier_history$;

-- CP-02: create_program_atomic owns the Create Program contract. The happy path must produce a
-- private draft with zero pools, snapshotted platform rules and program-owned impact copies; every
-- broken payload must raise a machine-readable rule code the API can map into `error.code`.
do $create_program_contract$
declare
  owner_actor uuid := '30000000-0000-4000-8000-000000000001';
  researcher_actor uuid := '30000000-0000-4000-8000-000000000002';
  base_input jsonb;
  created_program uuid;
  program_row public.programs;
  rejected_code text;
begin
  base_input := jsonb_build_object(
    'name', 'CP-02 fixture program',
    'slug', 'cp02-fixture-program',
    'shortSummary', 'Contract-shaped fixture',
    'description', 'Synthetic description',
    'websiteUrl', 'https://cp02.example.test',
    'tags', jsonb_build_array('DeFi', 'Solidity'),
    'deadline', (now() + interval '30 days')::text,
    'resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'documentation',
      'title', 'Protocol docs',
      'url', 'https://cp02.example.test/docs',
      'sortOrder', 0
    )),
    'scopes', jsonb_build_array(
      jsonb_build_object(
        'assetType', 'smart_contract', 'assetName', 'Vault', 'isInScope', true, 'sortOrder', 0
      ),
      jsonb_build_object(
        'assetType', 'website', 'assetName', 'Legacy portal', 'isInScope', false, 'sortOrder', 1
      )
    ),
    'impacts', jsonb_build_array(jsonb_build_object(
      'assetType', 'smart_contract',
      'severity', 'critical',
      'title', 'Direct theft of user funds',
      'source', 'template',
      'templateKey', 'smart_contract.theft_of_funds',
      'enabled', true,
      'sortOrder', 0
    )),
    'rewardTiers', jsonb_build_array(jsonb_build_object(
      'assetType', 'smart_contract', 'severity', 'critical', 'calculationType', 'range',
      'minReward', '1000', 'maxReward', '50000'
    )),
    'rules', jsonb_build_object(
      'pocPolicy', 'required',
      'rewardPolicy', 'Rewards follow the published tier table.',
      'prohibitedActivities', jsonb_build_array('No testing against the shared staging faucet.'),
      'allowCustomImpact', true
    )
  );

  ---------------------------------------------------------------- happy path
  created_program := public.create_program_atomic(owner_actor, base_input);

  select * into program_row from public.programs where id = created_program;

  if program_row.status <> 'draft'
    or program_row.total_pool <> 0
    or program_row.reserved_pool <> 0
    or program_row.paid_pool <> 0
    or program_row.available_pool <> 0
    or program_row.contract_address is not null
    or program_row.published_at is not null
  then
    raise exception 'Created program is not a zero-pool unpublished draft';
  end if;

  if program_row.poc_policy <> 'required' or program_row.allow_custom_impact is not true then
    raise exception 'Created program did not apply the rules defaults';
  end if;

  if (select count(*) from public.program_tags where program_id = created_program) <> 2
    or (select count(*) from public.program_resources where program_id = created_program) <> 1
    or (select count(*) from public.program_scopes where program_id = created_program) <> 2
  then
    raise exception 'Created program is missing tags, resources or scopes';
  end if;

  -- Platform defaults are snapshotted (5 rows) and the owner's custom rule rides along.
  if (
    select count(*) from public.program_prohibited_activities
    where program_id = created_program and source = 'platform_default'
  ) <> 5 or (
    select count(*) from public.program_prohibited_activities
    where program_id = created_program and source = 'custom'
  ) <> 1 then
    raise exception 'Platform prohibited-activity defaults were not snapshotted with the custom rule';
  end if;

  -- A template impact becomes a program-owned copy carrying provenance, never a reference.
  if not exists (
    select 1 from public.program_impacts
    where program_id = created_program
      and source = 'template'
      and template_key = 'smart_contract.theft_of_funds'
      and enabled
      and archived_at is null
  ) then
    raise exception 'Template impact was not copied into a program-owned row';
  end if;

  -- The denormalized public projection must be refreshed inside the same transaction.
  if program_row.max_bounty <> 50000
    or program_row.in_scope_asset_types <> array['smart_contract']
    or program_row.reward_severities <> array['critical']
  then
    raise exception 'Program projection was not refreshed at create time';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where actor_id = owner_actor
      and action = 'program.created'
      and entity_id = created_program::text
  ) then
    raise exception 'Program creation was not audited';
  end if;

  ---------------------------------------------------------------- role gate
  begin
    perform public.create_program_atomic(
      researcher_actor, base_input || jsonb_build_object('slug', 'cp02-researcher')
    );
    raise exception 'A researcher was allowed to create a program';
  exception
    when sqlstate '42501' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'owner_role_required' then
        raise exception 'Expected owner_role_required, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- enum-only asset types
  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-api-scope',
      'scopes', jsonb_build_array(jsonb_build_object(
        'assetType', 'api', 'assetName', 'Public API', 'isInScope', true, 'sortOrder', 0
      ))
    ));
    raise exception 'A non-enabled asset type was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'asset_type_not_enabled' then
        raise exception 'Expected asset_type_not_enabled, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- coverage rules
  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-no-impacts', 'impacts', '[]'::jsonb
    ));
    raise exception 'An in-scope asset type without impacts was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_coverage_missing' then
        raise exception 'Expected impact_coverage_missing, got %', rejected_code;
      end if;
  end;

  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-no-tiers', 'rewardTiers', '[]'::jsonb
    ));
    raise exception 'An in-scope asset type without reward tiers was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'reward_tier_coverage_missing' then
        raise exception 'Expected reward_tier_coverage_missing, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- duplicate rules
  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-dup-tier',
      'rewardTiers', jsonb_build_array(
        jsonb_build_object(
          'assetType', 'smart_contract', 'severity', 'critical', 'calculationType', 'range',
          'minReward', '1000', 'maxReward', '50000'
        ),
        jsonb_build_object(
          'assetType', 'smart_contract', 'severity', 'critical', 'calculationType', 'flat',
          'flatAmount', '777'
        )
      )
    ));
    raise exception 'A duplicate (asset type, severity) tier pair was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'reward_tier_duplicate' then
        raise exception 'Expected reward_tier_duplicate, got %', rejected_code;
      end if;
  end;

  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-dup-impact',
      'impacts', jsonb_build_array(
        jsonb_build_object(
          'assetType', 'smart_contract', 'severity', 'critical',
          'title', 'Direct theft of user funds', 'enabled', true, 'sortOrder', 0
        ),
        jsonb_build_object(
          'assetType', 'smart_contract', 'severity', 'high',
          'title', 'Direct THEFT-of-user-funds!', 'enabled', true, 'sortOrder', 1
        )
      )
    ));
    raise exception 'Two impacts with one normalized title were accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_title_duplicate' then
        raise exception 'Expected impact_title_duplicate, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- asset types must be scoped
  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-unscoped-impact',
      'scopes', jsonb_build_array(jsonb_build_object(
        'assetType', 'smart_contract', 'assetName', 'Vault', 'isInScope', true, 'sortOrder', 0
      )),
      'impacts', (base_input -> 'impacts') || jsonb_build_array(jsonb_build_object(
        'assetType', 'website', 'severity', 'high',
        'title', 'Account takeover', 'enabled', true, 'sortOrder', 1
      ))
    ));
    raise exception 'An impact for an unscoped asset type was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_asset_type_not_in_scope' then
        raise exception 'Expected impact_asset_type_not_in_scope, got %', rejected_code;
      end if;
  end;

  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-unscoped-tier',
      'scopes', jsonb_build_array(jsonb_build_object(
        'assetType', 'smart_contract', 'assetName', 'Vault', 'isInScope', true, 'sortOrder', 0
      )),
      'rewardTiers', (base_input -> 'rewardTiers') || jsonb_build_array(jsonb_build_object(
        'assetType', 'website', 'severity', 'high', 'calculationType', 'flat', 'flatAmount', '500'
      ))
    ));
    raise exception 'A reward tier for an unscoped asset type was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'reward_tier_asset_type_not_in_scope' then
        raise exception 'Expected reward_tier_asset_type_not_in_scope, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- deadline must be ahead
  begin
    perform public.create_program_atomic(owner_actor, base_input || jsonb_build_object(
      'slug', 'cp02-past-deadline', 'deadline', (now() - interval '1 day')::text
    ));
    raise exception 'A deadline in the past was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'deadline_not_in_future' then
        raise exception 'Expected deadline_not_in_future, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- slug stays unique
  begin
    perform public.create_program_atomic(owner_actor, base_input);
    raise exception 'A duplicate slug was accepted';
  exception
    when sqlstate '23505' then null;
  end;

  ---------------------------------------------------------------- canonical slug stays immutable
  begin
    update public.programs
    set slug = 'cp02-renamed-program'
    where id = created_program;
    raise exception 'An existing program slug was changed';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'program_slug_immutable' then
        raise exception 'Expected program_slug_immutable, got %', rejected_code;
      end if;
  end;
end;
$create_program_contract$;

-- Editing a program's scopes must not fail once a report references one of them.
do $scope_edit_after_report$
declare
  target_program uuid;
  program_snapshot timestamptz;
  kept_scope uuid;
begin
  select program_id into target_program from public.reports
  where id = '33000000-0000-4000-8000-000000000005';

  select id into kept_scope from public.program_scopes
  where program_id = target_program and is_in_scope and archived_at is null
  limit 1;

  select updated_at into program_snapshot from public.programs where id = target_program;

  -- Drop every scope except one brand new asset: the referenced scope must be archived,
  -- not deleted.
  perform public.update_program_atomic(
    '30000000-0000-4000-8000-000000000001',
    target_program,
    jsonb_build_object(
      'expectedUpdatedAt', program_snapshot,
      'scopes', jsonb_build_array(
        jsonb_build_object(
          'assetType', (select asset_type from public.program_scopes where id = kept_scope),
          'assetName', 'Replacement asset',
          'isInScope', true,
          'sortOrder', 0
        )
      )
    )
  );

  if not exists (
    select 1 from public.program_scopes
    where id = kept_scope and archived_at is not null
  ) then
    raise exception 'A referenced scope was removed instead of archived';
  end if;
end;
$scope_edit_after_report$;

-- MR-01: summary metrics are one whole-dataset snapshot, scoped to the authenticated researcher.
do $mr01_researcher_report_summary$
declare
  actor uuid := '30000000-0000-4000-8000-000000000002';
  owner_actor uuid := '30000000-0000-4000-8000-000000000001';
  expected_all bigint;
  expected_needs_information bigint;
  expected_under_review bigint;
  expected_rewards_paid text;
  actual_all bigint;
  actual_needs_information bigint;
  actual_under_review bigint;
  actual_rewards_paid text;
begin
  select
    count(report.id)::bigint,
    count(report.id) filter (where report.status = 'needs_information')::bigint,
    count(report.id) filter (where report.status in ('submitted', 'triaged'))::bigint,
    coalesce(
      sum(report.approved_reward) filter (where report.status = 'paid'),
      0
    )::numeric(30, 6)::text
  into
    expected_all,
    expected_needs_information,
    expected_under_review,
    expected_rewards_paid
  from public.reports report
  where report.researcher_id = actor;

  select
    summary.all_reports,
    summary.needs_information,
    summary.under_review,
    summary.rewards_paid
  into
    actual_all,
    actual_needs_information,
    actual_under_review,
    actual_rewards_paid
  from public.researcher_report_summary(actor) summary;

  if row(
    actual_all,
    actual_needs_information,
    actual_under_review,
    actual_rewards_paid
  ) is distinct from row(
    expected_all,
    expected_needs_information,
    expected_under_review,
    expected_rewards_paid
  ) then
    raise exception 'MR-01 summary does not match the researcher whole-dataset aggregate';
  end if;

  begin
    perform public.researcher_report_summary(owner_actor);
    raise exception 'MR-01 accepted a non-researcher actor';
  exception
    when sqlstate '42501' then null;
  end;

  if has_function_privilege(
    'authenticated',
    'public.researcher_report_summary(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated clients can execute the MR-01 service-only read model';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.researcher_report_summary(uuid)',
    'EXECUTE'
  ) then
    raise exception 'The API service role cannot execute the MR-01 read model';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'reports'
      and indexname = 'reports_researcher_status_submitted_at_idx'
  ) then
    raise exception 'MR-01 is missing the researcher/status aggregate index';
  end if;
end;
$mr01_researcher_report_summary$;

-- MR-02: filter options cover the researcher's complete report dataset, and only that dataset.
-- This checks the SQL read model independently of the HTTP mock so a removed researcher predicate
-- or a page-sized query cannot leak/omit options while the controller test still passes.
do $mr02_report_program_filter_options$
declare
  actor uuid := '30000000-0000-4000-8000-000000000002';
  empty_actor uuid := '39800000-0000-4000-8000-000000000001';
  expected_programs integer;
  actual_programs integer;
begin
  select count(distinct report.program_id)::integer
  into expected_programs
  from public.reports report
  where report.researcher_id = actor;

  select count(*)::integer
  into actual_programs
  from public.researcher_report_program_filter_options(actor);

  if actual_programs <> expected_programs then
    raise exception
      'MR-02 returned % program options for a dataset containing % programs',
      actual_programs, expected_programs;
  end if;

  if exists (
    select 1
    from public.researcher_report_program_filter_options(actor) option
    where not exists (
      select 1
      from public.reports report
      where report.researcher_id = actor
        and report.program_id = option.id
    )
  ) then
    raise exception 'MR-02 exposed a program without a report owned by the researcher';
  end if;

  if exists (
    select 1
    from public.researcher_report_program_filter_options(actor) option
    where option.report_count <> (
      select count(*)
      from public.reports report
      where report.researcher_id = actor
        and report.program_id = option.id
    )
  ) then
    raise exception 'MR-02 reportCount does not cover the full researcher dataset';
  end if;

  insert into auth.users (id, email, raw_user_meta_data)
  values (empty_actor, 'mr02-empty@local.demo', '{"display_name":"MR-02 Empty"}'::jsonb);
  update public.profiles
  set role = 'researcher', onboarding_completed_at = now()
  where id = empty_actor;

  if exists (
    select 1 from public.researcher_report_program_filter_options(empty_actor)
  ) then
    raise exception 'MR-02 returned options for a researcher without reports';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.researcher_report_program_filter_options(uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated clients can execute the MR-02 service-only read model';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.researcher_report_program_filter_options(uuid)',
    'EXECUTE'
  ) then
    raise exception 'The API service role cannot execute the MR-02 read model';
  end if;
end;
$mr02_report_program_filter_options$;

-- BT-03: public total-paid sorting must never read a hidden paid_pool value. The API orders this
-- generated key with NULLS LAST and then id, so all private rows are deterministic ties.
do $bt03_public_paid_sort_key$
begin
  if exists (
    select 1
    from public.programs
    where public_paid_pool is distinct from (
      case
        when total_paid_visibility = 'public' then paid_pool
      end
    )
  ) then
    raise exception 'BT-03 public_paid_pool does not match its privacy contract';
  end if;

  if exists (
    select 1
    from public.programs
    where total_paid_visibility = 'private'
      and public_paid_pool is not null
  ) then
    raise exception 'BT-03 exposes a private paid_pool through its public sort key';
  end if;
end;
$bt03_public_paid_sort_key$;

-- SR-04: submit_report_atomic owns the target report contract (reports + report_impacts). The
-- happy path must produce a submitted report whose selected impacts are snapshotted relational
-- rows, and every reject branch must raise the machine-readable code the API maps into
-- `error.code`. Seed layout: program 1 active/smart_contract/PoC-required (scope 1 in scope,
-- scope 101 out of scope, impacts 32200000-...-8001-...01..05 = informational..critical),
-- program 2 active/website, program 3 active/PoC-optional, program 7 paused.
do $sr04_submit_report_contract$
declare
  owner_actor uuid := '30000000-0000-4000-8000-000000000001';
  researcher_actor uuid := '30000000-0000-4000-8000-000000000002';
  program_one uuid := '31000000-0000-4000-8000-000000000001';
  program_two uuid := '31000000-0000-4000-8000-000000000002';
  program_optional_poc uuid := '31000000-0000-4000-8000-000000000003';
  program_paused uuid := '31000000-0000-4000-8000-000000000007';
  scope_one uuid := '32000000-0000-4000-8000-000000000001';
  scope_one_excluded uuid := '32000000-0000-4000-8000-000000000101';
  scope_two uuid := '32000000-0000-4000-8000-000000000002';
  scope_optional_poc uuid := '32000000-0000-4000-8000-000000000003';
  scope_paused uuid := '32000000-0000-4000-8000-000000000007';
  impact_low uuid := '32200000-0000-4000-8001-000000000002';
  impact_medium uuid := '32200000-0000-4000-8001-000000000003';
  impact_high uuid := '32200000-0000-4000-8001-000000000004';
  impact_critical uuid := '32200000-0000-4000-8001-000000000005';
  impact_foreign uuid := '32200000-0000-4000-8002-000000000004';
  impact_optional_poc uuid := '32200000-0000-4000-8003-000000000004';
  cross_asset_impact uuid := '39000000-0000-4000-8000-000000000001';
  base_input jsonb;
  rejected_code text;
  created_report uuid;
  submitted_report uuid;
  report_row public.reports;
  program_snapshot timestamptz;
begin
  base_input := jsonb_build_object(
    'affectedScopeId', scope_one,
    'title', 'SR-04 contract fixture',
    'description', 'Synthetic description',
    'reproductionSteps', 'Synthetic steps',
    'proposedSeverity', 'high',
    'programImpactIds', jsonb_build_array(impact_high),
    'customImpacts', '[]'::jsonb
  );

  ---------------------------------------------------------------- role gate
  begin
    perform public.submit_report_atomic(
      owner_actor, program_one, base_input, '0x' || repeat('11', 32)
    );
    raise exception 'An owner was allowed to submit a report';
  exception
    when sqlstate '42501' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'researcher_role_required' then
        raise exception 'Expected researcher_role_required, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- program must be active
  -- Paused complements the closed-program block above: every non-active status must reject.
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_paused,
      base_input || jsonb_build_object('affectedScopeId', scope_paused),
      '0x' || repeat('22', 32)
    );
    raise exception 'Submission into a paused program unexpectedly succeeded';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'program_not_accepting_reports' then
        raise exception 'Expected program_not_accepting_reports, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- scope eligibility
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('affectedScopeId', scope_one_excluded),
      '0x' || repeat('33', 32)
    );
    raise exception 'An out-of-scope asset was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'scope_not_eligible' then
        raise exception 'Expected scope_not_eligible, got %', rejected_code;
      end if;
  end;

  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('affectedScopeId', scope_two),
      '0x' || repeat('44', 32)
    );
    raise exception 'A scope belonging to another program was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'scope_not_eligible' then
        raise exception 'Expected scope_not_eligible, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- PoC policy
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('reproductionSteps', '   '),
      '0x' || repeat('55', 32)
    );
    raise exception 'A PoC-required program accepted whitespace reproduction steps';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'reproduction_steps_required' then
        raise exception 'Expected reproduction_steps_required, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- impact selection required
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('programImpactIds', '[]'::jsonb),
      '0x' || repeat('66', 32)
    );
    raise exception 'A report without any impact was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_selection_required' then
        raise exception 'Expected impact_selection_required, got %', rejected_code;
      end if;
  end;

  -- A whitespace-only custom impact passes the array-length count but writes no row, so the
  -- written-row guard (20260727063709) must reject it the same way.
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object(
        'programImpactIds', '[]'::jsonb,
        'customImpacts', jsonb_build_array('   ')
      ),
      '0x' || repeat('a7', 32)
    );
    raise exception 'A whitespace-only custom impact produced a report without impact rows';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_selection_required' then
        raise exception 'Expected impact_selection_required, got %', rejected_code;
      end if;
  end;

  if exists (
    select 1 from public.reports where content_hash = '0x' || repeat('a7', 32)
  ) then
    raise exception 'A rejected submission left a report row behind';
  end if;

  ---------------------------------------------------------------- custom impacts are opt-in
  update public.programs set allow_custom_impact = false where id = program_two;

  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_two,
      base_input || jsonb_build_object(
        'affectedScopeId', scope_two,
        'programImpactIds', '[]'::jsonb,
        'customImpacts', jsonb_build_array('Researcher proposed impact')
      ),
      '0x' || repeat('88', 32)
    );
    raise exception 'A custom impact was accepted by a program that disallows them';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'custom_impact_not_allowed' then
        raise exception 'Expected custom_impact_not_allowed, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- catalog impact eligibility
  -- Another program's impact.
  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('programImpactIds', jsonb_build_array(impact_foreign)),
      '0x' || repeat('99', 32)
    );
    raise exception 'An impact from another program was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_not_eligible' then
        raise exception 'Expected impact_not_eligible, got %', rejected_code;
      end if;
  end;

  -- Same program, wrong asset type: the impact exists and is enabled, but the affected scope is
  -- a smart contract while the impact is published for websites.
  insert into public.program_impacts (
    id, program_id, asset_type, severity, title, source, enabled, sort_order
  )
  values (
    cross_asset_impact, program_one, 'website', 'high',
    'Cross-asset impact fixture', 'custom', true, 99
  );

  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object(
        'programImpactIds', jsonb_build_array(cross_asset_impact)
      ),
      '0x' || repeat('a1', 32)
    );
    raise exception 'An impact for a different asset type was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_not_eligible' then
        raise exception 'Expected impact_not_eligible, got %', rejected_code;
      end if;
  end;

  -- Disabled and archived catalog impacts are not selectable, matching what the composer lists.
  update public.program_impacts set enabled = false where id = impact_medium;

  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('programImpactIds', jsonb_build_array(impact_medium)),
      '0x' || repeat('b1', 32)
    );
    raise exception 'A disabled impact was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_not_eligible' then
        raise exception 'Expected impact_not_eligible, got %', rejected_code;
      end if;
  end;

  update public.program_impacts set archived_at = now(), enabled = false
  where id = impact_low;

  begin
    perform public.submit_report_atomic(
      researcher_actor,
      program_one,
      base_input || jsonb_build_object('programImpactIds', jsonb_build_array(impact_low)),
      '0x' || repeat('c1', 32)
    );
    raise exception 'An archived impact was accepted';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_not_eligible' then
        raise exception 'Expected impact_not_eligible, got %', rejected_code;
      end if;
  end;

  ---------------------------------------------------------------- happy path
  submitted_report := public.submit_report_atomic(
    researcher_actor,
    program_one,
    base_input || jsonb_build_object(
      'programImpactIds', jsonb_build_array(impact_high, impact_critical),
      'customImpacts', jsonb_build_array('  Signature replay across forks  '),
      'secretGistUrl', 'https://gist.github.com/demo/sr04',
      'severityMismatchAcknowledged', true
    ),
    '0x' || repeat('d1', 32)
  );

  select * into report_row from public.reports where id = submitted_report;

  if report_row.status <> 'submitted'
    or report_row.submitted_at is null
    or report_row.content_hash <> '0x' || repeat('d1', 32)
    or report_row.program_id <> program_one
    or report_row.researcher_id <> researcher_actor
    or report_row.affected_scope_id <> scope_one
    or report_row.proposed_severity <> 'high'
    or report_row.severity_mismatch_acknowledged is not true
    or report_row.secret_gist_url <> 'https://gist.github.com/demo/sr04'
  then
    raise exception 'Submitted report row does not match the submitted payload';
  end if;

  if (
    select count(*) from public.report_impacts where report_id = submitted_report
  ) <> 3 then
    raise exception 'Submitted report does not carry exactly the selected impact rows';
  end if;

  -- Catalog selections snapshot the program-published title, severity and asset type.
  if not exists (
    select 1 from public.report_impacts
    where report_id = submitted_report
      and program_impact_id = impact_critical
      and source = 'program'
      and custom_title is null
      and impact_title_snapshot = 'Demo impact 5 for smart_contract'
      and impact_severity_snapshot = 'critical'
      and asset_type_snapshot = 'smart_contract'
  ) then
    raise exception 'Catalog impact selection was not snapshotted';
  end if;

  -- Custom rows are researcher-proposed: no catalog reference, no program-blessed severity.
  if not exists (
    select 1 from public.report_impacts
    where report_id = submitted_report
      and program_impact_id is null
      and source = 'custom'
      and custom_title = 'Signature replay across forks'
      and impact_title_snapshot = 'Signature replay across forks'
      and impact_severity_snapshot is null
      and asset_type_snapshot = 'smart_contract'
  ) then
    raise exception 'Custom impact row does not have the researcher-proposed shape';
  end if;

  if not exists (
    select 1 from public.notifications
    where recipient_id = owner_actor
      and type = 'report_submitted'
      and metadata ->> 'reportId' = submitted_report::text
  ) then
    raise exception 'Submitting did not notify the program owner';
  end if;

  ---------------------------------------------------------------- optional PoC policy
  created_report := public.submit_report_atomic(
    researcher_actor,
    program_optional_poc,
    jsonb_build_object(
      'affectedScopeId', scope_optional_poc,
      'title', 'SR-04 optional PoC fixture',
      'description', 'Synthetic description',
      'proposedSeverity', 'medium',
      'programImpactIds', jsonb_build_array(impact_optional_poc),
      'customImpacts', '[]'::jsonb
    ),
    '0x' || repeat('e1', 32)
  );

  if (
    select reproduction_steps is not null or status <> 'submitted'
    from public.reports where id = created_report
  ) then
    raise exception 'A PoC-optional program did not accept a report without steps';
  end if;

  ---------------------------------------------------------------- snapshots survive catalog edits
  -- The owner renames and re-rates the critical impact and drops the high one. The submitted
  -- report's rows must keep the submission-time content, and the dropped impact must be archived
  -- rather than deleted because report_impacts still references it.
  select updated_at into program_snapshot from public.programs where id = program_one;

  perform public.update_program_atomic(
    owner_actor,
    program_one,
    jsonb_build_object(
      'expectedUpdatedAt', program_snapshot,
      'impacts', jsonb_build_array(
        jsonb_build_object(
          'id', impact_critical,
          'assetType', 'smart_contract',
          'severity', 'low',
          'title', 'Renamed after submit',
          'enabled', true,
          'sortOrder', 0
        )
      )
    )
  );

  if not exists (
    select 1 from public.program_impacts
    where id = impact_critical and title = 'Renamed after submit' and severity = 'low'
  ) then
    raise exception 'Owner catalog edit did not apply';
  end if;

  if not exists (
    select 1 from public.program_impacts
    where id = impact_high and archived_at is not null
  ) then
    raise exception 'A selected impact was removed from the catalog instead of archived';
  end if;

  if not exists (
    select 1 from public.report_impacts
    where report_id = submitted_report
      and program_impact_id = impact_critical
      and impact_title_snapshot = 'Demo impact 5 for smart_contract'
      and impact_severity_snapshot = 'critical'
  ) or not exists (
    select 1 from public.report_impacts
    where report_id = submitted_report
      and program_impact_id = impact_high
      and impact_title_snapshot = 'Demo impact 4 for smart_contract'
      and impact_severity_snapshot = 'high'
  ) then
    raise exception 'Editing the catalog rewrote the history of a submitted report';
  end if;

  ---------------------------------------------------------------- update path keeps the rule
  -- Report 3 is the researcher's needs_information report on program 3 with one impact row.
  -- Replacing its selection with a whitespace-only custom impact must reject, and the raise must
  -- roll the delete back rather than leave the report with zero impact rows.
  begin
    perform public.update_report_atomic(
      researcher_actor,
      '33000000-0000-4000-8000-000000000003',
      jsonb_build_object('customImpacts', jsonb_build_array('   ')),
      '0x' || repeat('f2', 32),
      false
    );
    raise exception 'An update wiped the impact selection without an error';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_code = pg_exception_detail;
      if rejected_code <> 'impact_selection_required' then
        raise exception 'Expected impact_selection_required, got %', rejected_code;
      end if;
  end;

  if (
    select count(*) from public.report_impacts
    where report_id = '33000000-0000-4000-8000-000000000003'
  ) <> 1 then
    raise exception 'A rejected update did not restore the previous impact selection';
  end if;
end;
$sr04_submit_report_contract$;

do $rw02_researcher_reward_projection$
declare
  researcher_actor uuid;
  report_status_before text;
  transactions_before integer;
  settlement_reviews_before integer;
  projected_total bigint;
  expected_total bigint;
  pending_position bigint;
  approved_position bigint;
  paid_position bigint;
begin
  select researcher_id into researcher_actor
  from public.reports
  where id = '33000000-0000-4000-8000-000000000009';

  if exists (
    select 1
    from public.researcher_rewards(researcher_actor, null, 100, 0) as reward
    join public.reports as report on report.id = reward.report_id
    where report.researcher_id <> researcher_actor
  ) then
    raise exception 'Researcher reward projection crossed the report ownership boundary';
  end if;

  select count(*) into expected_total
  from public.reports
  where researcher_id = researcher_actor
    and status in ('reward_approved', 'payment_pending', 'paid');
  select total_count into projected_total
  from public.researcher_rewards(researcher_actor, null, 20, 100000)
  where report_id is null;

  if projected_total is distinct from expected_total then
    raise exception
      'Out-of-range reward page lost exact total: expected %, got %',
      expected_total,
      projected_total;
  end if;

  if not exists (
    select 1
    from public.researcher_rewards(researcher_actor, null, 100, 0)
    where report_id = '33000000-0000-4000-8000-000000000009'
      and reward_status = 'paid'
      and approved_reward = '1000.000000'
      and submitted_at is not null
      and paid_at is not null
      and payment_status = 'confirmed'
      and payment_chain_id is not null
      and payment_token_address = '0x' || repeat('b', 40)
      and payment_transaction_hash = '0x' || repeat('a', 64)
      and payment_confirmations = 12
      and payment_confirmed_at is not null
  ) then
    raise exception 'Paid reward projection did not link the confirmed payout evidence';
  end if;

  -- Pagination must happen after lifecycle-priority ordering. A client cannot safely reorder one
  -- page without corrupting the order across the complete researcher dataset.
  update public.reports
  set status = 'payment_pending'
  where id = '33000000-0000-4000-8000-000000000006'
    and researcher_id = researcher_actor
    and status = 'reward_approved';

  select
    min(position) filter (where reward_status = 'payment_pending'),
    min(position) filter (where reward_status = 'reward_approved'),
    min(position) filter (where reward_status = 'paid')
  into pending_position, approved_position, paid_position
  from public.researcher_rewards(researcher_actor, null, 100, 0)
    with ordinality as reward(
      report_id,
      program_id,
      program_name,
      report_title,
      final_severity,
      reward_status,
      approved_reward,
      submitted_at,
      reward_approved_at,
      payment_chain_id,
      payment_token_address,
      payment_transaction_hash,
      payment_status,
      payment_confirmations,
      payment_confirmed_at,
      paid_at,
      total_count,
      position
    );

  if pending_position is null
    or approved_position is null
    or paid_position is null
    or not (pending_position < approved_position and approved_position < paid_position)
  then
    raise exception
      'Reward projection order is not payment_pending -> reward_approved -> paid: %, %, %',
      pending_position,
      approved_position,
      paid_position;
  end if;

  if exists (
    select 1
    from public.researcher_rewards(researcher_actor, 'paid', 100, 0)
    where reward_status <> 'paid'
  ) then
    raise exception 'Reward status filter returned another lifecycle state';
  end if;

  begin
    perform 1
    from public.researcher_rewards(
      '30000000-0000-4000-8000-000000000001',
      null,
      20,
      0
    );
    raise exception 'Owner identity read the researcher-only reward projection';
  exception
    when sqlstate '42501' then null;
  end;

  -- Settlement RPCs independently reject a researcher even when they know a report UUID.
  begin
    perform public.approve_report_reward_atomic(
      researcher_actor,
      '33000000-0000-4000-8000-000000000005',
      1000
    );
    raise exception 'Researcher approved a reward';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.start_report_payment_atomic(
      researcher_actor,
      '33000000-0000-4000-8000-000000000009',
      '0x' || repeat('e', 64),
      '0x' || repeat('f', 40)
    );
    raise exception 'Researcher started a payout';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform public.confirm_report_payment_atomic(
      researcher_actor,
      '33000000-0000-4000-8000-000000000009',
      9999,
      '0x' || repeat('d', 64),
      12
    );
    raise exception 'Researcher confirmed a payout';
  exception
    when sqlstate '42501' then null;
  end;

  -- AI rows are passive assistance. Writing one must not create reviews, transactions or a
  -- settlement state transition.
  select status into report_status_before
  from public.reports
  where id = '33000000-0000-4000-8000-000000000017';
  select count(*) into transactions_before from public.escrow_transactions;
  select count(*) into settlement_reviews_before
  from public.report_reviews
  where action in ('approve_reward', 'start_payment', 'confirm_payment');

  insert into public.ai_triage_results (
    id,
    report_id,
    provider,
    model,
    schema_version,
    result,
    confidence
  )
  values (
    '88000000-0000-4000-8000-000000000002',
    '33000000-0000-4000-8000-000000000017',
    'mock',
    'rw02-passive-assistance',
    1,
    '{"summary":"No settlement instruction","suggestedSeverity":"low"}'::jsonb,
    0.5
  );

  if (
    select status <> report_status_before
    from public.reports
    where id = '33000000-0000-4000-8000-000000000017'
  ) or (select count(*) from public.escrow_transactions) <> transactions_before
    or (
      select count(*) from public.report_reviews
      where action in ('approve_reward', 'start_payment', 'confirm_payment')
    ) <> settlement_reviews_before
  then
    raise exception 'AI output triggered a settlement side effect';
  end if;
end;
$rw02_researcher_reward_projection$;

do $rw04_researcher_payout_wallet$
declare
  researcher_actor uuid := '30000000-0000-4000-8000-000000000002';
  inactive_actor uuid := '30000000-0000-4000-8000-000000000098';
  first_wallet text := '0x' || repeat('A', 40);
  normalized_first_wallet text := '0x' || repeat('a', 40);
  replacement_wallet text := '0x' || repeat('b', 40);
  audit_count integer;
begin
  if has_function_privilege(
    'authenticated',
    'public.researcher_payout_wallet(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.set_researcher_payout_wallet(uuid,text,boolean)',
    'execute'
  ) then
    raise exception 'Authenticated clients could bypass the payout-wallet API boundary';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.researcher_payout_wallet(uuid)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.set_researcher_payout_wallet(uuid,text,boolean)',
    'execute'
  ) then
    raise exception 'Service role cannot execute the payout-wallet RPCs';
  end if;

  if not exists (
    select 1
    from public.researcher_payout_wallet(researcher_actor)
    where wallet_address is null
      and wallet_updated_at is null
      and has_active_rewards
  ) then
    raise exception 'Researcher wallet read did not expose the active-reward requirement';
  end if;

  begin
    perform 1
    from public.researcher_payout_wallet('30000000-0000-4000-8000-000000000001');
    raise exception 'Owner read the researcher-only payout wallet';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    perform 1
    from public.set_researcher_payout_wallet(
      researcher_actor,
      'not-an-address',
      false
    );
    raise exception 'Invalid payout wallet unexpectedly succeeded';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'wallet_address_invalid' then
        raise;
      end if;
  end;

  perform 1
  from public.set_researcher_payout_wallet(researcher_actor, first_wallet, false);

  if not exists (
    select 1
    from public.researcher_payout_wallet(researcher_actor)
    where wallet_address = normalized_first_wallet
      and wallet_updated_at is not null
      and has_active_rewards
  ) then
    raise exception 'Payout wallet was not normalized and stored for the researcher';
  end if;

  select count(*) into audit_count
  from public.audit_logs
  where actor_id = researcher_actor
    and action = 'profile.payout_wallet_set'
    and metadata @> '{"network":"Arc","asset":"USDC","hadPreviousDestination":false}'::jsonb
    and metadata::text not like '%' || normalized_first_wallet || '%';

  if audit_count <> 1 then
    raise exception 'Initial payout-wallet write did not create one redacted audit event';
  end if;

  begin
    perform 1
    from public.set_researcher_payout_wallet(researcher_actor, replacement_wallet, false);
    raise exception 'Active payout wallet changed without explicit confirmation';
  exception
    when sqlstate '22023' then null;
  end;

  if (
    select wallet_address <> normalized_first_wallet
    from public.profiles
    where id = researcher_actor
  ) then
    raise exception 'Rejected payout-wallet replacement changed the stored destination';
  end if;

  perform 1
  from public.set_researcher_payout_wallet(researcher_actor, replacement_wallet, true);
  perform 1
  from public.set_researcher_payout_wallet(researcher_actor, replacement_wallet, false);

  select count(*) into audit_count
  from public.audit_logs
  where actor_id = researcher_actor
    and action in ('profile.payout_wallet_set', 'profile.payout_wallet_changed');

  if audit_count <> 2 or not exists (
    select 1
    from public.audit_logs
    where actor_id = researcher_actor
      and action = 'profile.payout_wallet_changed'
      and metadata @> '{"activeRewardChangeConfirmed":true}'::jsonb
      and metadata::text not like '%' || replacement_wallet || '%'
  ) then
    raise exception 'Confirmed payout-wallet replacement audit is missing or not redacted';
  end if;

  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (
    inactive_actor,
    'inactive-wallet@local.demo',
    '__DEMO_PASSWORD_HASH__',
    '{"display_name":"Inactive Researcher"}'
  );

  begin
    perform 1
    from public.set_researcher_payout_wallet(inactive_actor, normalized_first_wallet, false);
    raise exception 'Researcher without an active reward configured a payout wallet';
  exception
    when sqlstate '22023' then null;
  end;
end;
$rw04_researcher_payout_wallet$;

-- AI-011/AI-008: durable same-program FIFO and prior-only candidate retrieval.  The fixture
-- reports are synthetic demo rows with identical narratives in program 10 (reports 41 and 49).
do $ai_queue_fifo$
declare
  first_run public.ai_triage_runs;
  second_run public.ai_triage_runs;
  claimed public.ai_triage_runs;
  blocked_claim public.ai_triage_runs;
  candidate_count integer;
begin
  perform public.enqueue_report_ai_run_atomic(
    '33000000-0000-4000-8000-000000000041',
    '31000000-0000-4000-8000-000000000010',
    '0x' || repeat('1', 64)
  );
  perform public.enqueue_report_ai_run_atomic(
    '33000000-0000-4000-8000-000000000049',
    '31000000-0000-4000-8000-000000000010',
    '0x' || repeat('2', 64)
  );

  select * into first_run
  from public.ai_triage_runs
  where report_id = '33000000-0000-4000-8000-000000000041';
  select * into second_run
  from public.ai_triage_runs
  where report_id = '33000000-0000-4000-8000-000000000049';

  if first_run.program_submission_sequence >= second_run.program_submission_sequence then
    raise exception 'AI queue did not allocate monotonic program sequence';
  end if;

  select * into claimed from public.claim_ai_triage_run_for_program(
    'workflow-test', '31000000-0000-4000-8000-000000000010', 300
  );
  if claimed.id is distinct from first_run.id or claimed.status <> 'running' then
    raise exception 'AI queue did not claim the FIFO head (got %, expected %, second %)', claimed.id, first_run.id, second_run.id;
  end if;

  select * into blocked_claim from public.claim_ai_triage_run_for_program(
    'workflow-test-2', '31000000-0000-4000-8000-000000000010', 300
  );
  if blocked_claim.id is not null and blocked_claim.id = second_run.id then
    raise exception 'AI queue claimed a later job while its predecessor was running';
  end if;

  update public.ai_triage_runs
  set status = 'completed', finished_at = now(), persisted_at = now()
  where id = claimed.id and locked_by = claimed.locked_by;

  select * into claimed from public.claim_ai_triage_run_for_program(
    'workflow-test-2', '31000000-0000-4000-8000-000000000010', 300
  );
  if claimed.id is distinct from second_run.id or claimed.status <> 'running' then
    raise exception 'AI queue did not release the next FIFO job after terminal completion (got %, expected %, blocked %, first %)',
      claimed.id, second_run.id, blocked_claim.id, first_run.id;
  end if;

  select count(*) into candidate_count
  from public.list_ai_duplicate_candidates(second_run.id, 10)
  where report_id = first_run.report_id
    and program_submission_sequence < second_run.program_submission_sequence;

  if candidate_count <> 1 then
    raise exception 'AI candidate retrieval did not return the prior same-program report';
  end if;
end;
$ai_queue_fifo$;

rollback;
