-- AI-REVIEW-05 / AC-17: candidate retrieval remains same-program and prior-only while
-- unioning independent semantic signals.  This replaces the previous text/fingerprint-only
-- ranking with explicit vulnerability-class, trigram, and identifier evidence.

create or replace function public.list_ai_duplicate_candidates(
  target_run_id uuid,
  max_candidates integer default 10
)
returns table (
  report_id uuid,
  program_id uuid,
  submission_revision integer,
  program_submission_sequence bigint,
  content_hash text,
  snapshot jsonb,
  fingerprint jsonb,
  match_score integer,
  match_signals jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bounded_limit integer;
begin
  bounded_limit := least(greatest(coalesce(max_candidates, 10), 1), 20);

  return query
  with current_run as (
    select run.program_id, run.report_id, run.program_submission_sequence,
      revision.snapshot as current_snapshot,
      run.fingerprint as current_fingerprint,
      run.source_content_hash as current_hash
    from public.ai_triage_runs run
    join public.report_revisions revision on revision.id = run.revision_id
    where run.id = target_run_id
  ), prior_base as (
    select revision.report_id, revision.program_id, revision.revision,
      revision.program_submission_sequence, revision.content_hash, revision.snapshot,
      prior_run.fingerprint,
      current_run.current_snapshot,
      current_run.current_fingerprint,
      current_run.current_hash,
      current_run.program_id as target_program_id,
      lower(coalesce(current_run.current_snapshot ->> 'title', '') || ' ' ||
        coalesce(current_run.current_snapshot ->> 'description', '') || ' ' ||
        coalesce(current_run.current_snapshot ->> 'reproductionSteps', '')) as current_text,
      lower(coalesce(revision.snapshot ->> 'title', '') || ' ' ||
        coalesce(revision.snapshot ->> 'description', '') || ' ' ||
        coalesce(revision.snapshot ->> 'reproductionSteps', '')) as prior_text
    from current_run
    join public.report_revisions revision
      on revision.program_id = current_run.program_id
      and revision.program_submission_sequence < current_run.program_submission_sequence
      and revision.report_id <> current_run.report_id
    left join public.ai_triage_runs prior_run on prior_run.revision_id = revision.id
  ), signals as (
    select prior_base.*,
      (prior_base.content_hash = prior_base.current_hash) as exact_hash,
      (prior_base.snapshot ->> 'affectedScopeId' = prior_base.current_snapshot ->> 'affectedScopeId') as scope_match,
      (to_tsvector('simple', prior_base.prior_text) @@ plainto_tsquery('simple', prior_base.current_text)) as text_match,
      (exists (
        select 1
        from jsonb_array_elements_text(coalesce(prior_base.current_fingerprint -> 'vulnerabilityClasses', '[]'::jsonb)) current_class
        join jsonb_array_elements_text(coalesce(prior_base.fingerprint -> 'vulnerabilityClasses', '[]'::jsonb)) prior_class
          on lower(current_class.value) = lower(prior_class.value)
      )) as vulnerability_class_match,
      (exists (
        select 1
        from jsonb_array_elements_text(coalesce(prior_base.current_fingerprint -> 'functions', '[]'::jsonb)) current_function
        join jsonb_array_elements_text(coalesce(prior_base.fingerprint -> 'functions', '[]'::jsonb)) prior_function
          on lower(current_function.value) = lower(prior_function.value)
      ) or exists (
        select 1
        from jsonb_array_elements_text(coalesce(prior_base.current_fingerprint -> 'affectedComponents', '[]'::jsonb)) current_component
        join jsonb_array_elements_text(coalesce(prior_base.fingerprint -> 'affectedComponents', '[]'::jsonb)) prior_component
          on lower(current_component.value) = lower(prior_component.value)
      )) as identifier_match,
      (select count(*) > 0
        from (
          select distinct substring(prior_base.current_text from current_pos for 3) as trigram
          from generate_series(1, greatest(length(prior_base.current_text) - 2, 0)) current_pos
          where length(substring(prior_base.current_text from current_pos for 3)) = 3
        ) current_trigrams
        join (
          select distinct substring(prior_base.prior_text from prior_pos for 3) as trigram
          from generate_series(1, greatest(length(prior_base.prior_text) - 2, 0)) prior_pos
          where length(substring(prior_base.prior_text from prior_pos for 3)) = 3
        ) prior_trigrams using (trigram)
      ) as trigram_match
    from prior_base
  ), scored as (
    select signals.*,
      (case when signals.exact_hash then 100 else 0 end
        + case when signals.scope_match then 5 else 0 end
        + case when signals.text_match then 20 else 0 end
        + case when signals.vulnerability_class_match then 25 else 0 end
        + case when signals.identifier_match then 30 else 0 end
        + case when signals.trigram_match then 10 else 0 end) as score
    from signals
  )
  select scored.report_id, scored.program_id, scored.revision,
    scored.program_submission_sequence, scored.content_hash, scored.snapshot,
    scored.fingerprint, scored.score,
    jsonb_build_object(
      'exactHash', scored.exact_hash,
      'scopeMatch', scored.scope_match,
      'textMatch', scored.text_match,
      'vulnerabilityClassMatch', scored.vulnerability_class_match,
      'identifierMatch', scored.identifier_match,
      'trigramMatch', scored.trigram_match
    )
  from scored
  where scored.program_id = scored.target_program_id
    and scored.score > 0
  order by scored.score desc, scored.program_submission_sequence, scored.report_id
  limit bounded_limit;
end;
$$;

revoke all on function public.list_ai_duplicate_candidates(uuid, integer) from public;
grant execute on function public.list_ai_duplicate_candidates(uuid, integer) to service_role;
