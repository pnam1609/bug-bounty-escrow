-- CP-11: server-controlled escrow deployment and owner fee evidence.
-- The Circle deployment wallet is operational only; the platform admin address is
-- persisted as the contract authority. Browser wallet proofs are intentionally not
-- accepted by the new RPC below.

alter table public.escrow_contracts
  add column if not exists platform_admin_wallet text,
  add column if not exists deployment_fee_quote_id uuid;

create table if not exists public.escrow_deployment_fee_quotes (
  id uuid primary key,
  program_id uuid not null references public.programs(id) on delete restrict,
  chain_id bigint not null check (chain_id > 0),
  token_address text not null check (token_address = lower(token_address) and token_address ~ '^0x[0-9a-f]{40}$'),
  recipient_address text not null check (recipient_address = lower(recipient_address) and recipient_address ~ '^0x[0-9a-f]{40}$'),
  amount_base_units numeric(78,0) not null check (amount_base_units > 0),
  status text not null default 'quoted' check (status in ('quoted','paid','expired','waived')),
  expires_at timestamptz not null,
  payment_transaction_hash text check (payment_transaction_hash is null or payment_transaction_hash ~ '^0x[0-9a-f]{64}$'),
  payer_address text check (payer_address is null or payer_address ~ '^0x[0-9a-f]{40}$'),
  payment_block_number numeric(78,0),
  payment_block_hash text check (payment_block_hash is null or payment_block_hash ~ '^0x[0-9a-f]{64}$'),
  payment_log_index integer,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint escrow_deployment_fee_quote_outcome_check check (
    (status = 'paid' and payment_transaction_hash is not null and paid_at is not null)
    or (status in ('quoted','expired','waived'))
  )
);
create unique index if not exists escrow_deployment_fee_quotes_program_active_idx
  on public.escrow_deployment_fee_quotes(program_id) where status in ('quoted','paid');
create index if not exists escrow_deployment_fee_quotes_program_idx
  on public.escrow_deployment_fee_quotes(program_id, created_at desc);
alter table public.escrow_deployment_fee_quotes enable row level security;
revoke all on public.escrow_deployment_fee_quotes from public, anon, authenticated;
grant select, insert, update on public.escrow_deployment_fee_quotes to service_role;
create policy authenticated_user_must_be_active on public.escrow_deployment_fee_quotes
  as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));

create trigger escrow_deployment_fee_quotes_set_updated_at
before update on public.escrow_deployment_fee_quotes
for each row execute function public.set_updated_at();

create or replace function public.create_deployment_fee_quote_atomic(
  target_quote_id uuid,
  actor_id uuid,
  target_program_id uuid,
  target_chain_id bigint,
  target_token_address text,
  target_recipient_address text,
  target_amount_base_units numeric,
  target_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare existing_id uuid;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_program_id::text || ':deployment-fee', 0));
  if not exists (select 1 from public.programs where id = target_program_id and owner_id = actor_id for update) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  update public.escrow_deployment_fee_quotes
    set status = 'expired'
    where program_id = target_program_id
      and status = 'quoted'
      and expires_at <= statement_timestamp();
  select id into existing_id from public.escrow_deployment_fee_quotes
   where program_id = target_program_id and status in ('quoted','paid') order by created_at desc limit 1 for update;
  if existing_id is not null then return existing_id; end if;
  insert into public.escrow_deployment_fee_quotes
    (id,program_id,chain_id,token_address,recipient_address,amount_base_units,expires_at)
  values (target_quote_id,target_program_id,target_chain_id,lower(target_token_address),lower(target_recipient_address),target_amount_base_units,target_expires_at);
  return target_quote_id;
end $$;

