-- AI-007/008/011: immutable submission snapshots and a durable per-program AI outbox.
--
-- The existing report row remains the current mutable projection.  A revision is the immutable
-- input that a worker is allowed to read, while ai_triage_runs is the durable queue/outbox.  The
-- migration is additive: old seeded/manual reports and old DB-009 result rows remain valid and
-- are intentionally not re-enqueued.

create table public.report_revisions (
  id uuid default gen_random_uuid()
    constraint report_revisions_pkey primary key,
  report_id uuid not null,
  program_id uuid not null,
  revision integer not null
    constraint report_revisions_revision_check check (revision > 0),
  program_submission_sequence bigint not null
    constraint report_revisions_sequence_check check (program_submission_sequence > 0),
  content_hash text not null
    constraint report_revisions_content_hash_check check (content_hash ~ '^0x[0-9a-fA-F]{64}$'),
  snapshot jsonb not null
    constraint report_revisions_snapshot_object_check check (jsonb_typeof(snapshot) = 'object')
    constraint report_revisions_snapshot_size_check check (length(snapshot::text) <= 200000),
  created_at timestamp with time zone not null default now(),
  constraint report_revisions_report_program_fkey
    foreign key (report_id, program_id)
    references public.reports (id, program_id)
    on delete restrict,
  constraint report_revisions_report_revision_key unique (report_id, revision),
  constraint report_revisions_program_sequence_key unique (program_id, program_submission_sequence)
);

comment on table public.report_revisions is
  'Immutable private snapshot of each successful report submission/resubmission. Legacy reports may have no snapshot.';

