-- DB-009: Optional AI triage output that cannot make final review or payout decisions.

create table public.ai_triage_results (
  id uuid default gen_random_uuid()
    constraint ai_triage_results_pkey primary key,
  report_id uuid not null
    constraint ai_triage_results_report_id_fkey
      references public.reports (id) on delete restrict,
  provider text not null
    constraint ai_triage_results_provider_check
      check (provider ~ '^[a-z][a-z0-9_-]{0,63}$'),
  model text not null
    constraint ai_triage_results_model_check
      check (length(btrim(model)) between 1 and 200),
  schema_version integer not null
    constraint ai_triage_results_schema_version_check
      check (schema_version > 0),
  result jsonb,
  confidence numeric(5, 4)
    constraint ai_triage_results_confidence_check
      check (confidence is null or confidence between 0 and 1),
  error_code text
    constraint ai_triage_results_error_code_check
      check (
        error_code is null
        or error_code ~ '^[a-z][a-z0-9._-]{0,127}$'
      ),
  error_message text
    constraint ai_triage_results_error_message_check
      check (
        error_message is null
        or length(error_message) between 1 and 500
      ),
  created_at timestamp with time zone not null default now(),
  constraint ai_triage_results_outcome_check
    check (
      (
        result is not null
        and jsonb_typeof(result) = 'object'
        and confidence is not null
        and error_code is null
        and error_message is null
      )
      or (
        result is null
        and confidence is null
        and error_code is not null
      )
    )
);

comment on table public.ai_triage_results is
  'Contains structured assistance or safe failure metadata. API keys and provider credentials are prohibited.';

alter table public.ai_triage_results enable row level security;
