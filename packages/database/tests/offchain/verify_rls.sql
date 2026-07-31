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

insert into public.report_reviews (
  id, report_id, reviewer_id, action, from_status, to_status, reason, metadata
)
values (
  '20000000-0000-4000-8000-000000000400',
  '20000000-0000-4000-8000-000000000300',
  '20000000-0000-4000-8000-000000000005',
  'request_information', 'submitted', 'needs_information',
  'Internal review note', '{}'::jsonb
);

insert into public.report_attachments (
  id, report_id, uploader_id, storage_bucket, storage_path, original_filename,
  mime_type, size_bytes, upload_status, uploaded_at
)
values
  (
    '20000000-0000-4000-8000-000000000410',
    '20000000-0000-4000-8000-000000000300',
    '20000000-0000-4000-8000-000000000003',
    'report-attachments',
    'reports/20000000-0000-4000-8000-000000000300/20000000-0000-4000-8000-000000000410/pending.txt',
    'pending.txt', 'text/plain', 10, 'pending', null
  ),
  (
    '20000000-0000-4000-8000-000000000411',
    '20000000-0000-4000-8000-000000000300',
    '20000000-0000-4000-8000-000000000003',
    'report-attachments',
    'reports/20000000-0000-4000-8000-000000000300/20000000-0000-4000-8000-000000000411/proof.txt',
    'proof.txt', 'text/plain', 10, 'uploaded', now()
  ),
  (
    '20000000-0000-4000-8000-000000000412',
    '20000000-0000-4000-8000-000000000300',
    '20000000-0000-4000-8000-000000000003',
    'report-attachments',
    'reports/20000000-0000-4000-8000-000000000300/20000000-0000-4000-8000-000000000412/missing.txt',
    'missing.txt', 'text/plain', 10, 'pending', null
  );

insert into storage.objects (bucket_id, name)
values
  (
    'report-attachments',
    'reports/20000000-0000-4000-8000-000000000300/20000000-0000-4000-8000-000000000410/pending.txt'
  ),
  (
    'report-attachments',
    'reports/20000000-0000-4000-8000-000000000300/20000000-0000-4000-8000-000000000411/proof.txt'
  );

do $attachment_completion_guard$
begin
  begin
    perform public.complete_report_attachment_atomic(
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000300',
      '20000000-0000-4000-8000-000000000412'
    );
    raise exception 'Attachment completion accepted a missing Storage object';
  exception
    when others then
      if sqlstate <> '22023' or sqlerrm <> 'attachment_object_missing' then
        raise;
      end if;
  end;

  if (
    select upload_status
    from public.report_attachments
    where id = '20000000-0000-4000-8000-000000000412'
  ) <> 'pending' then
    raise exception 'Missing-object completion changed attachment status';
  end if;
end;
$attachment_completion_guard$;

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

  if exists (select 1 from public.report_reviews) then
    raise exception 'Researcher can read internal review rows';
  end if;

  if (select count(*) from public.report_attachments) <> 1 then
    raise exception 'Researcher can read pending attachment rows';
  end if;

  if (select count(*) from storage.objects) <> 1 then
    raise exception 'Researcher can read pending attachment objects';
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

  if (select count(*) from public.report_reviews) <> 1 then
    raise exception 'Program owner cannot read internal review rows';
  end if;

  if (select count(*) from public.report_attachments) <> 1 then
    raise exception 'Program owner can read pending attachment rows';
  end if;

  if (select count(*) from storage.objects) <> 1 then
    raise exception 'Program owner can read pending attachment objects';
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

  if (select count(*) from public.report_reviews) <> 1 then
    raise exception 'Assigned reviewer cannot read internal review rows';
  end if;

  if (select count(*) from public.report_attachments) <> 1 then
    raise exception 'Assigned reviewer can read pending attachment rows';
  end if;

  if (select count(*) from storage.objects) <> 1 then
    raise exception 'Assigned reviewer can read pending attachment objects';
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

