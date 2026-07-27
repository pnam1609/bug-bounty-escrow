-- DB-011: Idempotent on-chain funding, payout, and refund event records.
--
-- Enum values mirror ESCROW_TRANSACTION_TYPES / ESCROW_TRANSACTION_STATUSES in
-- packages/domain so the database and the TypeScript domain cannot drift.

create table public.escrow_transactions (
  id uuid default gen_random_uuid()
    constraint escrow_transactions_pkey primary key,
  program_id uuid not null
    constraint escrow_transactions_program_id_fkey
      references public.programs (id) on delete restrict,
  report_id uuid
    constraint escrow_transactions_report_id_fkey
      references public.reports (id) on delete restrict,
  escrow_contract_id uuid not null
    constraint escrow_transactions_escrow_contract_id_fkey
      references public.escrow_contracts (id) on delete restrict,
  chain_id bigint not null
    constraint escrow_transactions_chain_id_check
      check (chain_id > 0),
  transaction_hash text not null
    constraint escrow_transactions_transaction_hash_check
      check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer
    constraint escrow_transactions_log_index_check
      check (log_index is null or log_index >= 0),
  transaction_type text not null
    constraint escrow_transactions_type_check
      check (transaction_type in ('funding', 'payout', 'refund')),
  status text not null default 'pending'
    constraint escrow_transactions_status_check
      check (status in ('pending', 'confirmed', 'reverted', 'timeout')),
  token_address text not null
    constraint escrow_transactions_token_address_check
      check (
        token_address ~ '^0x[0-9a-f]{40}$'
        and token_address <> '0x0000000000000000000000000000000000000000'
      ),
  amount numeric(30, 6) not null
    constraint escrow_transactions_amount_positive_check
      check (amount > 0),
  block_number bigint
    constraint escrow_transactions_block_number_check
      check (block_number is null or block_number >= 0),
  block_hash text
    constraint escrow_transactions_block_hash_check
      check (block_hash is null or block_hash ~ '^0x[0-9a-f]{64}$'),
  confirmations integer not null default 0
    constraint escrow_transactions_confirmations_check
      check (confirmations >= 0),
  failure_code text
    constraint escrow_transactions_failure_code_check
      check (failure_code is null or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'),
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint escrow_transactions_chain_event_key
    unique nulls not distinct (chain_id, transaction_hash, log_index),
  constraint escrow_transactions_report_type_check
    check (
      (transaction_type = 'payout' and report_id is not null)
      or (transaction_type in ('funding', 'refund') and report_id is null)
    ),
  -- Exactly one payout may ever settle a given report.
  constraint escrow_transactions_failure_state_check
    check ((status in ('reverted', 'timeout')) = (failure_code is not null))
);

comment on column public.escrow_transactions.failure_code is
  'Machine-readable reason for a reverted or timed-out transaction. Never a provider error string.';

create unique index escrow_transactions_settled_report_idx
  on public.escrow_transactions (report_id)
  where transaction_type = 'payout' and status = 'confirmed';

create index escrow_transactions_hash_idx
  on public.escrow_transactions (transaction_hash);

create trigger escrow_transactions_set_updated_at
before update on public.escrow_transactions
for each row
execute function public.set_updated_at();

alter table public.escrow_transactions enable row level security;
