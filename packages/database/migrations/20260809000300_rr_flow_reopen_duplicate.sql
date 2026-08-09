-- RR-FLOW-008: owner-only, audited reopen for an unfunded duplicate report.

alter table public.report_reviews
  drop constraint report_reviews_action_check;

alter table public.report_reviews
  add constraint report_reviews_action_check
  check (
    action in (
      'triage', 'request_information', 'resubmit', 'reject', 'mark_duplicate',
      'reopen_duplicate', 'validate', 'approve_reward', 'start_payment',
      'confirm_payment'
    )
  );

alter table public.notifications
  drop constraint notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'report_submitted', 'information_requested', 'report_resubmitted',
      'report_validated', 'report_rejected', 'report_duplicate', 'report_reopened',
      'reward_approved', 'payment_pending', 'payment_confirmed', 'comment_added',
      'program_published', 'disclosure_published'
    )
  );

create or replace function public.reopen_duplicate_report_atomic(
  actor_id uuid,
  target_report_id uuid,
  transition_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  original_report_id uuid;
  original_report_id_text text;
begin
  select * into report_record
  from public.reports
  where id = target_report_id
  for update;

  if not found then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  -- Lock the program after the report so every reopen observes one lifecycle/pool snapshot.
  select * into program_record
  from public.programs
  where id = report_record.program_id
  for update;

  if not found or program_record.owner_id <> actor_id then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status <> 'duplicate' then
    perform public.reject_business('invalid_report_transition');
  end if;

  if program_record.status <> 'active' then
    perform public.reject_business('duplicate_reopen_program_not_active');
  end if;

  if program_record.total_pool <> 0
    or program_record.reserved_pool <> 0
    or program_record.paid_pool <> 0
    or program_record.withdrawn_pool <> 0
  then
    perform public.reject_business('duplicate_reopen_funded');
  end if;

  if exists (
    select 1 from public.escrow_transactions
    where report_id = target_report_id
  ) or exists (
    select 1 from public.reward_settlement_intents
    where report_id = target_report_id
  ) or exists (
    select 1 from public.report_disclosures
    where report_id = target_report_id
  ) then
    perform public.reject_business('duplicate_reopen_settlement_started');
  end if;

  -- Treat malformed or missing historical metadata as a stable business rejection rather than
  -- letting PostgreSQL raise an unhandled uuid-cast exception (which would surface as HTTP 500).
  original_report_id_text := nullif(
    (select metadata ->> 'originalReportId'
     from public.report_reviews
     where report_id = target_report_id
       and action = 'mark_duplicate'
     order by created_at desc
     limit 1),
    ''
  );

  if original_report_id_text is null
    or original_report_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    perform public.reject_business('duplicate_target_invalid');
  end if;
  original_report_id := original_report_id_text::uuid;

  if original_report_id is null or not exists (
    select 1 from public.reports original
    where original.id = original_report_id
      and original.program_id = report_record.program_id
      and original.id <> target_report_id
      and coalesce(original.submitted_at, original.created_at)
        < coalesce(report_record.submitted_at, report_record.created_at)
  ) then
    perform public.reject_business('duplicate_target_invalid');
  end if;

  update public.reports
  set status = 'submitted'
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, reason, metadata
  )
  values (
    target_report_id, actor_id, 'reopen_duplicate', 'duplicate', 'submitted',
    coalesce(nullif(btrim(transition_reason), ''), 'Owner reopened duplicate for review'),
    jsonb_build_object('originalReportId', original_report_id)
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'report_reopened',
    jsonb_build_object('reportId', target_report_id)
  );

  return target_report_id;
end;
$$;

revoke all on function public.reopen_duplicate_report_atomic(uuid, uuid, text) from public;
grant execute on function public.reopen_duplicate_report_atomic(uuid, uuid, text) to service_role;
