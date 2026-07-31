-- RR-08 / AC-14/16: make the durable AI enqueue replay-safe and retain supersession evidence.
--
-- Submit/resubmit RPCs call this helper while the report row is locked.  The queue row remains
-- the per-program serialization point.  A replay of the same current report hash returns the
-- existing run instead of allocating another revision/sequence.  A genuinely newer revision
-- marks persisted results for the same report as superseded before creating its run.

create or replace function public.enqueue_report_ai_run_atomic(
  target_report_id uuid,
  target_program_id uuid,
  generated_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  queue_record public.ai_program_queues;
  existing_run_id uuid;
  next_revision integer;
  next_sequence bigint;
  revision_id uuid;
  run_id uuid;
  snapshot jsonb;
begin
  select * into report_record
  from public.reports
  where id = target_report_id and program_id = target_program_id
  for update;

  if not found or report_record.status <> 'submitted' then
    perform public.reject_business('ai_submission_snapshot_invalid');
  end if;

  insert into public.ai_program_queues (program_id)
  values (target_program_id)
  on conflict (program_id) do nothing;

  select * into queue_record
  from public.ai_program_queues
  where program_id = target_program_id
  for update;

  -- A transport retry can reach the RPC after the first transaction committed.  The report hash
  -- is the API's idempotency anchor; requiring it to match the mutable report projection prevents
  -- an old revision from being mistaken for a new submission after an edit.
  select run.id into existing_run_id
  from public.report_revisions revision
  join public.ai_triage_runs run on run.revision_id = revision.id
  where revision.report_id = target_report_id
    and revision.content_hash = generated_content_hash
    and report_record.content_hash = generated_content_hash
    and revision.revision = (
      select max(current_revision.revision)
      from public.report_revisions current_revision
      where current_revision.report_id = target_report_id
    )
  order by run.created_at desc, run.id desc
  limit 1;

  if existing_run_id is not null then
    return existing_run_id;
  end if;

  next_revision := coalesce((
    select max(revision) + 1
    from public.report_revisions
    where report_id = target_report_id
  ), 1);
  next_sequence := queue_record.last_submission_sequence + 1;

  snapshot := jsonb_build_object(
    'affectedScopeId', report_record.affected_scope_id::text,
    'title', report_record.title,
    'description', report_record.description,
    'reproductionSteps', report_record.reproduction_steps,
    'secretGistUrl', report_record.secret_gist_url,
    'proposedSeverity', report_record.proposed_severity,
    'severityMismatchAcknowledged', report_record.severity_mismatch_acknowledged,
    'programImpactIds', coalesce((
      select jsonb_agg(impact.program_impact_id::text order by impact.id)
      from public.report_impacts impact
      where impact.report_id = target_report_id and impact.program_impact_id is not null
    ), '[]'::jsonb),
    'customImpacts', coalesce((
      select jsonb_agg(impact.custom_title order by impact.id)
      from public.report_impacts impact
      where impact.report_id = target_report_id and impact.source = 'custom'
    ), '[]'::jsonb)
  );

  update public.ai_triage_results prior_result
  set superseded_at = now()
  where prior_result.report_id = target_report_id
    and prior_result.result is not null
    and prior_result.source_submission_revision is not null
    and prior_result.source_submission_revision < next_revision
    and prior_result.superseded_at is null
    and prior_result.run_id is not null;

  update public.ai_program_queues
  set last_submission_sequence = next_sequence
  where program_id = target_program_id;

  insert into public.report_revisions (
    report_id, program_id, revision, program_submission_sequence,
    content_hash, snapshot
  )
  values (
    target_report_id, target_program_id, next_revision, next_sequence,
    generated_content_hash, snapshot
  )
  returning id into revision_id;

  insert into public.ai_triage_runs (
    report_id, program_id, revision_id, submission_revision,
    program_submission_sequence, source_content_hash
  )
  values (
    target_report_id, target_program_id, revision_id, next_revision,
    next_sequence, generated_content_hash
  )
  returning id into run_id;

  return run_id;
end;
$$;

revoke all on function public.enqueue_report_ai_run_atomic(uuid, uuid, text) from public;
grant execute on function public.enqueue_report_ai_run_atomic(uuid, uuid, text) to service_role;
