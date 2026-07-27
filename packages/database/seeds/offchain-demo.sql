-- Local/demo-only deterministic data.
-- Provenance: all vulnerability narratives below are synthetic, rewritten
-- summaries inspired by common patterns in public security disclosures.
-- They contain no private exploit, customer, or production credential data.
--
-- Program lifecycle covered: 1-5 active, 6 draft, 7 paused, 8 expired, 9 closed, 10 active.
-- Reports 1-40 are pinned by tests/offchain/verify_workflows.sql, which addresses individual
-- report ids. They are generated exactly as before; program 10 and reports 41-60 are appended
-- rather than folded into the same series so those ids never shift.
-- Pool figures are derived from the seeded reports at the end of the script so the
-- reserved / paid accounting always satisfies programs_pool_solvency_check.

begin;

delete from public.notifications where recipient_id::text like '30000000-%';
delete from public.ai_triage_results where report_id::text like '33000000-%';
delete from public.report_attachments where report_id::text like '33000000-%';
delete from public.report_disclosures where report_id::text like '33000000-%';
delete from public.escrow_transactions where program_id::text like '31000000-%';
delete from public.escrow_contracts where program_id::text like '31000000-%';
delete from public.report_reviews where id::text like '35000000-%';
delete from public.report_comments where id::text like '34000000-%';
delete from public.report_impacts where report_id::text like '33000000-%';
delete from public.reports where id::text like '33000000-%';
delete from public.program_reviewers where program_id::text like '31000000-%';
delete from public.program_prohibited_activities where program_id::text like '31000000-%';
delete from public.program_resources where program_id::text like '31000000-%';
delete from public.program_tags where program_id::text like '31000000-%';
delete from public.program_impacts where program_id::text like '31000000-%';
delete from public.program_reward_tiers where program_id::text like '31000000-%';
delete from public.program_scopes where id::text like '32000000-%';
delete from public.programs where id::text like '31000000-%';
/*
 * Users are upserted, not deleted and recreated. `audit_logs.actor_id` references profiles with
 * ON DELETE RESTRICT and the table is append-only by trigger, so once anyone has touched the API
 * the demo accounts can no longer be deleted — reseeding a database that had been used at all
 * failed on the foreign key. Keeping the rows also keeps that audit history, which is the whole
 * point of an append-only log.
 */
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
values
  ('30000000-0000-4000-8000-000000000001', 'owner@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Demo Owner"}'),
  ('30000000-0000-4000-8000-000000000002', 'researcher@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Demo Researcher"}'),
  ('30000000-0000-4000-8000-000000000003', 'reviewer@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Demo Reviewer"}'),
  ('30000000-0000-4000-8000-000000000004', 'owner2@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Nova Labs"}'),
  ('30000000-0000-4000-8000-000000000005', 'researcher2@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Ivy Tran"}'),
  ('30000000-0000-4000-8000-000000000006', 'researcher3@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Milo Reyes"}'),
  ('30000000-0000-4000-8000-000000000007', 'reviewer2@local.demo', '__DEMO_PASSWORD_HASH__', '{"display_name":"Priya Raman"}')
on conflict (id) do update set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  raw_user_meta_data = excluded.raw_user_meta_data;

update public.profiles
set
  role = case id
    when '30000000-0000-4000-8000-000000000001' then 'owner'
    when '30000000-0000-4000-8000-000000000004' then 'owner'
    when '30000000-0000-4000-8000-000000000003' then 'reviewer'
    when '30000000-0000-4000-8000-000000000007' then 'reviewer'
    else 'researcher'
  end,
  onboarding_completed_at = now()
where id::text like '30000000-%';