create or replace function public.mark_deployment_fee_paid_atomic(
  target_quote_id uuid,
  target_program_id uuid,
  target_payer_address text,
  target_payment_transaction_hash text,
  target_payment_block_number numeric,
  target_payment_block_hash text,
  target_payment_log_index integer
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare quote_row public.escrow_deployment_fee_quotes%rowtype;
begin
  select * into quote_row from public.escrow_deployment_fee_quotes where id = target_quote_id and program_id = target_program_id for update;
  if not found then raise exception using errcode = 'P0002', detail = 'deployment_fee_quote_not_found'; end if;
  if quote_row.status = 'paid' then return quote_row.id; end if;
  if quote_row.status <> 'quoted' or quote_row.expires_at <= statement_timestamp() then
    raise exception using errcode = '23514', detail = 'deployment_fee_quote_expired';
  end if;
  update public.escrow_deployment_fee_quotes set status='paid', payer_address=lower(target_payer_address),
    payment_transaction_hash=lower(target_payment_transaction_hash), payment_block_number=target_payment_block_number,
    payment_block_hash=lower(target_payment_block_hash), payment_log_index=target_payment_log_index, paid_at=statement_timestamp()
    where id = quote_row.id;
  return quote_row.id;
end $$;

create or replace function public.create_escrow_deployment_server_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_program_key text,
  target_platform_admin_wallet text,
  target_withdraw_recipient text,
  target_refund_unlock_at timestamptz,
  target_artifact_checksum text,
  target_runtime_checksum text,
  target_immutable_references jsonb,
  target_idempotency_key uuid,
  target_fee_quote_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare deployment_row public.escrow_contracts%rowtype; program_deadline timestamptz;
begin
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(target_program_id::text || ':5042002', 0));
  select deadline into program_deadline from public.programs where id=target_program_id and owner_id=actor_id for update;
  if not found then raise exception using errcode='P0002', detail='program_not_found'; end if;
  if program_deadline is null or target_refund_unlock_at <> program_deadline then raise exception using errcode='22023', detail='refund_unlock_must_equal_program_deadline'; end if;
  if not exists (select 1 from public.escrow_deployment_fee_quotes where id=target_fee_quote_id and program_id=target_program_id and status in ('paid','waived')) then
    raise exception using errcode='42501', detail='deployment_fee_payment_required';
  end if;
  select * into deployment_row from public.escrow_contracts where program_id=target_program_id and chain_id=5042002 for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
      or coalesce(deployment_row.platform_admin_wallet, deployment_row.owner_wallet) is distinct from lower(target_platform_admin_wallet)
      or deployment_row.withdraw_recipient is distinct from lower(target_withdraw_recipient)
      or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at then
      raise exception using errcode='22023', detail='escrow_deployment_parameters_locked';
    end if;
    update public.escrow_contracts set deployment_fee_quote_id=target_fee_quote_id, platform_admin_wallet=lower(target_platform_admin_wallet) where id=deployment_row.id;
  else
    insert into public.escrow_contracts (program_id,chain_id,deployment_status,program_key,contract_version,artifact_checksum,runtime_bytecode_checksum,immutable_references,token_address,token_decimals,owner_wallet,platform_admin_wallet,withdraw_recipient,refund_unlock_at,deploy_idempotency_key,deployment_fee_quote_id)
    values (target_program_id,5042002,'accepted',lower(target_program_key),'1.1.0',lower(target_artifact_checksum),lower(target_runtime_checksum),target_immutable_references,'0x3600000000000000000000000000000000000000',6,lower(target_platform_admin_wallet),lower(target_platform_admin_wallet),lower(target_withdraw_recipient),target_refund_unlock_at,target_idempotency_key,target_fee_quote_id)
    returning * into deployment_row;
  end if;
  return deployment_row.id;
end $$;

revoke all on function public.create_deployment_fee_quote_atomic(uuid,uuid,uuid,bigint,text,text,numeric,timestamptz) from public,anon,authenticated;
revoke all on function public.mark_deployment_fee_paid_atomic(uuid,uuid,text,text,numeric,text,integer) from public,anon,authenticated;
revoke all on function public.create_escrow_deployment_server_atomic(uuid,uuid,text,text,text,timestamptz,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_deployment_fee_quote_atomic(uuid,uuid,uuid,bigint,text,text,numeric,timestamptz) to service_role;
grant execute on function public.mark_deployment_fee_paid_atomic(uuid,uuid,text,text,numeric,text,integer) to service_role;
grant execute on function public.create_escrow_deployment_server_atomic(uuid,uuid,text,text,text,timestamptz,text,text,jsonb,uuid,uuid) to service_role;
