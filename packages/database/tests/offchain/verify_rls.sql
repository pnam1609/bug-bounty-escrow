\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('20000000-0000-4000-8000-000000000001', 'owner-one@example.test', '{"display_name":"Owner One"}'),
  ('20000000-0000-4000-8000-000000000002', 'owner-two@example.test', '{"display_name":"Owner Two"}'),
  (
    '20000000-0000-4000-8000-000000000003',
    'researcher-one@example.test',
    '{"display_name":"Researcher One","role":"reviewer"}'
  ),
  ('20000000-0000-4000-8000-000000000004', 'researcher-two@example.test', '{}'),
  ('20000000-0000-4000-8000-000000000005', 'reviewer@example.test', '{"display_name":"Reviewer"}');

update public.profiles
set
  role = case id
    when '20000000-0000-4000-8000-000000000001' then 'owner'
    when '20000000-0000-4000-8000-000000000002' then 'owner'
    when '20000000-0000-4000-8000-000000000005' then 'reviewer'
    else 'researcher'
  end,
  onboarding_completed_at = now();

do $bootstrap_safety$
begin
  if (
    select role from public.profiles
    where id = '20000000-0000-4000-8000-000000000003'
  ) <> 'researcher' then
    raise exception 'Auth metadata escalated the bootstrap role';
  end if;
end;
$bootstrap_safety$;

insert into public.programs (
  id, owner_id, name, slug, short_summary, description, website_url,
  status, total_pool, published_at, closed_at
)
values
  (
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000001',
    'Public program',
    'public-program',
    'Public fixture summary',
    'Public fixture',
    'https://public.example.test',
    'active',
    1000,
    now(),
    null
  ),
  (
    '20000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000001',
    'Owner one draft',
    'owner-one-draft',
    'Private fixture summary',
    'Private fixture',
    'https://draft-one.example.test',
    'draft',
    0,
    null,
    null
  ),
  (
    '20000000-0000-4000-8000-000000000102',
    '20000000-0000-4000-8000-000000000002',
    'Owner two draft',
    'owner-two-draft',
    'Other private fixture summary',
    'Other private fixture',
    'https://draft-two.example.test',
    'draft',
    0,
    null,
    null
  ),
  -- Ended programs stay publicly readable; paused ones must not.
  (
    '20000000-0000-4000-8000-000000000103',
    '20000000-0000-4000-8000-000000000001',
    'Ended program',
    'ended-program',
    'Ended fixture summary',
    'Ended fixture',
    'https://ended.example.test',
    'closed',
    1000,
    now() - interval '30 days',
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000104',
    '20000000-0000-4000-8000-000000000001',
    'Paused program',
    'paused-program',
    'Paused fixture summary',
    'Paused fixture',
    'https://paused.example.test',
    'paused',
    1000,
    now() - interval '30 days',
    null
  );

insert into public.program_reviewers (program_id, reviewer_id)
values (
  '20000000-0000-4000-8000-000000000100',
  '20000000-0000-4000-8000-000000000005'
);

insert into public.program_scopes (id, program_id, asset_type, asset_name)
values (
  '20000000-0000-4000-8000-000000000200',
  '20000000-0000-4000-8000-000000000100',
  'api',
  'Public API'
);

insert into public.program_impacts (
  id, program_id, asset_type, severity, title, source
)
values (
  '20000000-0000-4000-8000-000000000250',
  '20000000-0000-4000-8000-000000000100',
  'api',
  'high',
  'Broken access control',
  'custom'
);

insert into public.program_reward_tiers (
  program_id, asset_type, severity, calculation_type, min_reward, max_reward
)
values (
  '20000000-0000-4000-8000-000000000100',
  'api',
  'high',
  'range',
  100,
  500
);

insert into public.reports (
  id, program_id, researcher_id, affected_scope_id, title, description,
  reproduction_steps, proposed_severity, status, content_hash,
  submitted_at
)
values
  (
    '20000000-0000-4000-8000-000000000300',
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000200',
    'Researcher one report',
    'Private description',
    'Private steps',
    'high',
    'submitted',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    now()
  ),
  (
    '20000000-0000-4000-8000-000000000301',
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000200',
    'Researcher two report',
    'Other private description',
    'Other private steps',
    'high',
    'submitted',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    now()
  );

insert into public.report_impacts (
  report_id, program_id, program_impact_id, source,
  impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
)
values
  (
    '20000000-0000-4000-8000-000000000300',
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000250',
    'program',
    'Broken access control',
    'high',
    'api'
  ),
  (
    '20000000-0000-4000-8000-000000000301',
    '20000000-0000-4000-8000-000000000100',
    '20000000-0000-4000-8000-000000000250',
    'program',
    'Broken access control',
    'high',
    'api'
  );

