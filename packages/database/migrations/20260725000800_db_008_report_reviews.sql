-- DB-008: Append-oriented human review and report-state transition records.

create table public.report_reviews (
  id uuid default gen_random_uuid()
    constraint report_reviews_pkey primary key,
  report_id uuid not null
    constraint report_reviews_report_id_fkey
      references public.reports (id) on delete restrict,
  reviewer_id uuid not null
    constraint report_reviews_reviewer_id_fkey
      references public.profiles (id) on delete restrict,
  action text not null
    constraint report_reviews_action_check
      check (
        action in (
          'triage',
          'request_information',
          'resubmit',
          'reject',
          'mark_duplicate',
          'validate',
          'approve_reward',
          'start_payment',
          'confirm_payment'
        )
      ),
  from_status text not null
    constraint report_reviews_from_status_check
      check (
        from_status in (
          'draft',
          'submitted',
          'triaged',
          'needs_information',
          'rejected',
          'duplicate',
          'validated',
          'reward_approved',
          'payment_pending',
          'paid'
        )
      ),
  to_status text not null
    constraint report_reviews_to_status_check
      check (
        to_status in (
          'draft',
          'submitted',
          'triaged',
          'needs_information',
          'rejected',
          'duplicate',
          'validated',
          'reward_approved',
          'payment_pending',
          'paid'
        )
      ),
  reason text,
  metadata jsonb not null default '{}'::jsonb
    constraint report_reviews_metadata_object_check
      check (jsonb_typeof(metadata) = 'object'),
  created_at timestamp with time zone not null default now(),
  constraint report_reviews_state_changed_check check (from_status <> to_status),
  constraint report_reviews_reason_required_check
    check (
      action not in ('request_information', 'reject', 'mark_duplicate')
      or (reason is not null and length(btrim(reason)) > 0)
    )
);

comment on column public.report_reviews.metadata is
  'Safe transition metadata only; report content, credentials, and signed URLs are prohibited.';

alter table public.report_reviews enable row level security;
