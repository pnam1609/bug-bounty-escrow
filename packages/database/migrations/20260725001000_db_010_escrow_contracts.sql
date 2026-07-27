-- DB-010: Per-program Arc escrow deployment records.

create table public.escrow_contracts (
  id uuid default gen_random_uuid()
    constraint escrow_contracts_pkey primary key,
  program_id uuid not null
    constraint escrow_contracts_program_id_fkey
      references public.programs (id) on delete restrict,
  chain_id bigint not null
    constraint escrow_contracts_chain_id_check
      check (chain_id > 0),
  contract_address text
    constraint escrow_contracts_contract_address_check
      check (
        contract_address is null
        or (
          contract_address ~ '^0x[0-9a-f]{40}$'
          and contract_address <> '0x0000000000000000000000000000000000000000'
        )
      ),
  deployment_transaction_hash text not null
    constraint escrow_contracts_deployment_transaction_hash_check
      check (deployment_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  deployment_status text not null default 'pending'
    constraint escrow_contracts_deployment_status_check
      check (deployment_status in ('pending', 'confirmed', 'failed')),
  deployed_at timestamp with time zone,
  failure_code text
    constraint escrow_contracts_failure_code_check
      check (
        failure_code is null
        or failure_code ~ '^[a-z][a-z0-9._-]{0,127}$'
      ),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint escrow_contracts_program_chain_key unique (program_id, chain_id),
  constraint escrow_contracts_chain_address_key unique (chain_id, contract_address),
  constraint escrow_contracts_chain_deployment_transaction_key
    unique (chain_id, deployment_transaction_hash),
  constraint escrow_contracts_deployment_outcome_check
    check (
      (
        deployment_status = 'pending'
        and contract_address is null
        and deployed_at is null
        and failure_code is null
      )
      or (
        deployment_status = 'confirmed'
        and contract_address is not null
        and deployed_at is not null
        and failure_code is null
      )
      or (
        deployment_status = 'failed'
        and contract_address is null
        and deployed_at is null
        and failure_code is not null
      )
    )
);

create trigger escrow_contracts_set_updated_at
before update on public.escrow_contracts
for each row
execute function public.set_updated_at();

alter table public.escrow_contracts enable row level security;