-- Each program uses a single asset type so scopes, impacts and reward tiers line up cleanly.
create temporary table demo_programs on commit drop as
select
  series,
  ('31000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid as program_id,
  -- Only the product-enabled asset types; api and mobile have no authoring UI yet.
  (array['smart_contract', 'website'])[((series - 1) % 2) + 1] as asset_type,
  (array[
    'active', 'active', 'active', 'active', 'active',
    'draft', 'paused', 'expired', 'closed', 'active'
  ])[series] as status,
  -- A second owner exists so owner-scoped queries and RLS are exercised against more than one
  -- account; every list endpoint would look correct with a single owner even if it ignored the id.
  case when series = 10
    then '30000000-0000-4000-8000-000000000004'
    else '30000000-0000-4000-8000-000000000001'
  end::uuid as owner_id
from generate_series(1, 10) as series;

insert into public.programs (
  id, owner_id, name, slug, short_summary, description, website_url, status,
  total_pool, total_paid_visibility, poc_policy, reward_policy,
  deadline, published_at, closed_at
)
select
  program_id,
  owner_id,
  'Demo Security Program ' || series,
  'demo-security-program-' || series,
  'Synthetic demo program for a fictional product used by the local environment only.',
  'Synthetic demo program for a fictional product. No production system is identified. '
    || 'Scope, impacts and reward tiers below are illustrative.',
  'https://demo-' || series || '.example.test',
  status,
  -- A draft has no escrow contract yet, so it must not look funded.
  case when status = 'draft' then 0 else 100000 end,
  case when series % 2 = 0 then 'private' else 'public' end,
  case when series % 3 = 0 then 'optional' else 'required' end,
  'Rewards are illustrative. Duplicate submissions and issues already known to the team are '
    || 'not eligible. Final severity is decided by the reviewer.',
  case
    when status = 'closed' then null
    when status = 'expired' then now() - interval '5 days'
    else now() + (series * interval '14 days')
  end,
  case when status in ('active', 'paused', 'expired') then now() - interval '30 days' else null end,
  case when status = 'closed' then now() - interval '2 days' else null end
from demo_programs;

insert into public.program_tags (program_id, label)
select program_id, tag
from demo_programs
cross join lateral (
  values ('DeFi'), ('Solidity'), ('Demo')
) as tags(tag);

insert into public.program_resources (program_id, resource_type, title, url, sort_order)
select program_id, 'documentation', 'Demo documentation', 'https://docs-' || series || '.example.test', 0
from demo_programs;

-- One in-scope and one excluded asset per program.
insert into public.program_scopes (
  id, program_id, asset_type, asset_name, asset_url, is_in_scope, description, sort_order
)
select
  ('32000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  program_id,
  asset_type,
  'Demo asset ' || series,
  'https://demo-' || series || '.example.test',
  true,
  'Synthetic in-scope asset used only by the local demo.',
  0
from demo_programs
union all
select
  ('32000000-0000-4000-8000-' || lpad((series + 100)::text, 12, '0'))::uuid,
  program_id,
  asset_type,
  'Demo excluded asset ' || series,
  'https://legacy-' || series || '.example.test',
  false,
  'Synthetic out-of-scope asset kept to exercise the excluded-assets section.',
  1
from demo_programs;

insert into public.program_impacts (
  id, program_id, asset_type, severity, title, description, source, enabled, sort_order
)
select
  (
    '32200000-0000-4000-' ||
    lpad(demo_programs.series::text, 4, '0') || '-' ||
    lpad(severity_number::text, 12, '0')
  )::uuid,
  program_id,
  asset_type,
  (array['informational', 'low', 'medium', 'high', 'critical'])[severity_number],
  'Demo impact ' || severity_number || ' for ' || asset_type,
  'Synthetic impact description used only by the local demo.',
  'custom',
  true,
  severity_number - 1
from demo_programs
cross join generate_series(1, 5) as severity_number;

insert into public.program_reward_tiers (
  id, program_id, asset_type, severity, calculation_type, min_reward, max_reward
)
select
  (
    '32100000-0000-4000-' ||
    lpad(demo_programs.series::text, 4, '0') || '-' ||
    lpad(severity_number::text, 12, '0')
  )::uuid,
  program_id,
  asset_type,
  (array['informational', 'low', 'medium', 'high', 'critical'])[severity_number],
  'range',
  (severity_number - 1) * 500,
  severity_number * 2500
from demo_programs
cross join generate_series(1, 5) as severity_number;

-- Replace the critical range tier with a capped percentage tier so the derived-reward path is
-- represented in the demo data.
update public.program_reward_tiers
set
  calculation_type = 'percentage',
  min_reward = null,
  max_reward = null,
  percentage_bps = 1000,
  max_reward_cap = 250000,
  calculation_note = '10% of directly affected funds, capped at 250,000 USDC'
where program_id in (select program_id from demo_programs)
  and severity = 'critical';

insert into public.program_prohibited_activities (
  program_id, source, rule_key, body, sort_order
)
select program_id, 'platform_default', defaults.rule_key, defaults.body, defaults.sort_order
from demo_programs
cross join public.platform_prohibited_activities() as defaults;

-- Every program keeps the primary reviewer; the even-numbered ones also carry the second so the
-- reviewer inbox is not identical for both accounts.
insert into public.program_reviewers (program_id, reviewer_id, assigned_by)
select program_id, '30000000-0000-4000-8000-000000000003'::uuid, owner_id
from demo_programs
union all
select program_id, '30000000-0000-4000-8000-000000000007'::uuid, owner_id
from demo_programs
where series % 2 = 0;

-- Reports only exist for programs researchers could actually reach (never the draft).
create temporary table demo_reports on commit drop as
select
  report_number as series,
  ('33000000-0000-4000-8000-' || lpad(report_number::text, 12, '0'))::uuid as report_id,
  source.program_id,
  source.asset_type,
  ('32000000-0000-4000-8000-' || lpad(source.series::text, 12, '0'))::uuid as scope_id,
  (array[
    'submitted', 'triaged', 'needs_information', 'rejected',
    'validated', 'reward_approved', 'duplicate', 'paid'
  ])[((report_number - 1) % 8) + 1] as status,
  (array['low', 'medium', 'high', 'critical', 'informational'])[
    ((report_number - 1) % 5) + 1
  ] as severity,
  '30000000-0000-4000-8000-000000000002'::uuid as researcher_id
from generate_series(1, 40) as report_number
join lateral (
  select *
  from demo_programs
  where demo_programs.series = (array[1, 2, 3, 4, 5, 8, 9])[((report_number - 1) % 7) + 1]
) as source on true

union all

/*
 * Program 10 only. Kept out of the series above because that one picks a program with `% 7`, and
 * widening the array to eight entries would put the program cycle in lockstep with the eight-value
 * status cycle — program 10 would then only ever hold a single status. It would also renumber which
 * program every existing report belongs to, and verify_workflows.sql addresses reports by id.
 */
select
  report_number as series,
  ('33000000-0000-4000-8000-' || lpad(report_number::text, 12, '0'))::uuid as report_id,
  source.program_id,
  source.asset_type,
  ('32000000-0000-4000-8000-' || lpad(source.series::text, 12, '0'))::uuid as scope_id,
  (array[
    'submitted', 'triaged', 'needs_information', 'rejected',
    'validated', 'reward_approved', 'duplicate', 'paid'
  ])[((report_number - 41) % 8) + 1] as status,
  (array['low', 'medium', 'high', 'critical', 'informational'])[
    ((report_number - 41) % 5) + 1
  ] as severity,
  -- Three researchers so "my reports" is a real filter rather than the whole table.
  (array[
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000006'
  ])[((report_number - 41) % 3) + 1]::uuid as researcher_id
from generate_series(41, 60) as report_number
join lateral (
  select * from demo_programs where demo_programs.series = 10
) as source on true;

insert into public.reports (
  id, program_id, researcher_id, affected_scope_id, title, description,
  reproduction_steps, secret_gist_url, proposed_severity, severity_mismatch_acknowledged,
  final_severity, status,
  content_hash, approved_reward, reward_approved_at, created_at, submitted_at, paid_at
)
select
  report_id,
  program_id,
  researcher_id,
  scope_id,
  'Synthetic disclosure ' || series,
  'Rewritten demo narrative describing a generic authorization boundary weakness.',
  'Use the local fixture account, open the demo resource, and compare the expected '
    || 'authorization response.',
  case when series % 5 = 0 then 'https://gist.github.com/demo/' || series else null end,
  severity,
  series % 4 = 0,
  case when status in ('validated', 'reward_approved', 'paid') then severity else null end,
  status,
  '0x' || lpad(to_hex(series), 64, '0'),
  case when status in ('reward_approved', 'paid') then 1500 else null end,
  case when status in ('reward_approved', 'paid') then now() - interval '3 days' else null end,
  -- reports_submitted_at_check requires submitted_at >= created_at.
  now() - interval '11 days',
  now() - interval '10 days',
  case when status = 'paid' then now() - interval '1 day' else null end
from demo_reports;

-- Every report claims at least one catalog impact, matching its scope's asset type.
insert into public.report_impacts (
  report_id, program_id, program_impact_id, source,
  impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
)
select
  demo_reports.report_id,
  demo_reports.program_id,
  impact.id,
  'program',
  impact.title,
  impact.severity,
  impact.asset_type
from demo_reports
join public.program_impacts impact
  on impact.program_id = demo_reports.program_id
  and impact.asset_type = demo_reports.asset_type
  and impact.severity = demo_reports.severity;

insert into public.report_comments (id, report_id, author_id, body)
select
  ('34000000-0000-4000-8000-' || lpad(demo_reports.series::text, 12, '0'))::uuid,
  demo_reports.report_id,
  case when demo_reports.series % 2 = 0 then demo_programs.owner_id else demo_reports.researcher_id end,
  'Synthetic demo comment ' || demo_reports.series || '; no private exploit detail is included.'
from demo_reports
join demo_programs on demo_programs.program_id = demo_reports.program_id;

insert into public.report_reviews (
  id, report_id, reviewer_id, action, from_status, to_status, reason, metadata
)
select
  ('35000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  report_id,
  case when series % 3 = 0
    then '30000000-0000-4000-8000-000000000007'::uuid
    else '30000000-0000-4000-8000-000000000003'::uuid
  end,
  case status
    when 'needs_information' then 'request_information'
    when 'rejected' then 'reject'
    when 'duplicate' then 'mark_duplicate'
    when 'validated' then 'validate'
    when 'reward_approved' then 'approve_reward'
    when 'paid' then 'approve_reward'
    else 'triage'
  end,
  case status
    when 'reward_approved' then 'validated'
    when 'paid' then 'validated'
    else 'submitted'
  end,
  case status
    when 'needs_information' then 'needs_information'
    when 'rejected' then 'rejected'
    when 'duplicate' then 'duplicate'
    when 'validated' then 'validated'
    when 'reward_approved' then 'reward_approved'
    when 'paid' then 'reward_approved'
    else 'triaged'
  end,
  case status
    when 'needs_information' then 'Synthetic review reason'
    when 'rejected' then 'Synthetic review reason'
    when 'duplicate' then 'Synthetic review reason'
    else null
  end,
  '{"demo":true}'::jsonb
from demo_reports
where status <> 'submitted';

-- Escrow: one confirmed contract and one funding transaction per non-draft program.
insert into public.escrow_contracts (
  id, program_id, chain_id, contract_address, deployment_transaction_hash,
  deployment_status, created_at, deployed_at
)
select
  ('36000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  program_id,
  1337,
  '0x' || lpad(to_hex(1000 + series), 40, '0'),
  '0x' || lpad(to_hex(2000 + series), 64, '0'),
  'confirmed',
  -- deployed_at must not precede created_at.
  now() - interval '41 days',
  now() - interval '40 days'
from demo_programs
where status <> 'draft';

insert into public.escrow_transactions (
  program_id, escrow_contract_id, chain_id, transaction_hash, transaction_type,
  status, token_address, amount, block_number, block_hash, confirmations,
  created_at, confirmed_at
)
select
  program_id,
  ('36000000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
  1337,
  '0x' || lpad(to_hex(3000 + series), 64, '0'),
  'funding',
  'confirmed',
  '0x' || lpad(to_hex(9999), 40, '0'),
  100000,
  100 + series,
  '0x' || lpad(to_hex(4000 + series), 64, '0'),
  12,
  now() - interval '40 days',
  now() - interval '39 days'
from demo_programs
where status <> 'draft';

insert into public.escrow_transactions (
  program_id, report_id, escrow_contract_id, chain_id, transaction_hash,
  transaction_type, status, token_address, amount,
  block_number, block_hash, confirmations, created_at, confirmed_at
)
select
  demo_reports.program_id,
  demo_reports.report_id,
  ('36000000-0000-4000-8000-' || lpad(demo_programs.series::text, 12, '0'))::uuid,
  1337,
  '0x' || lpad(to_hex(5000 + demo_reports.series), 64, '0'),
  'payout',
  'confirmed',
  '0x' || lpad(to_hex(9999), 40, '0'),
  1500,
  200 + demo_reports.series,
  '0x' || lpad(to_hex(6000 + demo_reports.series), 64, '0'),
  12,
  now() - interval '2 days',
  now() - interval '1 day'
from demo_reports
join demo_programs on demo_programs.program_id = demo_reports.program_id
where demo_reports.status = 'paid';

-- Public disclosures only exist for ended programs and only where the owner opted in.
insert into public.report_disclosures (
  report_id, program_id, decision, decided_by,
  public_title, public_summary, public_severity, created_at, published_at
)
select
  demo_reports.report_id,
  demo_reports.program_id,
  'publish_summary',
  '30000000-0000-4000-8000-000000000001',
  'Resolved: synthetic authorization weakness ' || demo_reports.series,
  'A synthetic authorization boundary weakness was reported and resolved. '
    || 'This summary is written for public disclosure and contains no exploit detail.',
  demo_reports.severity,
  now() - interval '2 days',
  now() - interval '1 day'
from demo_reports
join demo_programs on demo_programs.program_id = demo_reports.program_id
where demo_programs.status in ('expired', 'closed')
  and demo_reports.status in ('paid', 'validated');

-- Attachments for every fifth report, covering all three upload states. Rows are metadata only:
-- no object is written to storage, so a signed-URL request for one of these will 404 at the
-- storage layer — which is the point, the demo must never imply real uploaded content exists.
insert into public.report_attachments (
  id, report_id, uploader_id, storage_bucket, storage_path,
  original_filename, mime_type, size_bytes, checksum_sha256,
  upload_status, created_at, uploaded_at
)
select
  attachment.id,
  demo_reports.report_id,
  demo_reports.researcher_id,
  'report-attachments',
  -- Same shape `request_report_attachment_upload` builds, so paths look identical to real ones.
  'reports/' || demo_reports.report_id::text || '/' || attachment.id::text || '/'
    || attachment.filename,
  attachment.filename,
  attachment.mime_type,
  attachment.size_bytes,
  case when attachment.upload_status = 'uploaded'
    then lpad(to_hex(demo_reports.series * attachment.slot), 64, '0')
    else null
  end,
  attachment.upload_status,
  now() - interval '9 days',
  case when attachment.upload_status = 'uploaded'
    then now() - interval '9 days' + interval '2 hours'
    else null
  end
from demo_reports
cross join lateral (
  values
    (
      ('37000000-0000-4000-8000-' || lpad((demo_reports.series * 3 - 2)::text, 12, '0'))::uuid,
      1, 'reproduction-notes.md', 'text/markdown', 4096, 'uploaded'
    ),
    (
      ('37000000-0000-4000-8000-' || lpad((demo_reports.series * 3 - 1)::text, 12, '0'))::uuid,
      2, 'request-capture.json', 'application/json', 18342, 'uploaded'
    ),
    (
      ('37000000-0000-4000-8000-' || lpad((demo_reports.series * 3)::text, 12, '0'))::uuid,
      3, 'annotated-screenshot.png', 'image/png', 262144,
      case when demo_reports.series % 10 = 0 then 'failed' else 'pending' end
    )
) as attachment(id, slot, filename, mime_type, size_bytes, upload_status)
where demo_reports.series % 5 = 0;

-- Triage results: the mock provider succeeds for most reports and fails for a few, so both arms
-- of ai_triage_results_outcome_check are represented.
insert into public.ai_triage_results (
  id, report_id, provider, model, schema_version, result, confidence,
  error_code, error_message, created_at
)
select
  ('38000000-0000-4000-8000-' || lpad(demo_reports.series::text, 12, '0'))::uuid,
  demo_reports.report_id,
  'mock',
  'mock-triage-1',
  1,
  case when demo_reports.series % 9 = 0 then null else jsonb_build_object(
    'suggestedSeverity', demo_reports.severity,
    'summary', 'Synthetic triage summary; no exploit detail is stored.',
    'signals', jsonb_build_array('scope_match', 'severity_plausible'),
    'duplicateOf', null
  ) end,
  case when demo_reports.series % 9 = 0
    then null
    else round((0.55 + ((demo_reports.series % 8) * 0.05))::numeric, 2)
  end,
  case when demo_reports.series % 9 = 0 then 'provider_timeout' else null end,
  case when demo_reports.series % 9 = 0
    then 'The triage provider did not respond within the timeout.'
    else null
  end,
  now() - interval '10 days' + interval '30 minutes'
from demo_reports
where demo_reports.status <> 'submitted';

-- Notifications: one per review that happened, addressed to the researcher, plus a submission
-- notice to the program owner. Metadata carries identifiers only — the check constraint rejects
-- report titles, descriptions and anything credential-shaped.
insert into public.notifications (id, recipient_id, type, metadata, read_at, created_at)
select
  ('39000000-0000-4000-8000-' || lpad(demo_reports.series::text, 12, '0'))::uuid,
  demo_reports.researcher_id,
  case demo_reports.status
    when 'needs_information' then 'information_requested'
    when 'rejected' then 'report_rejected'
    when 'duplicate' then 'report_duplicate'
    when 'validated' then 'report_validated'
    when 'reward_approved' then 'reward_approved'
    when 'paid' then 'payment_confirmed'
    else 'comment_added'
  end,
  jsonb_build_object(
    'reportId', demo_reports.report_id,
    'programId', demo_reports.program_id
  ),
  -- Leaving the newest third unread gives the badge a non-zero count to render.
  case when demo_reports.series % 3 = 0 then null else now() - interval '2 days' end,
  now() - interval '3 days'
from demo_reports
where demo_reports.status <> 'submitted'

union all

select
  ('39100000-0000-4000-8000-' || lpad(demo_reports.series::text, 12, '0'))::uuid,
  demo_programs.owner_id,
  'report_submitted',
  jsonb_build_object(
    'reportId', demo_reports.report_id,
    'programId', demo_reports.program_id
  ),
  case when demo_reports.series % 4 = 0 then now() - interval '1 day' else null end,
  now() - interval '3 days'
from demo_reports
join demo_programs on demo_programs.program_id = demo_reports.program_id;

-- Derive pool accounting from the reports just inserted.
update public.programs
set
  reserved_pool = coalesce(totals.reserved, 0),
  paid_pool = coalesce(totals.paid, 0),
  paid_report_count = coalesce(totals.paid_count, 0)
from (
  select
    program_id,
    sum(approved_reward) filter (
      where status in ('reward_approved', 'payment_pending')
    ) as reserved,
    sum(approved_reward) filter (where status = 'paid') as paid,
    count(*) filter (where status = 'paid') as paid_count
  from public.reports
  where id::text like '33000000-%'
  group by program_id
) as totals
where programs.id = totals.program_id;

-- Refresh the denormalized columns the public bounty table sorts and filters on.
select public.refresh_program_projection(id)
from public.programs
where id::text like '31000000-%';

commit;
