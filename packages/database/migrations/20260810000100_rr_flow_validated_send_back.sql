-- RR-FLOW-004/005: owner-only recovery from validated before reward settlement.

alter table public.report_reviews
  drop constraint report_reviews_action_check,
  drop constraint report_reviews_action_transition_check,
  drop constraint report_reviews_reason_required_check;

alter table public.report_reviews
  add constraint report_reviews_action_check
  check (
    action in (
      'triage', 'request_information', 'resubmit', 'reject', 'mark_duplicate',
      'reopen_duplicate', 'send_back_for_review', 'validate', 'approve_reward',
      'start_payment', 'confirm_payment'
    )
  ),
  add constraint report_reviews_action_transition_check
  check (
    (action = 'triage' and to_status = 'triaged')
    or (action = 'request_information' and to_status = 'needs_information')
    or (action = 'resubmit' and to_status = 'submitted')
    or (action = 'reject' and to_status = 'rejected')
    or (action = 'mark_duplicate' and to_status = 'duplicate')
    or (action = 'reopen_duplicate' and from_status = 'duplicate' and to_status = 'submitted')
    or (action = 'send_back_for_review' and from_status = 'validated' and to_status = 'submitted')
    or (action = 'validate' and to_status = 'validated')
    or (action = 'approve_reward' and to_status = 'reward_approved')
    or (action = 'start_payment' and to_status = 'payment_pending')
    or (action = 'confirm_payment' and to_status = 'paid')
  ),
  add constraint report_reviews_reason_required_check
  check (
    action not in ('request_information', 'reject', 'mark_duplicate', 'send_back_for_review')
    or (reason is not null and length(btrim(reason)) > 0)
  );

create or replace function public.send_report_back_for_review_atomic(
  actor_id uuid,
  target_report_id uuid,
  transition_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  normalized_reason text;
begin
  normalized_reason := nullif(btrim(transition_reason), '');
  if normalized_reason is null then
    perform public.reject_business('review_reason_required');
  end if;

  select * into report_record
  from public.reports
  where id = target_report_id
  for update;

  if not found then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  -- Lock the program after the report so owner authorization and lifecycle evidence share one
  -- snapshot with the transition. The owner is the only principal allowed to send a report back.
  select * into program_record
  from public.programs
  where id = report_record.program_id
  for update;

  if not found or program_record.owner_id <> actor_id then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status <> 'validated' then
    perform public.reject_business('invalid_report_transition');
  end if;

  -- A validated report can only be reopened before any reward, payment, disclosure, or settlement
  -- evidence exists. Any durable row is evidence, including failed/uncertain settlement attempts;
  -- fail closed rather than risking a second accounting path.
  if report_record.approved_reward is not null
    or report_record.reward_approved_at is not null
    or report_record.paid_at is not null
    or exists (
      select 1 from public.reward_settlement_intents
      where report_id = target_report_id
    )
    or exists (
      select 1 from public.escrow_transactions
      where report_id = target_report_id
    )
    or exists (
      select 1 from public.report_disclosures
      where report_id = target_report_id
    )
  then
    perform public.reject_business('validated_report_settlement_started');
  end if;

  update public.reports
  set status = 'submitted',
      final_severity = null
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, reason, metadata
  )
  values (
    target_report_id, actor_id, 'send_back_for_review', 'validated', 'submitted',
    normalized_reason, '{}'::jsonb
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'report_resubmitted',
    jsonb_build_object('reportId', target_report_id)
  );

  return target_report_id;
end;
$$;

revoke all on function public.send_report_back_for_review_atomic(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.send_report_back_for_review_atomic(uuid, uuid, text)
  to service_role;
