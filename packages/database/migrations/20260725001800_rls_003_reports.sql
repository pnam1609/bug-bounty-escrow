-- RLS-003: Participant-only reports and attachment metadata.

create or replace function public.can_access_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.reports
    where reports.id = target_report_id
      and (
        reports.researcher_id = auth.uid()
        or public.is_program_owner(reports.program_id)
        or public.is_program_reviewer(reports.program_id)
      )
  );
$$;

create or replace function public.can_review_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.reports
    where reports.id = target_report_id
      and (
        public.is_program_owner(reports.program_id)
        or public.is_program_reviewer(reports.program_id)
      )
  );
$$;

revoke all on function public.can_access_report(uuid) from public;
revoke all on function public.can_review_report(uuid) from public;
grant execute on function public.can_access_report(uuid) to authenticated;
grant execute on function public.can_review_report(uuid) to authenticated;

alter table public.reports force row level security;
alter table public.report_attachments force row level security;

create policy reports_select_participant
on public.reports
for select
to authenticated
using (
  researcher_id = auth.uid()
  or public.is_program_owner(program_id)
  or public.is_program_reviewer(program_id)
);

create policy reports_insert_researcher
on public.reports
for insert
to authenticated
with check (
  researcher_id = auth.uid()
  and status in ('draft', 'submitted')
  and exists (
    select 1
    from public.programs
    where programs.id = reports.program_id
      and programs.status = 'active'
  )
  and exists (
    select 1
    from public.program_scopes
    where program_scopes.id = reports.affected_scope_id
      and program_scopes.program_id = reports.program_id
      and program_scopes.is_in_scope
      and program_scopes.archived_at is null
  )
);

create policy reports_update_researcher_editable
on public.reports
for update
to authenticated
using (
  researcher_id = auth.uid()
  and status in ('draft', 'needs_information')
)
with check (
  researcher_id = auth.uid()
  and status in ('draft', 'needs_information', 'submitted')
);

create policy report_attachments_select_participant
on public.report_attachments
for select
to authenticated
using (public.can_access_report(report_id));

create policy report_attachments_insert_participant
on public.report_attachments
for insert
to authenticated
with check (
  uploader_id = auth.uid()
  and public.can_access_report(report_id)
);

revoke all on public.reports, public.report_attachments from anon, authenticated;
grant select, insert on public.reports to authenticated;
-- Reward and payment columns are absent: only settlement RPCs may write them.
grant update (
  affected_scope_id,
  title,
  description,
  reproduction_steps,
  proposed_severity,
  status,
  content_hash,
  submitted_at,
  updated_at
) on public.reports to authenticated;
grant select, insert on public.report_attachments to authenticated;