create table public.ai_program_queues (
  program_id uuid
    constraint ai_program_queues_pkey primary key
    constraint ai_program_queues_program_id_fkey references public.programs (id) on delete restrict,
  last_submission_sequence bigint not null default 0
    constraint ai_program_queues_sequence_check check (last_submission_sequence >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create trigger ai_program_queues_set_updated_at
before update on public.ai_program_queues
for each row
execute function public.set_updated_at();

create table public.ai_triage_runs (
  id uuid default gen_random_uuid()
    constraint ai_triage_runs_pkey primary key,
  report_id uuid not null,
  program_id uuid not null,
  revision_id uuid not null
    constraint ai_triage_runs_revision_id_fkey references public.report_revisions (id) on delete restrict,
  submission_revision integer not null
    constraint ai_triage_runs_revision_check check (submission_revision > 0),
  program_submission_sequence bigint not null
    constraint ai_triage_runs_sequence_check check (program_submission_sequence > 0),
  source_content_hash text not null
    constraint ai_triage_runs_content_hash_check check (source_content_hash ~ '^0x[0-9a-fA-F]{64}$'),
  provider text
    constraint ai_triage_runs_provider_check check (provider is null or provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  model text
    constraint ai_triage_runs_model_check check (model is null or length(btrim(model)) between 1 and 200),
  status text not null default 'queued'
    constraint ai_triage_runs_status_check check (status in ('queued', 'running', 'completed', 'failed')),
  attempt_count integer not null default 0
    constraint ai_triage_runs_attempt_count_check check (attempt_count >= 0),
  available_at timestamp with time zone not null default now(),
  next_attempt_at timestamp with time zone,
  locked_by text,
  locked_at timestamp with time zone,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_code text
    constraint ai_triage_runs_error_code_check check (
      error_code is null or error_code ~ '^[a-z][a-z0-9._-]{0,127}$'
    ),
  error_message text
    constraint ai_triage_runs_error_message_check check (
      error_message is null or length(error_message) between 1 and 500
    ),
  fingerprint jsonb
    constraint ai_triage_runs_fingerprint_object_check check (
      fingerprint is null or jsonb_typeof(fingerprint) = 'object'
    )
    constraint ai_triage_runs_fingerprint_size_check check (
      fingerprint is null or length(fingerprint::text) <= 100000
    ),
  fingerprint_schema_version integer
    constraint ai_triage_runs_fingerprint_schema_check check (
      fingerprint_schema_version is null or fingerprint_schema_version > 0
    ),
  candidate_retrieval_version integer
    constraint ai_triage_runs_candidate_schema_check check (
      candidate_retrieval_version is null or candidate_retrieval_version > 0
    ),
  comparison_schema_version integer
    constraint ai_triage_runs_comparison_schema_check check (
      comparison_schema_version is null or comparison_schema_version > 0
    ),
  generated_at timestamp with time zone,
  persisted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint ai_triage_runs_report_program_fkey
    foreign key (report_id, program_id)
    references public.reports (id, program_id)
    on delete restrict,
  constraint ai_triage_runs_source_revision_key unique (report_id, submission_revision, source_content_hash),
  constraint ai_triage_runs_revision_id_key unique (revision_id),
  constraint ai_triage_runs_program_sequence_key unique (program_id, program_submission_sequence)
);

comment on table public.ai_triage_runs is
  'Durable private AI outbox. Workers claim FIFO per program; provider payloads and credentials are never stored.';

alter table public.ai_triage_results
  add column run_id uuid,
  add column source_submission_revision integer
    constraint ai_triage_results_source_revision_check check (
      source_submission_revision is null or source_submission_revision > 0
    ),
  add column source_content_hash text
    constraint ai_triage_results_source_hash_check check (
      source_content_hash is null or source_content_hash ~ '^0x[0-9a-fA-F]{64}$'
    ),
  add column generated_at timestamp with time zone,
  add column persisted_at timestamp with time zone,
  add column superseded_at timestamp with time zone,
  add constraint ai_triage_results_run_id_fkey
    foreign key (run_id) references public.ai_triage_runs (id) on delete restrict;

create unique index ai_triage_results_run_id_unique
  on public.ai_triage_results (run_id)
  where run_id is not null;

create or replace function public.assert_ai_triage_result_source()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  source_run public.ai_triage_runs;
begin
  if new.run_id is null then
    return new;
  end if;

  select * into source_run from public.ai_triage_runs where id = new.run_id;
  if not found
    or source_run.report_id <> new.report_id
    or new.source_submission_revision is distinct from source_run.submission_revision
    or new.source_content_hash is distinct from source_run.source_content_hash
  then
    raise exception 'ai_triage_result_source_mismatch' using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger ai_triage_results_source_guard
before insert or update on public.ai_triage_results
for each row
execute function public.assert_ai_triage_result_source();

create index report_revisions_program_sequence_idx
  on public.report_revisions (program_id, program_submission_sequence, id);

create index ai_triage_runs_program_status_sequence_idx
  on public.ai_triage_runs (program_id, status, program_submission_sequence, available_at, id);

create index ai_triage_runs_due_idx
  on public.ai_triage_runs (status, available_at, program_id, program_submission_sequence, id)
  where status = 'queued';

create index ai_triage_results_current_report_idx
  on public.ai_triage_results (report_id, source_submission_revision, persisted_at desc, id)
  where superseded_at is null;

create or replace function public.prevent_report_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'report_revisions is immutable' using errcode = '55000';
end;
$$;

create trigger report_revisions_prevent_update_delete
before update or delete on public.report_revisions
for each row
execute function public.prevent_report_revision_mutation();

alter table public.report_revisions enable row level security;
alter table public.report_revisions force row level security;
alter table public.ai_program_queues enable row level security;
alter table public.ai_program_queues force row level security;
alter table public.ai_triage_runs enable row level security;
alter table public.ai_triage_runs force row level security;

-- SEC-PROD-001 was applied before these tables existed, so install its restrictive active-Auth
-- boundary explicitly for the additive tables as well.
create policy authenticated_user_must_be_active
on public.report_revisions as restrictive
for all to authenticated
using ((select public.is_active_auth_user()))
with check ((select public.is_active_auth_user()));

create policy authenticated_user_must_be_active
on public.ai_program_queues as restrictive
for all to authenticated
using ((select public.is_active_auth_user()))
with check ((select public.is_active_auth_user()));

create policy authenticated_user_must_be_active
on public.ai_triage_runs as restrictive
for all to authenticated
using ((select public.is_active_auth_user()))
with check ((select public.is_active_auth_user()));

-- Existing reports are given one historical snapshot for candidate retrieval.  Existing AI rows
-- are intentionally not enqueued again: only a new submit/resubmit creates a durable run.
insert into public.report_revisions (
  report_id, program_id, revision, program_submission_sequence, content_hash, snapshot, created_at
)
select
  report.id,
  report.program_id,
  1,
  row_number() over (
    partition by report.program_id
    order by coalesce(report.submitted_at, report.created_at), report.id
  ),
  report.content_hash,
  jsonb_build_object(
    'affectedScopeId', report.affected_scope_id::text,
    'title', report.title,
    'description', report.description,
    'reproductionSteps', report.reproduction_steps,
    'secretGistUrl', report.secret_gist_url,
    'proposedSeverity', report.proposed_severity,
    'severityMismatchAcknowledged', report.severity_mismatch_acknowledged,
    'programImpactIds', coalesce((
      select jsonb_agg(impact.program_impact_id::text order by impact.id)
      from public.report_impacts impact
      where impact.report_id = report.id and impact.program_impact_id is not null
    ), '[]'::jsonb),
    'customImpacts', coalesce((
      select jsonb_agg(impact.custom_title order by impact.id)
      from public.report_impacts impact
      where impact.report_id = report.id and impact.source = 'custom'
    ), '[]'::jsonb)
  ),
  coalesce(report.submitted_at, report.created_at)
from public.reports report
where report.submitted_at is not null
on conflict (report_id, revision) do nothing;

insert into public.ai_program_queues (program_id, last_submission_sequence)
select program_id, max(program_submission_sequence)
from public.report_revisions
group by program_id
on conflict (program_id) do update
set last_submission_sequence = greatest(
  public.ai_program_queues.last_submission_sequence,
  excluded.last_submission_sequence
);

revoke all on public.report_revisions, public.ai_program_queues, public.ai_triage_runs
from anon, authenticated;
revoke all on function public.prevent_report_revision_mutation() from public;
grant execute on function public.prevent_report_revision_mutation() to service_role;
revoke all on function public.assert_ai_triage_result_source() from public;
grant execute on function public.assert_ai_triage_result_source() to service_role;

-- Called by the submit/resubmit RPCs while their report row is locked.  The queue identity row
-- serializes submissions for one program; other programs can allocate independently.
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

-- Re-declare the submission RPCs after the additive tables exist.  Keeping the business checks
-- in the RPC preserves the API-only write boundary; the helper above only runs after impacts are
-- written, so every queued run points at a complete immutable snapshot.
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
  where id = target_program_id
  for update;

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

  selected_impact_count := coalesce(jsonb_array_length(input -> 'programImpactIds'), 0);
  custom_impact_count := coalesce(jsonb_array_length(input -> 'customImpacts'), 0);

  if selected_impact_count + custom_impact_count = 0 then
    perform public.reject_business('impact_selection_required');
  end if;

  if custom_impact_count > 0 and not program_record.allow_custom_impact then
    perform public.reject_business('custom_impact_not_allowed');
  end if;

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
    program_id, researcher_id, affected_scope_id, title, description,
    reproduction_steps, secret_gist_url, proposed_severity,
    severity_mismatch_acknowledged, status, content_hash, submitted_at
  )
  values (
    target_program_id, actor_id, scope_record.id, input ->> 'title', input ->> 'description',
    nullif(btrim(coalesce(input ->> 'reproductionSteps', '')), ''),
    nullif(btrim(coalesce(input ->> 'secretGistUrl', '')), ''),
    input ->> 'proposedSeverity',
    coalesce((input ->> 'severityMismatchAcknowledged')::boolean, false),
    'submitted', generated_content_hash, now()
  )
  returning id into created_report_id;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source,
    impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
  )
  select created_report_id, target_program_id, impact.id, 'program',
    impact.title, impact.severity, impact.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
    as requested(impact_id)
  join public.program_impacts impact on impact.id = requested.impact_id::uuid;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source, custom_title,
    impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
  )
  select created_report_id, target_program_id, null, 'custom', btrim(proposed.title),
    btrim(proposed.title), null, scope_record.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'customImpacts', '[]'::jsonb))
    as proposed(title)
  where length(btrim(proposed.title)) > 0;

  if not exists (select 1 from public.report_impacts where report_id = created_report_id) then
    perform public.reject_business('impact_selection_required');
  end if;

  perform public.enqueue_report_ai_run_atomic(
    created_report_id, target_program_id, generated_content_hash
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    program_record.owner_id,
    'report_submitted',
    jsonb_build_object('reportId', created_report_id, 'programId', target_program_id)
  );

  return created_report_id;
