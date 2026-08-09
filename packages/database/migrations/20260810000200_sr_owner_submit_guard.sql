-- SR-01/SR-09: a program owner must never submit a report into their own program.
-- The API hides the CTA, but this guard remains authoritative for direct/RPC callers.

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
  select * into program_record
  from public.programs
  where id = target_program_id
  for update;

  if not found then
    perform public.reject_business('program_not_accepting_reports');
  end if;

  if program_record.owner_id = actor_id then
    perform public.reject_business('program_owner_cannot_submit_reports');
  end if;

  if not exists (
    select 1 from public.profiles
    where id = actor_id and role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  if program_record.status <> 'active' then
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

  selected_impact_count := coalesce(jsonb_array_length(input -> 'programImpactIds'), 0);
  custom_impact_count := coalesce(jsonb_array_length(input -> 'customImpacts'), 0);

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

  -- The rule is about rows actually written, not just array lengths. A whitespace-only custom
  -- title must not create a report with an empty impact set.
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

revoke all on function public.submit_report_atomic(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.submit_report_atomic(uuid, uuid, jsonb, text)
  to service_role;
