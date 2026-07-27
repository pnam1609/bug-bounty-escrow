-- RLS-004: Collaboration visibility inherits private report access; disclosures are public.

alter table public.report_comments force row level security;
alter table public.report_reviews force row level security;
alter table public.report_impacts force row level security;
alter table public.ai_triage_results force row level security;
alter table public.report_disclosures force row level security;

create policy report_comments_select_participant
on public.report_comments
for select
to authenticated
using (public.can_access_report(report_id));

create policy report_comments_insert_participant
on public.report_comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and public.can_access_report(report_id)
);

create policy report_reviews_select_participant
on public.report_reviews
for select
to authenticated
using (public.can_access_report(report_id));

create policy report_impacts_select_participant
on public.report_impacts
for select
to authenticated
using (public.can_access_report(report_id));

create policy ai_triage_results_select_reviewer
on public.ai_triage_results
for select
to authenticated
using (public.can_review_report(report_id));

-- Published disclosures are the only report-derived data anyone may read without being a
-- participant. Unpublished decisions stay visible to the program side only.
create policy report_disclosures_select_published
on public.report_disclosures
for select
to anon, authenticated
using (
  published_at is not null
  or public.is_program_owner(program_id)
  or public.is_program_reviewer(program_id)
);

revoke all on
  public.report_comments,
  public.report_reviews,
  public.report_impacts,
  public.ai_triage_results,
  public.report_disclosures
from anon, authenticated;

grant select, insert on public.report_comments to authenticated;
grant select on public.report_reviews, public.ai_triage_results to authenticated;
grant select, insert on public.report_impacts to authenticated;
grant select on public.report_disclosures to anon, authenticated;
