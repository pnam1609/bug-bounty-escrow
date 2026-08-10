-- Qualify the result-row predicate in manual AI recovery.  The original function's run_id
-- variable conflicted with ai_triage_results.run_id when retrying a failed run, causing a 500
-- before the durable queue row could be reset.

create or replace function public.retry_report_ai_run_atomic(
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
  revision_record public.report_revisions;
  run_record public.ai_triage_runs;
  run_id uuid;
  has_usable_result boolean;
begin
  select * into report_record
  from public.reports
  where id = target_report_id and program_id = target_program_id
  for update;

  if not found then
    perform public.reject_business('ai_manual_review_report_not_found');
  end if;

  if report_record.status not in ('submitted', 'triaged', 'needs_information', 'validated') then
    perform public.reject_business('ai_manual_review_report_state');
  end if;

  if report_record.content_hash <> generated_content_hash then
    perform public.reject_business('ai_manual_review_stale_hash');
  end if;

  select * into revision_record
  from public.report_revisions
  where report_id = target_report_id
    and program_id = target_program_id
    and content_hash = generated_content_hash
  order by revision desc
  limit 1
  for update;

  if not found then
    perform public.reject_business('ai_manual_review_revision_missing');
  end if;

  select * into run_record
  from public.ai_triage_runs
  where report_id = target_report_id
    and program_id = target_program_id
    and revision_id = revision_record.id
  order by created_at desc, id desc
  limit 1
  for update;

  if found then
    if run_record.status in ('queued', 'running') then
      return run_record.id;
    end if;

    select exists (
      select 1
      from public.ai_triage_results result
      where result.run_id = run_record.id
        and result.result is not null
        and result.error_code is null
        and result.error_message is null
        and result.schema_version = 1
        and result.confidence is not null
        and jsonb_typeof(result.result) = 'object'
    ) into has_usable_result;

    if run_record.status = 'completed' and has_usable_result then
      return run_record.id;
    end if;

    delete from public.ai_triage_results as result
    where result.run_id = run_record.id;

    update public.ai_triage_runs
    set status = 'queued',
        attempt_count = 0,
        available_at = now(),
        next_attempt_at = null,
        locked_by = null,
        locked_at = null,
        started_at = null,
        finished_at = null,
        error_code = null,
        error_message = null,
        fingerprint = null,
        fingerprint_schema_version = null,
        candidate_retrieval_version = null,
        comparison_schema_version = null,
        generated_at = null,
        persisted_at = null
    where id = run_record.id;

    return run_record.id;
  end if;

  insert into public.ai_triage_runs (
    report_id, program_id, revision_id, submission_revision,
    program_submission_sequence, source_content_hash
  )
  values (
    target_report_id, target_program_id, revision_record.id, revision_record.revision,
    revision_record.program_submission_sequence, generated_content_hash
  )
  returning id into run_id;

  return run_id;
end;
$$;

revoke all on function public.retry_report_ai_run_atomic(uuid, uuid, text) from public;
grant execute on function public.retry_report_ai_run_atomic(uuid, uuid, text) to service_role;
