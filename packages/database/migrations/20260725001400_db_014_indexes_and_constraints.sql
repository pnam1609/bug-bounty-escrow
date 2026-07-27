-- DB-014: Access-pattern indexes and final cross-table/lifecycle constraints.

alter table public.reports
  -- Proves the affected scope belongs to the report's own program, not just that it exists.
  add constraint reports_affected_scope_program_fkey
    foreign key (affected_scope_id, program_id)
    references public.program_scopes (id, program_id)
    on delete restrict,
  add constraint reports_submission_state_check
    check (
      (status = 'draft' and submitted_at is null)
      or (status <> 'draft' and submitted_at is not null)
    ),
  add constraint reports_submitted_at_check
    check (submitted_at is null or submitted_at >= created_at),
  add constraint reports_final_severity_state_check
    check (
      status not in ('validated', 'reward_approved', 'payment_pending', 'paid')
      or final_severity is not null
    ),
  add constraint reports_reward_fields_pair_check
    check ((approved_reward is null) = (reward_approved_at is null)),
  add constraint reports_reward_state_check
    check (
      status not in ('reward_approved', 'payment_pending', 'paid')
      or (approved_reward is not null and reward_approved_at is not null)
    ),
  add constraint reports_reward_approved_at_check
    check (reward_approved_at is null or reward_approved_at >= created_at),
  add constraint reports_paid_state_check
    check ((status = 'paid') = (paid_at is not null)),
  add constraint reports_paid_at_check
    check (paid_at is null or paid_at >= reward_approved_at);

alter table public.report_reviews
  add constraint report_reviews_action_transition_check
    check (
      (action = 'triage' and to_status = 'triaged')
      or (
        action = 'request_information'
        and to_status = 'needs_information'
      )
      or (action = 'resubmit' and to_status = 'submitted')
      or (action = 'reject' and to_status = 'rejected')
      or (action = 'mark_duplicate' and to_status = 'duplicate')
      or (action = 'validate' and to_status = 'validated')
      or (action = 'approve_reward' and to_status = 'reward_approved')
      or (action = 'start_payment' and to_status = 'payment_pending')
      or (action = 'confirm_payment' and to_status = 'paid')
    );

alter table public.escrow_contracts
  add constraint escrow_contracts_id_program_chain_key
    unique (id, program_id, chain_id),
  add constraint escrow_contracts_deployed_at_check
    check (deployed_at is null or deployed_at >= created_at);

alter table public.escrow_transactions
  add constraint escrow_transactions_report_program_fkey
    foreign key (report_id, program_id)
    references public.reports (id, program_id)
    on delete restrict,
  add constraint escrow_transactions_contract_program_chain_fkey
    foreign key (escrow_contract_id, program_id, chain_id)
    references public.escrow_contracts (id, program_id, chain_id)
    on delete restrict,
  add constraint escrow_transactions_confirmation_state_check
    check (
      status <> 'confirmed'
      or (
        block_number is not null
        and block_hash is not null
        and confirmations > 0
        and confirmed_at is not null
      )
    ),
  add constraint escrow_transactions_confirmed_at_check
    check (confirmed_at is null or confirmed_at >= created_at);

-- Public bounty table: filter on public_status, then sort by one of the sortable columns.
create index programs_public_created_at_idx
  on public.programs (public_status, created_at desc, id)
  where public_status is not null;

create index programs_public_max_bounty_idx
  on public.programs (public_status, max_bounty desc, id)
  where public_status is not null;

create index programs_public_paid_pool_idx
  on public.programs (public_status, paid_pool desc, id)
  where public_status is not null;

create index programs_public_deadline_idx
  on public.programs (public_status, deadline, id)
  where public_status is not null;

create index programs_in_scope_asset_types_idx
  on public.programs using gin (in_scope_asset_types);

create index programs_reward_severities_idx
  on public.programs using gin (reward_severities);

create index programs_owner_status_created_at_idx
  on public.programs (owner_id, status, created_at desc, id);

create index reports_program_status_submitted_at_idx
  on public.reports (program_id, status, submitted_at desc, id);

create index reports_researcher_status_submitted_at_idx
  on public.reports (researcher_id, status, submitted_at desc, id);

create index report_attachments_report_created_at_idx
  on public.report_attachments (report_id, created_at desc, id);

create index report_comments_report_created_at_idx
  on public.report_comments (report_id, created_at, id);

create index report_reviews_report_created_at_idx
  on public.report_reviews (report_id, created_at, id);

create index ai_triage_results_report_created_at_idx
  on public.ai_triage_results (report_id, created_at desc, id);

create index escrow_transactions_program_created_at_idx
  on public.escrow_transactions (program_id, created_at desc, id);

create index escrow_transactions_report_created_at_idx
  on public.escrow_transactions (report_id, created_at desc, id)
  where report_id is not null;

create index escrow_transactions_status_created_at_idx
  on public.escrow_transactions (status, created_at, id);

create index notifications_recipient_read_created_at_idx
  on public.notifications (recipient_id, read_at, created_at desc, id);

create index notifications_recipient_unread_created_at_idx
  on public.notifications (recipient_id, created_at desc, id)
  where read_at is null;

create index audit_logs_actor_created_at_idx
  on public.audit_logs (actor_id, created_at desc, id)
  where actor_id is not null;

create index audit_logs_entity_created_at_idx
  on public.audit_logs (entity_type, entity_id, created_at desc, id);
