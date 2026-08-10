-- An original report must precede the report being closed as a duplicate. The UI search is only a
-- convenience; this invariant must be enforced by the atomic transition.
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
    or original_record.submitted_at is null
    or report_record.submitted_at is null
    or original_record.submitted_at >= report_record.submitted_at
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
