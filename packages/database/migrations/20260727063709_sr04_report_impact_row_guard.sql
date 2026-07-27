-- SR-04: the at-least-one-impact rule must hold for the rows actually written.
--
-- submit_report_atomic and update_report_atomic validated the impact selection against the
-- LENGTHS of the input arrays, but the custom-impact insert filters out titles that are blank
-- after btrim. A payload whose only impact was a whitespace custom title therefore passed the
-- `impact_selection_required` check and still produced a submitted report with ZERO
-- report_impacts rows — exactly the state db_005b's table comment promises these RPCs prevent
-- ("At least one row per submitted report; enforced by submit_report_atomic"). The API's Zod
-- layer cannot send such a payload today, but the RPC is the authority on the rule
-- (PROJECT_CONTEXT §9: business rules live in the database), so it must not rely on the caller.
--
-- Both functions now re-check AFTER the inserts and raise the existing machine-readable code:
--   impact_selection_required   no impact row was written for the report
--
-- No other behavior changes; the bodies are otherwise identical to
-- 20260725002100_offchain_atomic_rpcs.sql. CREATE OR REPLACE keeps the ownership and the
-- existing service_role grants of the replaced functions, so no grants are repeated here.
--
-- Rollback: re-apply the two function bodies from 20260725002100_offchain_atomic_rpcs.sql, then
--   delete from public.schema_migrations
--     where version = '20260727063709_sr04_report_impact_row_guard.sql';

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

  -- SR-04: the rule is about written rows, not input-array lengths. A custom impact that is
  -- blank after btrim passes the count check above but writes nothing.
  if not exists (
    select 1 from public.report_impacts where report_id = created_report_id
  ) then
    perform public.reject_business('impact_selection_required');
  end if;

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

    -- SR-04: replacing the selection must never leave the report without an impact row. The
    -- raise aborts the transaction, so the deleted rows above are restored with it.
    if not exists (
      select 1 from public.report_impacts where report_id = target_report_id
    ) then
      perform public.reject_business('impact_selection_required');
    end if;
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