end;
$$;

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

  select * into program_record from public.programs
  where id = report_record.program_id
  for update;

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
    submitted_at = case when resubmit then coalesce(submitted_at, now()) else submitted_at end
  where id = target_report_id;

  if program_record.poc_policy = 'required' and exists (
    select 1 from public.reports
    where id = target_report_id
      and length(btrim(coalesce(reproduction_steps, ''))) = 0
  ) then
    perform public.reject_business('reproduction_steps_required');
  end if;

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
    select target_report_id, report_record.program_id, impact.id, 'program',
      impact.title, impact.severity, impact.asset_type
    from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
      as requested(impact_id)
    join public.program_impacts impact on impact.id = requested.impact_id::uuid;

    insert into public.report_impacts (
      report_id, program_id, program_impact_id, source, custom_title,
      impact_title_snapshot, impact_severity_snapshot, asset_type_snapshot
    )
    select target_report_id, report_record.program_id, null, 'custom', btrim(proposed.title),
      btrim(proposed.title), null, scope_record.asset_type
    from jsonb_array_elements_text(coalesce(input -> 'customImpacts', '[]'::jsonb))
      as proposed(title)
    where length(btrim(proposed.title)) > 0;

    if not exists (select 1 from public.report_impacts where report_id = target_report_id) then
      perform public.reject_business('impact_selection_required');
    end if;
  end if;

  if resubmit then
    perform public.enqueue_report_ai_run_atomic(
      target_report_id, report_record.program_id, generated_content_hash
    );
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