do $bucket_safety$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'report-attachments'
      and not public
      and file_size_limit = 10485760
  ) then
    raise exception 'Private attachment bucket configuration is invalid';
  end if;

  if public.storage_report_id('../escape') is not null then
    raise exception 'Storage traversal path was accepted';
  end if;
end;
$bucket_safety$;

set local role anon;

do $anonymous_matrix$
begin
  -- Active plus ended (closed) are public; draft and paused are not.
  if (select count(*) from public.programs) <> 2 then
    raise exception 'Anonymous program visibility is invalid';
  end if;

  if not exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000103'
  ) then
    raise exception 'Anonymous cannot read an ended program';
  end if;

  if exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000104'
  ) then
    raise exception 'Anonymous can read a paused program';
  end if;

  begin
    perform 1 from public.report_impacts;
    raise exception 'Anonymous report impacts are readable';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.reports;
    raise exception 'Anonymous report content is readable';
  exception
    when insufficient_privilege then null;
  end;
end;
$anonymous_matrix$;

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000003', true);
set local role authenticated;

do $researcher_matrix$
begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'Researcher can read another profile';
  end if;

  if (select count(*) from public.reports) <> 1 then
    raise exception 'Researcher report isolation is invalid';
  end if;

  -- Selected impacts are report content: only the rows of the researcher's own report may be
  -- visible, even though both fixture reports claim the same catalog impact.
  if (select count(*) from public.report_impacts) <> 1 then
    raise exception 'Researcher report-impact isolation is invalid';
  end if;

  if exists (
    select 1 from public.report_impacts
    where report_id = '20000000-0000-4000-8000-000000000301'
  ) then
    raise exception 'Researcher can read impact rows of another researcher''s report';
  end if;

  begin
    update public.profiles set role = 'reviewer'
    where id = '20000000-0000-4000-8000-000000000003';
    raise exception 'Researcher self-assigned reviewer';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.profiles set onboarding_completed_at = null
    where id = '20000000-0000-4000-8000-000000000003';
    raise exception 'Researcher reset their own onboarding status';
  exception
    when insufficient_privilege then null;
  end;

  -- ACC-01 revoked the remaining direct UPDATE grants on profiles: account settings go through
  -- update_profile_display_name_atomic only, which is what btrims the name, enforces 1..120 and
  -- writes the audit row. The payout wallet belongs to the reward flow, not to a raw column write.
  begin
    update public.profiles set display_name = repeat('x', 500)
    where id = '20000000-0000-4000-8000-000000000003';
    raise exception 'Display name was writable through a direct grant';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.profiles set wallet_address = '0x' || repeat('a', 40)
    where id = '20000000-0000-4000-8000-000000000003';
    raise exception 'Payout wallet was writable through a direct grant';
  exception
    when insufficient_privilege then null;
  end;

  begin
    update public.profiles set avatar_url = 'javascript:alert(1)'
    where id = '20000000-0000-4000-8000-000000000003';
    raise exception 'Avatar URL was writable through a direct grant';
  exception
    when insufficient_privilege then null;
  end;

  -- SR-04b revoked the direct UPDATE grant: report edits go through update_report_atomic only,
  -- so even the researcher's own report must now fail with insufficient_privilege rather than
  -- being filtered to zero rows by the policy.
  begin
    update public.reports set title = 'Forbidden edit'
    where id = '20000000-0000-4000-8000-000000000300';
    raise exception 'Submitted report was editable through a direct grant';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.reports (
      program_id, researcher_id, affected_scope_id, title, description,
      proposed_severity, status, content_hash, submitted_at
    )
    values (
      '20000000-0000-4000-8000-000000000100',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000200',
      'Forged direct report',
      'Bypasses submit_report_atomic',
      'high',
      'submitted',
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      now()
    );
    raise exception 'A report was insertable without submit_report_atomic';
  exception
    when insufficient_privilege then null;
  end;
end;
$researcher_matrix$;

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $owner_matrix$
begin
  if not exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'Owner cannot read own draft';
  end if;

  if exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'Owner can read another owner draft';
  end if;

  if (select count(*) from public.reports) <> 2 then
    raise exception 'Program owner cannot read program reports';
  end if;

  if (select count(*) from public.report_impacts) <> 2 then
    raise exception 'Program owner cannot read the impact rows of program reports';
  end if;
end;
$owner_matrix$;

reset role;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000005', true);
set local role authenticated;

do $reviewer_matrix$
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'Assigned reviewer cannot access program reports';
  end if;

  if exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000102'
  ) then
    raise exception 'Reviewer can read an unassigned private program';
  end if;
end;
$reviewer_matrix$;

reset role;
set local role service_role;

do $service_role_matrix$
begin
  if (select count(*) from public.reports) <> 2 then
    raise exception 'Service role simulation does not bypass RLS';
  end if;
end;
$service_role_matrix$;

reset role;
rollback;
