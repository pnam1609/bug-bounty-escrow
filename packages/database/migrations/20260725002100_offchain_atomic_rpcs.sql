-- Atomic RPCs for Program, Report, Comment, Attachment, and manual review workflows.
--
-- Every business rule below raises with a machine-readable `detail` code. apps/api maps that
-- code straight into the HTTP error body so a client can distinguish, for example, "program is
-- no longer accepting reports" from a transient failure. Raising without a detail code would
-- collapse into a generic 500.

-- Deliberately VOLATILE: an IMMUTABLE raiser can be constant-folded at plan time.
create or replace function public.reject_business(reason text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '22023', message = reason, detail = reason;
end;
$$;

create or replace function public.reject_forbidden(reason text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = reason, detail = reason;
end;
$$;

create or replace function public.reject_missing(reason text)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = 'P0002', message = reason, detail = reason;
end;
$$;

create or replace function public.actor_can_review_program(
  actor_id uuid,
  target_program_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  )
  or exists (
    select 1 from public.program_reviewers
    where program_id = target_program_id and reviewer_id = actor_id
  );
$$;

-- Platform baseline that every program snapshots at creation time.
create or replace function public.platform_prohibited_activities()
returns table (rule_key text, body text, sort_order integer)
language sql
immutable
set search_path = pg_catalog
as $$
  values
    ('no_social_engineering',
     'No social engineering, phishing or physical attacks against the team, users or vendors.', 0),
    ('no_denial_of_service',
     'No denial of service, resource exhaustion or availability testing of any kind.', 1),
    ('no_automated_high_volume',
     'No automated scanning or high-volume traffic against production systems.', 2),
    ('no_damaging_mainnet_testing',
     'No testing against mainnet or public deployments in a way that causes loss or damage to real users.', 3),
    ('no_public_unpatched_disclosure',
     'No public disclosure of an unpatched vulnerability before the program authorizes it.', 4);
$$;

-- Recomputes the denormalized columns the public bounty table sorts and filters on.
create or replace function public.refresh_program_projection(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.programs
  set
    max_bounty = coalesce((
      select max(greatest(
        coalesce(tier.max_reward, 0),
        coalesce(tier.flat_amount, 0),
        coalesce(tier.max_reward_cap, 0)
      ))
      from public.program_reward_tiers tier
      where tier.program_id = target_program_id
        and tier.archived_at is null
    ), 0),
    in_scope_asset_types = coalesce((
      select array_agg(distinct scope.asset_type order by scope.asset_type)
      from public.program_scopes scope
      where scope.program_id = target_program_id
        and scope.is_in_scope
        and scope.archived_at is null
    ), '{}'::text[]),
    reward_severities = coalesce((
      select array_agg(distinct tier.severity order by tier.severity)
      from public.program_reward_tiers tier
      where tier.program_id = target_program_id
        and tier.archived_at is null
    ), '{}'::text[])
  where id = target_program_id;
end;
$$;

-- Median seconds from initial submission to the first rejected, duplicate, or validated review
-- decision.
--
--   resolvedAt = first review that moved the report to rejected, duplicate or validated
--   metric     = median(resolvedAt - reports.submitted_at)
--
-- Three consequences the definition is chosen for:
--   * submitted_at is the FIRST submission, so time spent in needs_information and the wait for
--     the researcher to resubmit both count against the program. update_report_atomic must keep
--     coalescing rather than resetting it.
--   * reward_approval, payment_pending and paid are settlement, not review, so they never move
--     the metric. This measures how fast a program decides, not how fast it pays.
--   * Reports still under review have no resolvedAt and are excluded, not counted as zero.
--
-- Computed on read: it only appears on program detail, and denormalizing it would mean refreshing
-- the program row on every report transition.
create or replace function public.program_median_resolution_seconds(target_program_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select round(
    percentile_cont(0.5) within group (
      order by extract(epoch from resolved.resolved_at - resolved.submitted_at)
    )
  )::integer
  from (
    select
      report.submitted_at,
      min(review.created_at) as resolved_at
    from public.reports report
    join public.report_reviews review on review.report_id = report.id
    where report.program_id = target_program_id
      and report.submitted_at is not null
      and review.to_status in ('rejected', 'duplicate', 'validated')
    group by report.id, report.submitted_at
  ) as resolved;
$$;

-- Every asset type with a live in-scope asset needs at least one enabled impact and one tier.
create or replace function public.assert_program_coverage(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from (
      select distinct asset_type
      from public.program_scopes
      where program_id = target_program_id and is_in_scope and archived_at is null
    ) live
    where not exists (
      select 1 from public.program_impacts impact
      where impact.program_id = target_program_id
        and impact.asset_type = live.asset_type
        and impact.enabled
        and impact.archived_at is null
    )
  ) then
    perform public.reject_business('impact_coverage_missing');
  end if;

  if exists (
    select 1
    from (
      select distinct asset_type
      from public.program_scopes
      where program_id = target_program_id and is_in_scope and archived_at is null
    ) live
    where not exists (
      select 1 from public.program_reward_tiers tier
      where tier.program_id = target_program_id
        and tier.asset_type = live.asset_type
        and tier.archived_at is null
    )
  ) then
    perform public.reject_business('reward_tier_coverage_missing');
  end if;
end;
$$;

create or replace function public.complete_profile_onboarding_for_user(
  target_user_id uuid,
  selected_role text,
  selected_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_profile public.profiles;
begin
  if selected_role not in ('owner', 'researcher') then
    perform public.reject_forbidden('role_not_self_assignable');
  end if;

  select * into existing_profile
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    perform public.reject_missing('profile_not_found');
  end if;

  if existing_profile.onboarding_completed_at is not null then
    -- Re-sending the same choice is a legitimate retry, not a conflict.
    if existing_profile.role = selected_role
      and existing_profile.display_name = btrim(selected_display_name)
    then
      return target_user_id;
    end if;

    raise exception using
      errcode = '23505',
      message = 'onboarding_already_completed',
      detail = 'onboarding_already_completed';
  end if;

  update public.profiles
  set
    role = selected_role,
    display_name = btrim(selected_display_name),
    onboarding_completed_at = now()
  where id = target_user_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    target_user_id,
    'user',
    'profile.onboarding_completed',
    'profile',
    target_user_id::text,
    jsonb_build_object('role', selected_role)
  );

  return target_user_id;
end;
$$;

-- Replaces the full child-collection state of a program from `input`.
-- Scopes and impacts are upserted by id and soft-deleted when still referenced, because
-- reports.affected_scope_id and report_impacts.program_impact_id keep pointing at them.
create or replace function public.write_program_children(
  target_program_id uuid,
  input jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  kept_scope_ids uuid[];
  kept_impact_ids uuid[];
  row_input record;
begin
  ------------------------------------------------------------------ scopes
  if input ? 'scopes' then
    kept_scope_ids := coalesce((
      select array_agg((value ->> 'id')::uuid)
      from jsonb_array_elements(input -> 'scopes')
      where value ->> 'id' is not null
    ), '{}'::uuid[]);

    for row_input in
      select *
      from jsonb_to_recordset(input -> 'scopes') as scope_row(
        id uuid,
        "assetType" text,
        "assetName" text,
        "assetUrl" text,
        "contractAddress" text,
        "isInScope" boolean,
        description text,
        "sortOrder" integer
      )
    loop
      if row_input.id is null then
        insert into public.program_scopes (
          program_id, asset_type, asset_name, asset_url,
          contract_address, is_in_scope, description, sort_order
        )
        values (
          target_program_id,
          row_input."assetType",
          row_input."assetName",
          row_input."assetUrl",
          row_input."contractAddress",
          coalesce(row_input."isInScope", true),
          row_input.description,
          coalesce(row_input."sortOrder", 0)
        );
      else
        update public.program_scopes
        set
          asset_type = row_input."assetType",
          asset_name = row_input."assetName",
          asset_url = row_input."assetUrl",
          contract_address = row_input."contractAddress",
          is_in_scope = coalesce(row_input."isInScope", true),
          description = row_input.description,
          sort_order = coalesce(row_input."sortOrder", 0),
          archived_at = null
        where id = row_input.id and program_id = target_program_id;

        if not found then
          perform public.reject_business('program_not_accessible');
        end if;
      end if;
    end loop;

    -- Unreferenced removals can go; referenced ones must survive as archived history.
    delete from public.program_scopes scope
    where scope.program_id = target_program_id
      and scope.archived_at is null
      and not (scope.id = any (kept_scope_ids))
      and not exists (
        select 1 from public.reports report where report.affected_scope_id = scope.id
      );

    update public.program_scopes
    set archived_at = now(), is_in_scope = false
    where program_id = target_program_id
      and archived_at is null
      and not (id = any (kept_scope_ids));
  end if;

  ------------------------------------------------------------------ impacts
  if input ? 'impacts' then
    kept_impact_ids := coalesce((
      select array_agg((value ->> 'id')::uuid)
      from jsonb_array_elements(input -> 'impacts')
      where value ->> 'id' is not null
    ), '{}'::uuid[]);

    for row_input in
      select *
      from jsonb_to_recordset(input -> 'impacts') as impact_row(
        id uuid,
        "assetType" text,
        severity text,
        title text,
        description text,
        source text,
        "templateKey" text,
        enabled boolean,
        "sortOrder" integer
      )
    loop
      if row_input.id is null then
        insert into public.program_impacts (
          program_id, asset_type, severity, title, description,
          source, template_key, enabled, sort_order
        )
        values (
          target_program_id,
          row_input."assetType",
          row_input.severity,
          row_input.title,
          row_input.description,
          coalesce(row_input.source, 'custom'),
          row_input."templateKey",
          coalesce(row_input.enabled, true),
          coalesce(row_input."sortOrder", 0)
        );
      else
        update public.program_impacts
        set
          asset_type = row_input."assetType",
          severity = row_input.severity,
          title = row_input.title,
          description = row_input.description,
          enabled = coalesce(row_input.enabled, true),
          sort_order = coalesce(row_input."sortOrder", 0),
          archived_at = null
        where id = row_input.id and program_id = target_program_id;

        if not found then
          perform public.reject_business('program_not_accessible');
        end if;
      end if;
    end loop;

    delete from public.program_impacts impact
    where impact.program_id = target_program_id
      and impact.archived_at is null
      and not (impact.id = any (kept_impact_ids))
      and not exists (
        select 1 from public.report_impacts selected
        where selected.program_impact_id = impact.id
      );

    update public.program_impacts
    set archived_at = now(), enabled = false
    where program_id = target_program_id
      and archived_at is null
      and not (id = any (kept_impact_ids));
  end if;

  ------------------------------------------------------------------ reward tiers
  -- No foreign key points here (reports denormalize approved_reward), so a full replace is safe.
  if input ? 'rewardTiers' then
    for row_input in
      select *
      from jsonb_to_recordset(input -> 'rewardTiers') as tier_row(
        "assetType" text,
        severity text,
        "calculationType" text,
        "minReward" text,
        "maxReward" text,
        "flatAmount" text,
        "percentageBps" integer,
        "maxRewardCap" text,
        "calculationNote" text
      )
    loop
      insert into public.program_reward_tiers (
        program_id, asset_type, severity, calculation_type,
        min_reward, max_reward, flat_amount, percentage_bps, max_reward_cap, calculation_note
      )
      values (
        target_program_id,
        row_input."assetType",
        row_input.severity,
        coalesce(row_input."calculationType", 'range'),
        nullif(row_input."minReward", '')::numeric,
        nullif(row_input."maxReward", '')::numeric,
        nullif(row_input."flatAmount", '')::numeric,
        row_input."percentageBps",
        nullif(row_input."maxRewardCap", '')::numeric,
        row_input."calculationNote"
      )
      on conflict (program_id, asset_type, severity) where archived_at is null do update
      set
        calculation_type = excluded.calculation_type,
        min_reward = excluded.min_reward,
        max_reward = excluded.max_reward,
        flat_amount = excluded.flat_amount,
        percentage_bps = excluded.percentage_bps,
        max_reward_cap = excluded.max_reward_cap,
        calculation_note = excluded.calculation_note;
    end loop;

    -- A tier that already priced an approved reward is part of that payment record, so it is
    -- archived rather than deleted. Tiers with no history can go.
    delete from public.program_reward_tiers tier
    where tier.program_id = target_program_id
      and tier.archived_at is null
      and not exists (
        select 1
        from jsonb_to_recordset(input -> 'rewardTiers')
          as tier_row("assetType" text, severity text)
        where tier_row."assetType" = tier.asset_type
          and tier_row.severity = tier.severity
      )
      and not exists (
        select 1
        from public.reports report
        join public.program_scopes scope on scope.id = report.affected_scope_id
        where report.program_id = target_program_id
          and report.final_severity = tier.severity
          and scope.asset_type = tier.asset_type
          and report.status in ('reward_approved', 'payment_pending', 'paid')
      );

    update public.program_reward_tiers tier
    set archived_at = now()
    where tier.program_id = target_program_id
      and tier.archived_at is null
      and not exists (
        select 1
        from jsonb_to_recordset(input -> 'rewardTiers')
          as tier_row("assetType" text, severity text)
        where tier_row."assetType" = tier.asset_type
          and tier_row.severity = tier.severity
      );
  end if;

  ------------------------------------------------------------------ tags
  if input ? 'tags' then
    delete from public.program_tags where program_id = target_program_id;

    insert into public.program_tags (program_id, label)
    select target_program_id, element #>> '{}'
    from jsonb_array_elements(input -> 'tags') as arr(element)
    on conflict on constraint program_tags_program_normalized_key do nothing;
  end if;

  ------------------------------------------------------------------ resources
  if input ? 'resources' then
    delete from public.program_resources where program_id = target_program_id;

    insert into public.program_resources (program_id, resource_type, title, url, sort_order)
    select
      target_program_id,
      element ->> 'resourceType',
      element ->> 'title',
      element ->> 'url',
      coalesce((element ->> 'sortOrder')::integer, (position - 1)::integer)
    from jsonb_array_elements(input -> 'resources')
      with ordinality as arr(element, position);
  end if;

  ------------------------------------------------------------------ prohibited activities
  if input #> '{rules,prohibitedActivities}' is not null then
    delete from public.program_prohibited_activities
    where program_id = target_program_id and source = 'custom';

    insert into public.program_prohibited_activities (
      program_id, source, rule_key, body, sort_order
    )
    select
      target_program_id,
      'custom',
      null,
      element #>> '{}',
      (100 + position - 1)::integer
    from jsonb_array_elements(input #> '{rules,prohibitedActivities}')
      with ordinality as arr(element, position)
    where length(btrim(element #>> '{}')) > 0;
  end if;

  perform public.refresh_program_projection(target_program_id);
end;
$$;

create or replace function public.create_program_atomic(
  actor_id uuid,
  input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_program_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = actor_id and role = 'owner'
  ) then
    perform public.reject_forbidden('owner_role_required');
  end if;

  insert into public.programs (
    owner_id,
    name,
    slug,
    short_summary,
    description,
    website_url,
    logo_storage_path,
    deadline,
    poc_policy,
    poc_policy_note,
    reward_policy,
    testing_restrictions,
    submission_acknowledgment,
    allow_custom_impact
  )
  values (
    actor_id,
    input ->> 'name',
    input ->> 'slug',
    input ->> 'shortSummary',
    input ->> 'description',
    input ->> 'websiteUrl',
    input ->> 'logoStoragePath',
    nullif(input ->> 'deadline', '')::timestamp with time zone,
    coalesce(input #>> '{rules,pocPolicy}', 'required'),
    input #>> '{rules,pocPolicyNote}',
    input #>> '{rules,rewardPolicy}',
    input #>> '{rules,testingRestrictions}',
    input #>> '{rules,submissionAcknowledgment}',
    coalesce((input #>> '{rules,allowCustomImpact}')::boolean, true)
  )
  returning id into created_program_id;

  -- Snapshot the platform baseline so later platform edits never change a live program's terms.
  insert into public.program_prohibited_activities (
    program_id, source, rule_key, body, sort_order
  )
  select created_program_id, 'platform_default', defaults.rule_key, defaults.body,
    defaults.sort_order
  from public.platform_prohibited_activities() as defaults;

  perform public.write_program_children(created_program_id, input);
  perform public.assert_program_coverage(created_program_id);

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.created', 'program', created_program_id::text,
    jsonb_build_object('slug', input ->> 'slug')
  );

  return created_program_id;
end;
$$;

create or replace function public.update_program_atomic(
  actor_id uuid,
  target_program_id uuid,
  input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  existing_program public.programs;
begin
  select * into existing_program
  from public.programs
  where id = target_program_id
  for update;

  if not found or existing_program.owner_id <> actor_id then
    perform public.reject_forbidden('program_not_accessible');
  end if;

  if existing_program.updated_at <>
    (input ->> 'expectedUpdatedAt')::timestamp with time zone
  then
    raise exception using
      errcode = '40001',
      message = 'conflict',
      detail = 'conflict';
  end if;

  update public.programs
  set
    name = coalesce(input ->> 'name', name),
    short_summary = coalesce(input ->> 'shortSummary', short_summary),
    description = coalesce(input ->> 'description', description),
    website_url = case when input ? 'websiteUrl'
      then nullif(input ->> 'websiteUrl', '') else website_url end,
    logo_storage_path = case when input ? 'logoStoragePath'
      then nullif(input ->> 'logoStoragePath', '') else logo_storage_path end,
    deadline = case when input ? 'deadline'
      then nullif(input ->> 'deadline', '')::timestamp with time zone else deadline end,
    total_paid_visibility = coalesce(input ->> 'totalPaidVisibility', total_paid_visibility),
    poc_policy = coalesce(input #>> '{rules,pocPolicy}', poc_policy),
    poc_policy_note = case when input #> '{rules,pocPolicyNote}' is not null
      then nullif(input #>> '{rules,pocPolicyNote}', '') else poc_policy_note end,
    reward_policy = coalesce(input #>> '{rules,rewardPolicy}', reward_policy),
    testing_restrictions = case when input #> '{rules,testingRestrictions}' is not null
      then nullif(input #>> '{rules,testingRestrictions}', '') else testing_restrictions end,
    submission_acknowledgment = case when input #> '{rules,submissionAcknowledgment}' is not null
      then nullif(input #>> '{rules,submissionAcknowledgment}', '')
      else submission_acknowledgment end,
    allow_custom_impact = coalesce(
      (input #>> '{rules,allowCustomImpact}')::boolean, allow_custom_impact
    )
  where id = target_program_id;

  perform public.write_program_children(target_program_id, input);

  -- A live program must never drop below full coverage; a draft may still be incomplete.
  if existing_program.status <> 'draft' then
    perform public.assert_program_coverage(target_program_id);
  end if;

  return target_program_id;
end;
$$;

-- Writes the report row plus its selected impacts, validating both against the live program.
create or replace function public.submit_report_atomic(
  actor_id uuid,
  target_program_id uuid,
  input jsonb,
  generated_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_report_id uuid;
  program_record public.programs;
  scope_record public.program_scopes;
  selected_impact_count integer;
  custom_impact_count integer;
begin
  if not exists (
    select 1 from public.profiles
    where id = actor_id and role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  select * into program_record
  from public.programs
  where id = target_program_id;

  if not found or program_record.status <> 'active' then
    perform public.reject_business('program_not_accepting_reports');
  end if;

  select * into scope_record
  from public.program_scopes
  where id = (input ->> 'affectedScopeId')::uuid
    and program_id = target_program_id
    and is_in_scope
    and archived_at is null;

  if not found then
    perform public.reject_business('scope_not_eligible');
  end if;

  if program_record.poc_policy = 'required'
    and length(btrim(coalesce(input ->> 'reproductionSteps', ''))) = 0
  then
    perform public.reject_business('reproduction_steps_required');
  end if;

  selected_impact_count := coalesce(
    jsonb_array_length(input -> 'programImpactIds'), 0
  );
  custom_impact_count := coalesce(
    jsonb_array_length(input -> 'customImpacts'), 0
  );

  if selected_impact_count + custom_impact_count = 0 then
    perform public.reject_business('impact_selection_required');
  end if;

  if custom_impact_count > 0 and not program_record.allow_custom_impact then
    perform public.reject_business('custom_impact_not_allowed');
  end if;

  -- Every selected catalog impact must belong to this program, be live, and match the asset
  -- type of the affected scope. Checked here rather than trusted from the client.
  if selected_impact_count > 0 and exists (
    select 1
    from jsonb_array_elements_text(input -> 'programImpactIds') as requested(impact_id)
    where not exists (
      select 1 from public.program_impacts impact
      where impact.id = requested.impact_id::uuid
        and impact.program_id = target_program_id
        and impact.asset_type = scope_record.asset_type
        and impact.enabled
        and impact.archived_at is null
    )
  ) then
    perform public.reject_business('impact_not_eligible');
  end if;

  insert into public.reports (
    program_id,
    researcher_id,
    affected_scope_id,
    title,
    description,
    reproduction_steps,
    secret_gist_url,
    proposed_severity,
    severity_mismatch_acknowledged,
    status,
    content_hash,
    submitted_at
  )
  values (
    target_program_id,
    actor_id,
    scope_record.id,
    input ->> 'title',
    input ->> 'description',
    nullif(btrim(coalesce(input ->> 'reproductionSteps', '')), ''),
    nullif(btrim(coalesce(input ->> 'secretGistUrl', '')), ''),
    input ->> 'proposedSeverity',
    coalesce((input ->> 'severityMismatchAcknowledged')::boolean, false),
    'submitted',
    generated_content_hash,
    now()
  )
  returning id into created_report_id;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source,
    impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
  )
  select
    created_report_id,
    target_program_id,
    impact.id,
    'program',
    impact.title,
    impact.severity,
    impact.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
    as requested(impact_id)
  join public.program_impacts impact on impact.id = requested.impact_id::uuid;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source,
    custom_title, impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
  )
  select
    created_report_id,
    target_program_id,
    null,
    'custom',
    btrim(proposed.title),
    btrim(proposed.title),
    null,
    scope_record.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'customImpacts', '[]'::jsonb))
    as proposed(title)
  where length(btrim(proposed.title)) > 0;

  insert into public.notifications (recipient_id, type, metadata)
  values (
    program_record.owner_id,
    'report_submitted',
    jsonb_build_object('reportId', created_report_id, 'programId', target_program_id)
  );

  return created_report_id;
end;
$$;

-- Researcher edit of a report still in draft or needs_information, optionally resubmitting it.
create or replace function public.update_report_atomic(
  actor_id uuid,
  target_report_id uuid,
  input jsonb,
  generated_content_hash text,
  resubmit boolean
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  scope_record public.program_scopes;
  next_scope_id uuid;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found or report_record.researcher_id <> actor_id then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status not in ('draft', 'needs_information') then
    perform public.reject_business('invalid_report_transition');
  end if;

  select * into program_record from public.programs where id = report_record.program_id;

  if program_record.status <> 'active' then
    perform public.reject_business('program_not_accepting_reports');
  end if;

  next_scope_id := coalesce(
    nullif(input ->> 'affectedScopeId', '')::uuid, report_record.affected_scope_id
  );

  select * into scope_record
  from public.program_scopes
  where id = next_scope_id
    and program_id = report_record.program_id
    and is_in_scope
    and archived_at is null;

  if not found then
    perform public.reject_business('scope_not_eligible');
  end if;

  update public.reports
  set
    affected_scope_id = scope_record.id,
    title = coalesce(input ->> 'title', title),
    description = coalesce(input ->> 'description', description),
    reproduction_steps = case when input ? 'reproductionSteps'
      then nullif(btrim(coalesce(input ->> 'reproductionSteps', '')), '')
      else reproduction_steps end,
    secret_gist_url = case when input ? 'secretGistUrl'
      then nullif(btrim(coalesce(input ->> 'secretGistUrl', '')), '')
      else secret_gist_url end,
    proposed_severity = coalesce(input ->> 'proposedSeverity', proposed_severity),
    severity_mismatch_acknowledged = coalesce(
      (input ->> 'severityMismatchAcknowledged')::boolean, severity_mismatch_acknowledged
    ),
    content_hash = generated_content_hash,
    status = case when resubmit then 'submitted' else status end,
    -- coalesce, never now(): submitted_at is the FIRST submission and must survive a
    -- needs_information round trip. program_median_resolution_seconds measures from it, so
    -- resetting it here would silently hide the time a report spent waiting on the researcher.
    -- It also satisfies reports_submission_state_check, which requires the column on any
    -- non-draft status.
    submitted_at = case when resubmit then coalesce(submitted_at, now()) else submitted_at end
  where id = target_report_id;

  if program_record.poc_policy = 'required' and exists (
    select 1 from public.reports
    where id = target_report_id
      and length(btrim(coalesce(reproduction_steps, ''))) = 0
  ) then
    perform public.reject_business('reproduction_steps_required');
  end if;

  -- Impacts are replaced wholesale when supplied, mirroring submit-time validation.
  if input ? 'programImpactIds' or input ? 'customImpacts' then
    if coalesce(jsonb_array_length(input -> 'programImpactIds'), 0)
      + coalesce(jsonb_array_length(input -> 'customImpacts'), 0) = 0
    then
      perform public.reject_business('impact_selection_required');
    end if;

    if coalesce(jsonb_array_length(input -> 'customImpacts'), 0) > 0
      and not program_record.allow_custom_impact
    then
      perform public.reject_business('custom_impact_not_allowed');
    end if;

    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
        as requested(impact_id)
      where not exists (
        select 1 from public.program_impacts impact
        where impact.id = requested.impact_id::uuid
          and impact.program_id = report_record.program_id
          and impact.asset_type = scope_record.asset_type
          and impact.enabled
          and impact.archived_at is null
      )
    ) then
      perform public.reject_business('impact_not_eligible');
    end if;

    delete from public.report_impacts where report_id = target_report_id;

    insert into public.report_impacts (
      report_id, program_id, program_impact_id, source,
      impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
    )
    select
      target_report_id, report_record.program_id, impact.id, 'program',
      impact.title, impact.severity, impact.asset_type
    from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
      as requested(impact_id)
    join public.program_impacts impact on impact.id = requested.impact_id::uuid;

    insert into public.report_impacts (
      report_id, program_id, program_impact_id, source,
      custom_title, impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
    )
    select
      target_report_id, report_record.program_id, null, 'custom',
      btrim(proposed.title), btrim(proposed.title), null, scope_record.asset_type
    from jsonb_array_elements_text(coalesce(input -> 'customImpacts', '[]'::jsonb))
      as proposed(title)
    where length(btrim(proposed.title)) > 0;
  end if;

  if resubmit and report_record.status = 'needs_information' then
    insert into public.report_reviews (
      report_id, reviewer_id, action, from_status, to_status
    )
    values (
      target_report_id, actor_id, 'resubmit', report_record.status, 'submitted'
    );

    insert into public.notifications (recipient_id, type, metadata)
    values (
      program_record.owner_id,
      'report_resubmitted',
      jsonb_build_object('reportId', target_report_id, 'programId', report_record.program_id)
    );
  end if;

  return target_report_id;
end;
$$;

create or replace function public.add_report_comment_atomic(
  actor_id uuid,
  target_report_id uuid,
  comment_body text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_comment_id uuid;
  report_record public.reports;
begin
  select * into report_record
  from public.reports
  where id = target_report_id;

  if not found or not (
    report_record.researcher_id = actor_id
    or public.actor_can_review_program(actor_id, report_record.program_id)
  ) then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  insert into public.report_comments (report_id, author_id, body)
  values (target_report_id, actor_id, comment_body)
  returning id into created_comment_id;

  if report_record.researcher_id <> actor_id then
    insert into public.notifications (recipient_id, type, metadata)
    values (
      report_record.researcher_id,
      'comment_added',
      jsonb_build_object('reportId', target_report_id, 'commentId', created_comment_id)
    );
  end if;

  return created_comment_id;
end;
$$;

-- Creates (or reuses, on retry) a pending attachment row and returns its object path.
-- The row is not usable until complete_report_attachment_atomic confirms the upload landed.
create or replace function public.prepare_report_attachment_atomic(
  actor_id uuid,
  target_report_id uuid,
  attachment_id uuid,
  filename text,
  media_type text,
  attachment_size bigint,
  checksum text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  object_path text;
  existing_attachment public.report_attachments;
begin
  if not exists (
    select 1
    from public.reports
    where id = target_report_id
      and (
        researcher_id = actor_id
        or public.actor_can_review_program(actor_id, program_id)
      )
  ) then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  select * into existing_attachment
  from public.report_attachments
  where id = attachment_id
  for update;

  if found then
    -- Retry path (SR-09): reuse the same row instead of creating a duplicate attachment.
    if existing_attachment.report_id <> target_report_id
      or existing_attachment.uploader_id <> actor_id
    then
      perform public.reject_forbidden('attachment_not_accessible');
    end if;

    if existing_attachment.upload_status = 'uploaded' then
      perform public.reject_business('attachment_already_uploaded');
    end if;

    update public.report_attachments
    set upload_status = 'pending'
    where id = attachment_id;

    return existing_attachment.storage_path;
  end if;

  object_path :=
    'reports/' || target_report_id::text || '/' ||
    attachment_id::text || '/' || filename;

  insert into public.report_attachments (
    id,
    report_id,
    uploader_id,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    size_bytes,
    checksum_sha256,
    upload_status
  )
  values (
    attachment_id,
    target_report_id,
    actor_id,
    'report-attachments',
    object_path,
    filename,
    media_type,
    attachment_size,
    checksum,
    'pending'
  );

  return object_path;
end;
$$;

create or replace function public.complete_report_attachment_atomic(
  actor_id uuid,
  target_report_id uuid,
  attachment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.report_attachments
  set upload_status = 'uploaded', uploaded_at = now()
  where id = attachment_id
    and report_id = target_report_id
    and uploader_id = actor_id
    and upload_status <> 'uploaded';

  if not found then
    perform public.reject_forbidden('attachment_not_accessible');
  end if;

  return attachment_id;
end;
$$;

create or replace function public.request_report_information_atomic(
  actor_id uuid,
  target_report_id uuid,
  transition_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status not in ('submitted', 'triaged') then
    perform public.reject_business('invalid_report_transition');
  end if;

  update public.reports set status = 'needs_information'
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, reason
  )
  values (
    target_report_id, actor_id, 'request_information',
    report_record.status, 'needs_information', transition_reason
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'information_requested',
    jsonb_build_object('reportId', target_report_id)
  );

  return target_report_id;
end;
$$;

create or replace function public.validate_report_atomic(
  actor_id uuid,
  target_report_id uuid,
  selected_severity text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status not in ('submitted', 'triaged') then
    perform public.reject_business('invalid_report_transition');
  end if;

  update public.reports
  set status = 'validated', final_severity = selected_severity
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  )
  values (
    target_report_id, actor_id, 'validate',
    report_record.status, 'validated',
    jsonb_build_object('severity', selected_severity)
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'report_validated',
    jsonb_build_object('reportId', target_report_id)
  );

  return target_report_id;
end;
$$;

create or replace function public.reject_report_atomic(
  actor_id uuid,
  target_report_id uuid,
  transition_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status not in ('submitted', 'triaged') then
    perform public.reject_business('invalid_report_transition');
  end if;

  update public.reports set status = 'rejected'
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, reason
  )
  values (
    target_report_id, actor_id, 'reject',
    report_record.status, 'rejected', transition_reason
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'report_rejected',
    jsonb_build_object('reportId', target_report_id)
  );

  return target_report_id;
end;
$$;

create or replace function public.mark_report_duplicate_atomic(
  actor_id uuid,
  target_report_id uuid,
  original_report_id uuid,
  transition_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  original_record public.reports;
begin
  if target_report_id = original_report_id then
    perform public.reject_business('duplicate_target_invalid');
  end if;

  select * into report_record from public.reports
  where id = target_report_id for update;
  select * into original_record from public.reports
  where id = original_report_id;

  if report_record.id is null then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if not public.actor_can_review_program(actor_id, report_record.program_id) then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if original_record.id is null
    or report_record.program_id <> original_record.program_id
    or original_record.status = 'duplicate'
  then
    perform public.reject_business('duplicate_target_invalid');
  end if;

  if report_record.status not in ('submitted', 'triaged') then
    perform public.reject_business('invalid_report_transition');
  end if;

  update public.reports set status = 'duplicate'
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, reason, metadata
  )
  values (
    target_report_id, actor_id, 'mark_duplicate',
    report_record.status, 'duplicate',
    coalesce(nullif(btrim(transition_reason), ''), 'Marked as duplicate'),
    jsonb_build_object('originalReportId', original_report_id)
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'report_duplicate',
    jsonb_build_object(
      'reportId', target_report_id,
      'originalReportId', original_report_id
    )
  );

  return target_report_id;
end;
$$;

-- Approves a reward AND reserves it against the program pool in the same transaction.
-- Without the reservation, two reports could each be approved for the entire balance.
--
-- Range and flat tiers take the reviewer's `reward_amount` and bounds-check it. Percentage tiers
-- do not: the reviewer supplies the verified `calculation_basis_amount` and the server derives
-- the reward from the tier's basis points, clamps it to the cap, and snapshots every input into
-- the review record so the figure stays reproducible after the catalog changes.
create or replace function public.approve_report_reward_atomic(
  actor_id uuid,
  target_report_id uuid,
  reward_amount numeric,
  calculation_basis_amount numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  scope_asset_type text;
  tier_record public.program_reward_tiers;
  allowed_bounds numrange;
  settled_amount numeric;
  calculation_snapshot jsonb;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status <> 'validated' or report_record.final_severity is null then
    perform public.reject_business('invalid_report_transition');
  end if;

  -- Lock the program row before reading the pool so concurrent approvals serialize.
  select * into program_record from public.programs
  where id = report_record.program_id for update;

  select asset_type into scope_asset_type
  from public.program_scopes
  where id = report_record.affected_scope_id;

  -- Tiers are unique per (program, asset type, severity), so the affected scope's asset type
  -- is required to resolve which tier applies. An archived tier still prices the report it was
  -- approved under, but a new approval must use a live one.
  select * into tier_record
  from public.program_reward_tiers
  where program_id = report_record.program_id
    and asset_type = scope_asset_type
    and severity = report_record.final_severity
    and archived_at is null;

  if not found then
    perform public.reject_business('reward_tier_coverage_missing');
  end if;

  if tier_record.calculation_type = 'percentage' then
    if calculation_basis_amount is null or calculation_basis_amount <= 0 then
      perform public.reject_business('reward_basis_required');
    end if;

    settled_amount := round(
      least(
        calculation_basis_amount * tier_record.percentage_bps / 10000,
        tier_record.max_reward_cap
      ),
      6
    );

    if settled_amount <= 0 then
      perform public.reject_business('reward_out_of_bounds');
    end if;
  else
    if reward_amount is null then
      perform public.reject_business('reward_amount_required');
    end if;

    allowed_bounds := public.reward_tier_bounds(tier_record);

    if not (allowed_bounds @> reward_amount) then
      perform public.reject_business('reward_out_of_bounds');
    end if;

    settled_amount := reward_amount;
  end if;

  if settled_amount > program_record.available_pool then
    perform public.reject_business('insufficient_available_pool');
  end if;

  calculation_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'reward', settled_amount::text,
    'assetType', scope_asset_type,
    'severity', report_record.final_severity,
    'calculationType', tier_record.calculation_type,
    'calculationBasisAmount', calculation_basis_amount::text,
    'percentageBps', tier_record.percentage_bps,
    'maxRewardCap', tier_record.max_reward_cap::text,
    'minReward', tier_record.min_reward::text,
    'maxReward', tier_record.max_reward::text,
    'flatAmount', tier_record.flat_amount::text
  ));

  reward_amount := settled_amount;

  update public.programs
  set reserved_pool = reserved_pool + reward_amount
  where id = report_record.program_id;

  update public.reports
  set
    status = 'reward_approved',
    approved_reward = reward_amount,
    reward_approved_at = now()
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  )
  values (
    target_report_id, actor_id, 'approve_reward',
    'validated', 'reward_approved',
    calculation_snapshot
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'reward_approved',
    jsonb_build_object('reportId', target_report_id, 'amount', reward_amount::text)
  );

  return target_report_id;
end;
$$;

revoke all on function public.reject_business(text) from public;
revoke all on function public.reject_forbidden(text) from public;
revoke all on function public.reject_missing(text) from public;
revoke all on function public.platform_prohibited_activities() from public;
revoke all on function public.refresh_program_projection(uuid) from public;
revoke all on function public.assert_program_coverage(uuid) from public;
revoke all on function public.program_median_resolution_seconds(uuid) from public;
revoke all on function public.write_program_children(uuid, jsonb) from public;
revoke all on function public.actor_can_review_program(uuid, uuid) from public;
revoke all on function public.complete_profile_onboarding_for_user(uuid, text, text) from public;
revoke all on function public.create_program_atomic(uuid, jsonb) from public;
revoke all on function public.update_program_atomic(uuid, uuid, jsonb) from public;
revoke all on function public.submit_report_atomic(uuid, uuid, jsonb, text) from public;
revoke all on function public.update_report_atomic(uuid, uuid, jsonb, text, boolean) from public;
revoke all on function public.add_report_comment_atomic(uuid, uuid, text) from public;
revoke all on function public.prepare_report_attachment_atomic(
  uuid, uuid, uuid, text, text, bigint, text
) from public;
revoke all on function public.complete_report_attachment_atomic(uuid, uuid, uuid) from public;
revoke all on function public.request_report_information_atomic(uuid, uuid, text) from public;
revoke all on function public.validate_report_atomic(uuid, uuid, text) from public;
revoke all on function public.reject_report_atomic(uuid, uuid, text) from public;
revoke all on function public.mark_report_duplicate_atomic(uuid, uuid, uuid, text) from public;
revoke all on function public.approve_report_reward_atomic(
  uuid, uuid, numeric, numeric
) from public;

grant execute on function public.actor_can_review_program(uuid, uuid) to service_role;
grant execute on function public.program_median_resolution_seconds(uuid) to service_role;
grant execute on function public.complete_profile_onboarding_for_user(
  uuid, text, text
) to service_role;
grant execute on function public.create_program_atomic(uuid, jsonb) to service_role;
grant execute on function public.update_program_atomic(uuid, uuid, jsonb) to service_role;
grant execute on function public.submit_report_atomic(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.update_report_atomic(
  uuid, uuid, jsonb, text, boolean
) to service_role;
grant execute on function public.add_report_comment_atomic(uuid, uuid, text) to service_role;
grant execute on function public.prepare_report_attachment_atomic(
  uuid, uuid, uuid, text, text, bigint, text
) to service_role;
grant execute on function public.complete_report_attachment_atomic(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.request_report_information_atomic(
  uuid, uuid, text
) to service_role;
grant execute on function public.validate_report_atomic(uuid, uuid, text) to service_role;
grant execute on function public.reject_report_atomic(uuid, uuid, text) to service_role;
grant execute on function public.mark_report_duplicate_atomic(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.approve_report_reward_atomic(
  uuid, uuid, numeric, numeric
) to service_role;