revoke all on function public.submit_report_atomic(uuid, uuid, jsonb, text) from public;
revoke all on function public.update_report_atomic(uuid, uuid, jsonb, text, boolean) from public;
grant execute on function public.submit_report_atomic(uuid, uuid, jsonb, text) to service_role;
grant execute on function public.update_report_atomic(uuid, uuid, jsonb, text, boolean) to service_role;

-- Claims the FIFO head for one program across all worker replicas.  A stale lease is returned to
-- the queue before selecting the head; completion code must compare locked_by before writing a
-- terminal result.  The short transaction never holds a database lock during provider I/O.
create or replace function public.claim_ai_triage_run(
  worker_id text,
  lease_seconds integer default 300
)
returns setof public.ai_triage_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed public.ai_triage_runs;
  lock_token text;
begin
  if length(btrim(coalesce(worker_id, ''))) not between 1 and 200
    or lease_seconds < 30 or lease_seconds > 3600
  then
    perform public.reject_business('ai_worker_claim_invalid');
  end if;

  update public.ai_triage_runs
  set status = 'queued', locked_by = null, locked_at = null, available_at = now()
  where status = 'running'
    and locked_at is not null
    and locked_at < now() - make_interval(secs => lease_seconds)
    and attempt_count < 5;

  lock_token := btrim(worker_id) || ':' || gen_random_uuid()::text;

  with candidate as (
    select run.id
    from public.ai_triage_runs run
    where run.status = 'queued'
      and coalesce(run.next_attempt_at, run.available_at) <= now()
      and not exists (
        select 1
        from public.ai_triage_runs prior
        where prior.program_id = run.program_id
          and prior.program_submission_sequence < run.program_submission_sequence
          and prior.status not in ('completed', 'failed')
      )
    order by run.program_submission_sequence, run.id
    for update skip locked
    limit 1
  )
  update public.ai_triage_runs run
  set status = 'running',
      attempt_count = run.attempt_count + 1,
      locked_by = lock_token,
      locked_at = now(),
      started_at = coalesce(run.started_at, now()),
      next_attempt_at = null
  from candidate
  where run.id = candidate.id
  returning run.* into claimed;

  if claimed.id is not null then
    return next claimed;
  end if;

  return;
end;
$$;