-- SEC-PROD-001: an Auth ban must close direct PostgREST/Storage access immediately, including
-- access with a still-unexpired JWT. The service-role API remains outside this role-scoped policy
-- and rejects the same identities in AuthenticationGuard before using service_role.
do $active_auth_policy_catalog$
declare
  helper_count integer;
  missing_policy_count integer;
  unguarded_helper_count integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
  ) then
    raise exception 'Storage objects is absent or does not enforce RLS';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'is_active_auth_user'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and coalesce(procedure.proconfig, '{}'::text[])
        @> array['search_path=""']::text[]
  ) then
    raise exception 'Active Auth helper is absent, not SECURITY DEFINER, or has an unsafe search_path';
  end if;

  if has_function_privilege('public', 'public.is_active_auth_user()', 'execute')
    or has_function_privilege('anon', 'public.is_active_auth_user()', 'execute')
    or not has_function_privilege('authenticated', 'public.is_active_auth_user()', 'execute')
  then
    raise exception 'Active Auth helper execute privileges are unsafe';
  end if;

  select count(*)
  into missing_policy_count
  from pg_catalog.pg_class as relation
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where relation.relkind in ('r', 'p')
    and relation.relrowsecurity
    and (
      namespace.nspname = 'public'
      or (namespace.nspname = 'storage' and relation.relname = 'objects')
    )
    and not exists (
      select 1
      from pg_catalog.pg_policy as policy
      where policy.polrelid = relation.oid
        and policy.polname = 'authenticated_user_must_be_active'
        and not policy.polpermissive
        and policy.polroles @> array['authenticated'::regrole::oid]::oid[]
        and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
          like '%SELECT is_active_auth_user()%'
        and pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
          like '%SELECT is_active_auth_user()%'
    );

  if missing_policy_count <> 0 then
    raise exception 'Active Auth restrictive policy is missing or malformed';
  end if;

  select
    count(*),
    count(*) filter (
      where not procedure.prosecdef
        or not coalesce(procedure.proconfig, '{}'::text[])
          @> array['search_path=""']::text[]
        or procedure.proowner::regrole::text in (
          'anon',
          'authenticated',
          'service_role',
          'authenticator'
        )
        or procedure.prosrc not like '%is_active_auth_user()%'
    )
  into helper_count, unguarded_helper_count
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname in (
      'is_program_owner',
      'is_program_reviewer',
      'is_program_readable',
      'can_access_report',
      'can_review_report'
    );

  if helper_count <> 5 or unguarded_helper_count <> 0 then
    raise exception 'An authenticated SECURITY DEFINER read helper has an unsafe definition or owner';
  end if;

  if has_function_privilege(
    'public',
    'public.complete_profile_onboarding(text,text)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'public.complete_profile_onboarding(text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.complete_profile_onboarding(text,text)',
    'execute'
  ) then
    raise exception 'Legacy authenticated onboarding SECURITY DEFINER RPC remains executable';
  end if;
end;
$active_auth_policy_catalog$;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;

do $null_auth_subject$
begin
  if public.is_active_auth_user() then
    raise exception 'A missing Auth subject was treated as active';
  end if;
end;
$null_auth_subject$;

reset role;
set local role anon;

do $anonymous_boundary$
begin
  begin
    perform public.is_active_auth_user();
    raise exception 'Anonymous caller executed the active Auth helper';
  exception
    when insufficient_privilege then null;
  end;

  if not exists (
    select 1 from public.programs
    where id = '20000000-0000-4000-8000-000000000100'
  ) then
    raise exception 'Authenticated-only restrictive policy changed anonymous public reads';
  end if;

  if not public.is_program_readable('20000000-0000-4000-8000-000000000100') then
    raise exception 'Anonymous public-program helper access changed';
  end if;

  if public.is_program_owner('20000000-0000-4000-8000-000000000100')
    or public.is_program_reviewer('20000000-0000-4000-8000-000000000100')
  then
    raise exception 'Anonymous caller was treated as a private program participant';
  end if;

  begin
    insert into public.programs (
      owner_id, name, slug, short_summary, description, website_url, status, total_pool
    )
    values (
      '20000000-0000-4000-8000-000000000001',
      'Anonymous mutation',
      'anonymous-mutation',
      'Forbidden',
      'Forbidden',
      'https://forbidden.example.test',
      'draft',
      0
    );
    raise exception 'Anonymous caller inserted into a public table';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (id, bucket_id, name, owner_id)
    values (
      '20000000-0000-4000-8000-000000000996',
      'program-logos',
      'programs/20000000-0000-4000-8000-000000000100/anonymous-write.png',
      '20000000-0000-4000-8000-000000000001'
    );
    raise exception 'Anonymous caller inserted a Storage object';
  exception
    when insufficient_privilege then null;
  end;
end;
$anonymous_boundary$;

reset role;
insert into storage.objects (id, bucket_id, name, owner_id)
values (
  '20000000-0000-4000-8000-000000000999',
  'program-logos',
  'programs/20000000-0000-4000-8000-000000000100/security-boundary.png',
  '20000000-0000-4000-8000-000000000001'
);

update auth.users
set banned_until = null
where id = '20000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $unbanned_auth_subject$
begin
  if not public.is_active_auth_user() then
    raise exception 'An unbanned Auth subject was treated as inactive';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = '20000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Active Auth policy blocked an unbanned user';
  end if;

  if not exists (
    select 1 from storage.objects
    where id = '20000000-0000-4000-8000-000000000999'
  ) then
    raise exception 'Storage policy fixture is not visible to its unbanned owner';
  end if;

  update storage.objects
  set name =
    'programs/20000000-0000-4000-8000-000000000100/security-boundary-updated.png'
  where id = '20000000-0000-4000-8000-000000000999';

  if not found or not exists (
    select 1
    from storage.objects
    where id = '20000000-0000-4000-8000-000000000999'
      and name =
        'programs/20000000-0000-4000-8000-000000000100/security-boundary-updated.png'
  ) then
    raise exception 'Unbanned owner could not update their canonical Storage object';
  end if;

  if not public.is_program_owner('20000000-0000-4000-8000-000000000100')
    or public.is_program_reviewer('20000000-0000-4000-8000-000000000100')
    or not public.is_program_readable('20000000-0000-4000-8000-000000000101')
    or not public.can_access_report('20000000-0000-4000-8000-000000000300')
    or not public.can_review_report('20000000-0000-4000-8000-000000000300')
  then
    raise exception 'Active owner helper behavior changed';
  end if;

  insert into storage.objects (id, bucket_id, name, owner_id)
  values (
    '20000000-0000-4000-8000-000000000998',
    'program-logos',
    'programs/20000000-0000-4000-8000-000000000100/unbanned-write.png',
    '20000000-0000-4000-8000-000000000001'
  );

  delete from storage.objects
  where id = '20000000-0000-4000-8000-000000000998';

  if not found then
    raise exception 'Unbanned owner could not delete their canonical Storage object';
  end if;
end;
$unbanned_auth_subject$;

reset role;
update auth.users
set banned_until = now() + interval '100 years'
where id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;

do $banned_auth_subject$
declare
  affected_rows bigint;
begin
  if public.is_active_auth_user() then
    raise exception 'A banned Auth subject was treated as active';
  end if;

  if exists (select 1 from public.profiles)
    or exists (select 1 from public.programs)
    or exists (select 1 from public.reports)
    or exists (select 1 from storage.objects)
  then
    raise exception 'A banned Auth subject retained direct table or Storage visibility';
  end if;

  if public.is_program_owner('20000000-0000-4000-8000-000000000100')
    or public.is_program_reviewer('20000000-0000-4000-8000-000000000100')
    or public.is_program_readable('20000000-0000-4000-8000-000000000101')
    or public.can_access_report('20000000-0000-4000-8000-000000000300')
    or public.can_review_report('20000000-0000-4000-8000-000000000300')
  then
    raise exception 'A banned Auth subject retained a private SECURITY DEFINER helper oracle';
  end if;

  -- Public information remains public: a caller can always omit its JWT and use the anon role.
  -- The private owner/reviewer branches above are the data that the ban must close.
  if not public.is_program_readable('20000000-0000-4000-8000-000000000100') then
    raise exception 'Active-user protection changed the public-readable helper contract';
  end if;

  update public.programs
  set short_summary = 'Forbidden banned-user update'
  where id = '20000000-0000-4000-8000-000000000101';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'A banned Auth subject updated a public table';
  end if;

  delete from public.program_scopes
  where id = '20000000-0000-4000-8000-000000000200';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'A banned Auth subject deleted from a public table';
  end if;

  begin
    insert into public.program_scopes (id, program_id, asset_type, asset_name)
    values (
      '20000000-0000-4000-8000-000000000999',
      '20000000-0000-4000-8000-000000000100',
      'api',
      'Forbidden banned-user scope'
    );
    raise exception 'A banned Auth subject inserted into a public table';
  exception
    when insufficient_privilege then null;
  end;

  delete from storage.objects
  where id = '20000000-0000-4000-8000-000000000999';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'A banned Auth subject deleted a Storage object';
  end if;

  update storage.objects
  set name =
    'programs/20000000-0000-4000-8000-000000000100/banned-update.png'
  where id = '20000000-0000-4000-8000-000000000999';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'A banned Auth subject updated a Storage object';
  end if;

  begin
    insert into storage.objects (id, bucket_id, name, owner_id)
    values (
      '20000000-0000-4000-8000-000000000997',
      'program-logos',
      'programs/20000000-0000-4000-8000-000000000100/banned-write.png',
      '20000000-0000-4000-8000-000000000001'
    );
    raise exception 'A banned Auth subject inserted a Storage object';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.complete_profile_onboarding('researcher', 'Banned user');
    raise exception 'A banned Auth subject retained the legacy onboarding mutation RPC';
  exception
    when insufficient_privilege then null;
  end;
end;
$banned_auth_subject$;

reset role;

set local role service_role;

do $service_role_ban_boundary$
begin
  if not exists (
    select 1 from public.profiles
    where id = '20000000-0000-4000-8000-000000000001'
  ) or not exists (
    select 1 from storage.objects
    where id = '20000000-0000-4000-8000-000000000999'
  ) then
    raise exception 'Authenticated-only ban policies changed service-role access';
  end if;
end;
$service_role_ban_boundary$;

reset role;
update auth.users
set banned_until = now() - interval '1 second'
where id = '20000000-0000-4000-8000-000000000001';

set local role authenticated;

do $expired_auth_ban$
begin
  if not public.is_active_auth_user() then
    raise exception 'An expired Auth ban was treated as current';
  end if;
end;
$expired_auth_ban$;

reset role;
rollback;
