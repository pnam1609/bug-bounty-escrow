-- DATA-001: Rehome the temporary hosted demo identities to the private hackathon accounts.
--
-- This migration is intentionally a no-op on clean/local databases where the private accounts
-- do not exist. On the hosted database it preserves all business history, reassigns every profile
-- foreign key, normalizes the legacy duplicate review metadata, and only then removes the seven
-- deterministic demo identities. The personal email addresses are never persisted in source docs.

do $$
declare
  target_admin_id uuid;
  target_owner_id uuid;
  target_researcher_id uuid;
  target_count integer;
begin
  select count(*)::integer into target_count
  from auth.users
  where lower(email) in (
    'luciferandr@gmail.com',
    'shared.gpt.dev@gmail.com',
    'pnam16091999@gmail.com'
  );

  -- Local/test databases intentionally keep their synthetic identities and seed fixtures.
  if target_count = 0 then
    return;
  end if;

  if target_count <> 3 then
    raise exception 'personal account rehome requires all three target accounts';
  end if;

  select id into target_admin_id
  from auth.users
  where lower(email) = 'luciferandr@gmail.com';
  select id into target_owner_id
  from auth.users
  where lower(email) = 'shared.gpt.dev@gmail.com';
  select id into target_researcher_id
  from auth.users
  where lower(email) = 'pnam16091999@gmail.com';

  if target_admin_id is null or target_owner_id is null or target_researcher_id is null then
    raise exception 'personal account rehome could not resolve all target IDs';
  end if;

  if not exists (select 1 from public.profiles where id = target_admin_id)
     or not exists (select 1 from public.profiles where id = target_owner_id)
     or not exists (select 1 from public.profiles where id = target_researcher_id)
  then
    raise exception 'personal account rehome requires profiles for all target IDs';
  end if;

  -- The product role corresponding to the requested "Admin" account is the existing privileged
  -- reviewer role. Introducing a fourth role would require a separate authorization design.
  update public.profiles
  set role = 'reviewer', onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = target_admin_id;
  update public.profiles
  set role = 'owner', onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = target_owner_id;
  update public.profiles
  set role = 'researcher', onboarding_completed_at = coalesce(onboarding_completed_at, now())
  where id = target_researcher_id;

  -- Both demo reviewers were assigned to the same five programs. Keep one assignment per
  -- program before mapping both identities to the single private reviewer account.
  delete from public.program_reviewers duplicate_assignment
  where duplicate_assignment.reviewer_id = '30000000-0000-4000-8000-000000000007'::uuid
    and exists (
      select 1
      from public.program_reviewers retained_assignment
      where retained_assignment.program_id = duplicate_assignment.program_id
        and retained_assignment.reviewer_id = '30000000-0000-4000-8000-000000000003'::uuid
    );

  -- Legacy demo duplicate rows are retained as business history, but must point to the actual
  -- same-program original report before the strict read-model constraint is installed.
  update public.report_reviews review
  set metadata = jsonb_build_object('originalReportId', mapping.original_report_id::text)
  from (
    values
      ('35000000-0000-4000-8000-000000000007'::uuid, '33000000-0000-4000-8000-000000000014'::uuid),
      ('35000000-0000-4000-8000-000000000015'::uuid, '33000000-0000-4000-8000-000000000001'::uuid),
      ('35000000-0000-4000-8000-000000000023'::uuid, '33000000-0000-4000-8000-000000000002'::uuid),
      ('35000000-0000-4000-8000-000000000031'::uuid, '33000000-0000-4000-8000-000000000003'::uuid),
      ('35000000-0000-4000-8000-000000000039'::uuid, '33000000-0000-4000-8000-000000000004'::uuid),
      ('35000000-0000-4000-8000-000000000047'::uuid, '33000000-0000-4000-8000-000000000041'::uuid),
      ('35000000-0000-4000-8000-000000000055'::uuid, '33000000-0000-4000-8000-000000000041'::uuid)
  ) as mapping(review_id, original_report_id)
  where review.id = mapping.review_id
    and review.action = 'mark_duplicate'
    and review.metadata @> '{"demo": true}'::jsonb;

  -- Reassign every profile foreign key before deleting auth.users. The mapping preserves the
  -- historical role boundary: owners stay owner, researchers stay researcher, reviewers become
  -- the private reviewer/admin account.
  update public.programs
  set owner_id = target_owner_id
  where owner_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );

  update public.reports
  set researcher_id = target_researcher_id
  where researcher_id in (
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid
  );

  update public.program_reviewers
  set assigned_by = target_owner_id
  where assigned_by in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );
  update public.program_reviewers
  set reviewer_id = target_admin_id
  where reviewer_id in (
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );

  update public.report_attachments
  set uploader_id = case
    when uploader_id in (
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000005'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid
    ) then target_researcher_id
    when uploader_id in (
      '30000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid
    ) then target_owner_id
    else target_admin_id
  end
  where uploader_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );
  update public.report_comments
  set author_id = case
    when author_id in (
      '30000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid
    ) then target_owner_id
    when author_id in (
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000005'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid
    ) then target_researcher_id
    else target_admin_id
  end
  where author_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );
  update public.report_disclosures
  set decided_by = target_owner_id
  where decided_by in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );
  update public.report_reviews
  set reviewer_id = target_admin_id
  where reviewer_id in (
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );
  update public.notifications
  set recipient_id = case
    when recipient_id in (
      '30000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid
    ) then target_owner_id
    when recipient_id in (
      '30000000-0000-4000-8000-000000000003'::uuid,
      '30000000-0000-4000-8000-000000000007'::uuid
    ) then target_admin_id
    when recipient_id in (
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000005'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid
    ) then target_researcher_id
    else target_admin_id
  end
  where recipient_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );
  update public.audit_logs
  set actor_id = case
    when actor_id in (
      '30000000-0000-4000-8000-000000000001'::uuid,
      '30000000-0000-4000-8000-000000000004'::uuid
    ) then target_owner_id
    when actor_id in (
      '30000000-0000-4000-8000-000000000002'::uuid,
      '30000000-0000-4000-8000-000000000005'::uuid,
      '30000000-0000-4000-8000-000000000006'::uuid
    ) then target_researcher_id
    else target_admin_id
  end
  where actor_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );

  update public.escrow_wallet_control_challenges
  set actor_id = target_owner_id
  where actor_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );
  update public.funding_intents
  set created_by = target_owner_id
  where created_by in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );
  update public.reward_settlement_intents
  set actor_id = target_owner_id
  where actor_id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );
  update public.withdrawal_intents
  set created_by = target_owner_id
  where created_by in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid
  );

  delete from auth.users
  where id in (
    '30000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000002'::uuid,
    '30000000-0000-4000-8000-000000000003'::uuid,
    '30000000-0000-4000-8000-000000000004'::uuid,
    '30000000-0000-4000-8000-000000000005'::uuid,
    '30000000-0000-4000-8000-000000000006'::uuid,
    '30000000-0000-4000-8000-000000000007'::uuid
  );
end;
$$;