-- Candidate retrieval is intentionally worker-only.  It returns private snapshots to the
-- service-role worker, never to authenticated callers.  Scope/impact are ranking signals only;
-- exact hash, text and semantic fingerprint signals are unioned so incorrect metadata cannot
-- hide a duplicate.
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
  ), prior as (
    select revision.report_id, revision.program_id, revision.revision,
      revision.program_submission_sequence, revision.content_hash, revision.snapshot,
      prior_run.fingerprint,
      current_run.current_snapshot,
      current_run.current_fingerprint,
      current_run.current_hash,
      (revision.content_hash = current_run.current_hash)::integer * 100
        + case when revision.snapshot ->> 'affectedScopeId' = current_run.current_snapshot ->> 'affectedScopeId'
          then 5 else 0 end
        + case when to_tsvector('simple',
            coalesce(revision.snapshot ->> 'title', '') || ' ' ||
            coalesce(revision.snapshot ->> 'description', '') || ' ' ||
            coalesce(revision.snapshot ->> 'reproductionSteps', '')
          ) @@ plainto_tsquery('simple',
            coalesce(current_run.current_snapshot ->> 'title', '') || ' ' ||
            coalesce(current_run.current_snapshot ->> 'description', '') || ' ' ||
            coalesce(current_run.current_snapshot ->> 'reproductionSteps', '')
          ) then 20 else 0 end
        + case when exists (
            select 1
            from jsonb_array_elements_text(coalesce(current_run.current_fingerprint -> 'functions', '[]'::jsonb)) current_function
            join jsonb_array_elements_text(coalesce(prior_run.fingerprint -> 'functions', '[]'::jsonb)) prior_function
              on lower(current_function.value) = lower(prior_function.value)
          ) then 30 else 0 end
        + case when exists (
            select 1
            from jsonb_array_elements_text(coalesce(current_run.current_fingerprint -> 'affectedComponents', '[]'::jsonb)) current_component
            join jsonb_array_elements_text(coalesce(prior_run.fingerprint -> 'affectedComponents', '[]'::jsonb)) prior_component
              on lower(current_component.value) = lower(prior_component.value)
          ) then 20 else 0 end
        + case when coalesce(current_run.current_fingerprint ->> 'attackVector', '') <> ''
            and lower(current_run.current_fingerprint ->> 'attackVector') = lower(prior_run.fingerprint ->> 'attackVector')
          then 20 else 0 end as match_score
    from current_run
    join public.report_revisions revision
      on revision.program_id = current_run.program_id
      and revision.program_submission_sequence < current_run.program_submission_sequence
      and revision.report_id <> current_run.report_id
    left join public.ai_triage_runs prior_run on prior_run.revision_id = revision.id
  )
  select prior.report_id, prior.program_id, prior.revision,
    prior.program_submission_sequence, prior.content_hash, prior.snapshot,
    prior.fingerprint, prior.match_score,
    jsonb_build_object(
      'exactHash', prior.content_hash = prior.current_hash,
      'scopeMatch', prior.snapshot ->> 'affectedScopeId' = prior.current_snapshot ->> 'affectedScopeId',
      'textMatch', prior.match_score >= 20,
      'fingerprintMatch', prior.match_score >= 30
    )
  from prior
  where prior.match_score > 0
  order by prior.match_score desc, prior.program_submission_sequence, prior.report_id
  limit bounded_limit;
end;
$$;

revoke all on function public.claim_ai_triage_run(text, integer) from public;
revoke all on function public.list_ai_duplicate_candidates(uuid, integer) from public;
grant execute on function public.claim_ai_triage_run(text, integer) to service_role;
grant execute on function public.list_ai_duplicate_candidates(uuid, integer) to service_role;

-- A worker may optionally pin a claim to one program when it is already running a per-program
-- scheduler.  The unscoped claim above is still useful for a global dispatcher.
create or replace function public.claim_ai_triage_run_for_program(
  worker_id text,
  target_program_id uuid,
  lease_seconds integer default 300
)
returns setof public.ai_triage_runs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  claimed public.ai_triage_runs;
  lock_token text;
begin
  if target_program_id is null
    or length(btrim(coalesce(worker_id, ''))) not between 1 and 200
    or lease_seconds < 30 or lease_seconds > 3600
  then
    perform public.reject_business('ai_worker_claim_invalid');
  end if;

  update public.ai_triage_runs
  set status = 'queued', locked_by = null, locked_at = null, available_at = now()
  where program_id = target_program_id
    and status = 'running'
    and locked_at is not null
    and locked_at < now() - make_interval(secs => lease_seconds)
    and attempt_count < 5;

  lock_token := btrim(worker_id) || ':' || gen_random_uuid()::text;

  with candidate as (
    select run.id
    from public.ai_triage_runs run
    where run.program_id = target_program_id
      and run.status = 'queued'
      and coalesce(run.next_attempt_at, run.available_at) <= now()
      and not exists (
        select 1 from public.ai_triage_runs prior
        where prior.program_id = run.program_id
          and prior.program_submission_sequence < run.program_submission_sequence
          and prior.status not in ('completed', 'failed')
      )
    order by run.program_submission_sequence, run.id
    for update skip locked
    limit 1
  )
  update public.ai_triage_runs run
  set status = 'running',
      attempt_count = run.attempt_count + 1,
      locked_by = lock_token,
      locked_at = now(),
      started_at = coalesce(run.started_at, now()),
      next_attempt_at = null
  from candidate
  where run.id = candidate.id
  returning run.* into claimed;

  if claimed.id is not null then
    return next claimed;
  end if;
  return;
end;
$$;

revoke all on function public.claim_ai_triage_run_for_program(text, uuid, integer) from public;
grant execute on function public.claim_ai_triage_run_for_program(text, uuid, integer) to service_role;
