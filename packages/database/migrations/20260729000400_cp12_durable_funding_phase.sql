-- CP-12: persist the owner-facing pre-destination handoff.
--
-- `funding_intents.status = ready_to_sign` is intentionally reused while a Unified Balance
-- intent is still collecting deposits and after its second Submit has handed off to CP-12.  A
-- browser-only flag therefore cannot restore the correct screen after reload.  This phase is the
-- durable discriminator; settlement status remains the authority for transaction recovery.

alter table public.funding_intents
  add column funding_phase text;

update public.funding_intents intent
set funding_phase = case
  when intent.route_mode = 'unified_balance'
   and intent.destination_transaction_hash is null
   and not exists (
     select 1
     from public.funding_operations operation
     where operation.funding_intent_id = intent.id
       and operation.operation_type in ('send', 'bridge', 'spend')
   )
  then 'collecting_deposits'
  else 'ready_for_destination'
end;

alter table public.funding_intents
  alter column funding_phase set default 'ready_for_destination',
  alter column funding_phase set not null,
  add constraint funding_intents_funding_phase_check
    check (funding_phase in ('collecting_deposits', 'ready_for_destination')),
  add constraint funding_intents_route_phase_check
    check (route_mode = 'unified_balance' or funding_phase = 'ready_for_destination');

create or replace function public.initialize_funding_intent_phase()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.funding_phase := case
    when new.route_mode = 'unified_balance' then 'collecting_deposits'
    else 'ready_for_destination'
  end;
  return new;
end $$;

create trigger funding_intents_initialize_phase
before insert on public.funding_intents
for each row execute function public.initialize_funding_intent_phase();

create or replace function public.enforce_funding_operation_phase()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare intent_phase text;
begin
  select funding_phase
  into intent_phase
  from public.funding_intents
  where id = new.funding_intent_id;

  if new.operation_type = 'deposit' and intent_phase <> 'collecting_deposits' then
    raise exception using
      errcode = '23514',
      detail = 'source_deposit_after_destination_handoff';
  end if;
  if new.operation_type in ('send', 'bridge', 'spend')
     and intent_phase <> 'ready_for_destination' then
    raise exception using
      errcode = '23514',
      detail = 'funding_destination_not_prepared';
  end if;
  return new;
end $$;

create trigger funding_operations_enforce_phase
before insert on public.funding_operations
for each row execute function public.enforce_funding_operation_phase();

create or replace function public.prepare_funding_destination_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare intent_row public.funding_intents%rowtype;
begin
  if not exists (
    select 1
    from public.programs program
    where program.id = target_program_id
      and program.owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;

  select *
  into intent_row
  from public.funding_intents
  where id = target_intent_id
    and program_id = target_program_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  if intent_row.route_mode <> 'unified_balance' then
    raise exception using errcode = '22023', detail = 'funding_destination_handoff_requires_unified_balance';
  end if;
  if intent_row.funding_phase = 'ready_for_destination' then
    return false;
  end if;
  if intent_row.status not in ('ready_to_sign', 'awaiting_signature')
     or intent_row.destination_transaction_hash is not null
     or exists (
       select 1
       from public.funding_operations operation
       where operation.funding_intent_id = target_intent_id
         and operation.operation_type in ('send', 'bridge', 'spend')
     )
  then
    raise exception using errcode = '22023', detail = 'funding_destination_handoff_not_allowed';
  end if;
  if intent_row.quote_expires_at is null or intent_row.quote_expires_at <= now() then
    raise exception using errcode = '22023', detail = 'funding_quote_expired';
  end if;

  update public.funding_intents
  set funding_phase = 'ready_for_destination',
      updated_at = now()
  where id = target_intent_id;
  return true;
end $$;

revoke all on function public.prepare_funding_destination_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_funding_destination_atomic(uuid, uuid, uuid)
  to service_role;
