-- DB-005: Private vulnerability reports and their reward lifecycle.

create table public.reports (
  id uuid default gen_random_uuid()
    constraint reports_pkey primary key,
  program_id uuid not null
    constraint reports_program_id_fkey
      references public.programs (id) on delete restrict,
  researcher_id uuid not null
    constraint reports_researcher_id_fkey
      references public.profiles (id) on delete restrict,
  affected_scope_id uuid not null
    constraint reports_affected_scope_id_fkey
      references public.program_scopes (id) on delete restrict,
  title text not null
    constraint reports_title_not_blank_check
      check (length(btrim(title)) between 1 and 300),
  description text not null
    constraint reports_description_check
      check (length(btrim(description)) between 1 and 50000),
  -- Nullable because a program with poc_policy = 'optional' does not require proof.
  -- The requirement is enforced against the program's policy in submit_report_atomic.
  reproduction_steps text
    constraint reports_reproduction_steps_check
      check (reproduction_steps is null or length(btrim(reproduction_steps)) between 1 and 50000),
  -- Optional pointer to a secret Gist. Never a substitute for a required proof of concept.
  secret_gist_url text
    constraint reports_secret_gist_url_check
      check (
        secret_gist_url is null
        or (length(secret_gist_url) <= 2000 and secret_gist_url ~* '^https://[^[:space:]]+$')
      ),
  proposed_severity text not null
    constraint reports_proposed_severity_check
      check (proposed_severity in ('critical', 'high', 'medium', 'low', 'informational')),
  -- Audit signal: the researcher saw their proposed severity differ from the highest severity
  -- among the impacts they selected and chose to continue. It never becomes the final severity.
  severity_mismatch_acknowledged boolean not null default false,
  final_severity text
    constraint reports_final_severity_check
      check (
        final_severity is null
        or final_severity in ('critical', 'high', 'medium', 'low', 'informational')
      ),
  status text not null default 'draft'
    constraint reports_status_check
      check (
        status in (
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
  content_hash text not null
    constraint reports_content_hash_format_check
      check (content_hash ~ '^0x[0-9a-fA-F]{64}$'),
  approved_reward numeric(30, 6)
    constraint reports_approved_reward_non_negative_check
      check (approved_reward is null or approved_reward >= 0),
  reward_approved_at timestamp with time zone,
  submitted_at timestamp with time zone,
  paid_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  -- Lets report_impacts and escrow_transactions prove program membership via composite keys.
  constraint reports_id_program_id_key unique (id, program_id)
);

comment on table public.reports is
  'Private vulnerability content. This table must never be exposed through public program queries.';

comment on column public.reports.approved_reward is
  'Reserved against programs.reserved_pool at approval and moved to programs.paid_pool at payout.';

create trigger reports_set_updated_at
before update on public.reports
for each row
execute function public.set_updated_at();

alter table public.reports enable row level security;
