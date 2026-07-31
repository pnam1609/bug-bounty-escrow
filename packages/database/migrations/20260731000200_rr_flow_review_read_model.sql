-- RR-FLOW-005: authorization-safe review/settlement read-model support.
-- This migration is additive and is never run against production by the application.

create index if not exists report_reviews_report_created_idx
  on public.report_reviews (report_id, created_at, id);

-- Duplicate metadata is only a reference to another report. The transition RPC already proves
-- same-program membership while holding both report rows; this constraint prevents malformed
-- metadata from becoming a trusted read-model input.
alter table public.report_reviews
  drop constraint if exists report_reviews_duplicate_metadata_check;
alter table public.report_reviews
  add constraint report_reviews_duplicate_metadata_check check (
    action is distinct from 'mark_duplicate'
    or (
      metadata is not null
      and coalesce(metadata ? 'originalReportId', false)
      and coalesce(
        (metadata->>'originalReportId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        false
      )
    )
  );

create or replace function public.report_review_events(
  actor_id uuid,
  target_report_id uuid
)
returns table (
  event_id uuid,
  actor_role text,
  action text,
  from_status text,
  to_status text,
  reason text,
  occurred_at timestamp with time zone,
  duplicate_target_id uuid,
  duplicate_same_program boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
begin
  select * into report_record from public.reports where id = target_report_id;
  if not found then
    perform public.reject_missing('report_not_accessible');
  end if;
  if report_record.researcher_id <> actor_id
     and not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  -- Researcher detail is aggregate-only. Human actor identity, reasons and transition history
  -- stay on the program side; the researcher already receives status/reward aggregates elsewhere.
  if report_record.researcher_id = actor_id then
    return;
  end if;

  return query
  select
    review.id,
    case when report_record.researcher_id = actor_id then null else profile.role end,
    review.action,
    review.from_status,
    review.to_status,
    case when report_record.researcher_id = actor_id then null else review.reason end,
    review.created_at,
    case
      when report_record.researcher_id = actor_id then null
      when (review.metadata->>'originalReportId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (review.metadata->>'originalReportId')::uuid
      else null
    end,
    case
      when report_record.researcher_id = actor_id then null
      else exists (
        select 1 from public.reports original
        where (review.metadata->>'originalReportId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and original.id = (review.metadata->>'originalReportId')::uuid
          and original.program_id = report_record.program_id
      )
    end
  from public.report_reviews review
  join public.profiles profile on profile.id = review.reviewer_id
  where review.report_id = target_report_id
  order by review.created_at, review.id;
end;
$$;

revoke all on function public.report_review_events(uuid, uuid) from public, anon, authenticated;
grant execute on function public.report_review_events(uuid, uuid) to service_role;

comment on function public.report_review_events(uuid, uuid) is
  'Private ordered review events. Researcher calls return no internal event rows; owner/reviewer calls include actor role and same-program duplicate reference only.';
