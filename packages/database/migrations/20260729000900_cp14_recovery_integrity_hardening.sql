-- CP-14 follow-up: keep recovery evidence immutable outside SECURITY DEFINER RPCs, preserve
-- source/destination classification, and reject ambiguous step identities at the table boundary.

create or replace function public.funding_operation_steps_have_unique_identities(candidate jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(candidate) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(candidate) step
      group by coalesce(
        'tx:' || lower(nullif(step->>'transactionHash', '')),
        'name:' || lower(nullif(step->>'name', ''))
      )
      having coalesce(
        'tx:' || lower(nullif(step->>'transactionHash', '')),
        'name:' || lower(nullif(step->>'name', ''))
      ) is null
         or count(*) > 1
    )
$$;

revoke all on function public.funding_operation_steps_have_unique_identities(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.funding_operation_recovery_identity_count(
  destination_hash text,
  candidate_steps jsonb,
  unbound_hashes jsonb
) returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select count(*)::integer
  from (
    select 'tx:' || lower(destination_hash) identity
    where destination_hash is not null
    union
    select coalesce(
      'tx:' || lower(nullif(step->>'transactionHash', '')),
      'name:' || lower(nullif(step->>'name', ''))
    )
    from jsonb_array_elements(candidate_steps) step
    union
    select 'tx:' || lower(value)
    from jsonb_array_elements_text(unbound_hashes) hash(value)
  ) identities
$$;

revoke all on function public.funding_operation_recovery_identity_count(text,jsonb,jsonb)
from public, anon, authenticated, service_role;

alter table public.funding_operations
  add constraint funding_operations_recovery_identity_limit_check
  check (
    public.funding_operation_recovery_identity_count(
      transaction_hash, steps, unbound_transaction_hashes
    ) <= 33
  ) not valid;

alter table public.funding_operations
  validate constraint funding_operations_recovery_identity_limit_check;

create or replace function public.correct_source_deposit_recovery_failure_code()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.operation_type = 'deposit'
     and new.failure_code = 'server.funding_destination_reverted'
  then
    new.failure_code := 'server.source_deposit_reverted';
  end if;
  return new;
end $$;

create trigger funding_operations_correct_source_revert_code
before insert or update of failure_code on public.funding_operations
for each row execute function public.correct_source_deposit_recovery_failure_code();

-- Recovery checks are append/monotonic through record_funding_recovery_poll_atomic only. The
-- application may read them, but no runtime role may bypass classification by mutating the child.
revoke all on table public.funding_operation_recovery_checks from service_role;
grant select on table public.funding_operation_recovery_checks to service_role;

-- Preserve the already-reviewed merge implementation behind a non-executable internal name, then
-- wrap it with Spend-specific source/network binding. Bridge continues using its locked source.
alter function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) rename to attach_funding_recovery_telemetry_atomic_cp14_internal;

revoke all on function public.attach_funding_recovery_telemetry_atomic_cp14_internal(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) from public, anon, authenticated, service_role;

create function public.attach_funding_recovery_telemetry_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_intent_id uuid,
  target_operation_id uuid,
  observed_provider_state text,
  observed_retryable boolean,
  observed_source_hashes jsonb,
  observed_unbound_hashes jsonb,
  observed_steps jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  intent_row public.funding_intents%rowtype;
  operation_row public.funding_operations%rowtype;
  attached boolean;
begin
  if actor_id is null or target_program_id is null or target_intent_id is null
     or target_operation_id is null
     or jsonb_typeof(coalesce(observed_source_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_unbound_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_steps, '[]'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023', detail = 'funding_recovery_telemetry_invalid';
  end if;

  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_intent_id::text || ':destination', 0)
  );
  if not exists (
    select 1 from public.programs
    where id = target_program_id and owner_id = actor_id
  ) then
    raise exception using errcode = 'P0002', detail = 'program_not_found';
  end if;
  select * into intent_row from public.funding_intents
  where id = target_intent_id and program_id = target_program_id for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_intent_not_found';
  end if;
  select * into operation_row from public.funding_operations
  where id = target_operation_id and funding_intent_id = target_intent_id
    and operation_type in ('bridge','spend') for update;
  if not found then
    raise exception using errcode = 'P0002', detail = 'funding_operation_not_found';
  end if;

  if not public.funding_operation_steps_have_unique_identities(
       coalesce(observed_steps, '[]'::jsonb)
     )
     or exists (
       select 1 from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
       where step->>'transactionHash' is not null
         and lower(step->>'transactionHash') !~ '^0x[0-9a-f]{64}$'
     )
  then
    raise exception using errcode = '22023', detail = 'funding_recovery_step_identity_duplicate';
  end if;

  if operation_row.operation_type = 'spend'
     and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0
  then
    if (
      select count(distinct lower(hash.value))
      from jsonb_array_elements_text(observed_source_hashes) hash(value)
    ) <> jsonb_array_length(observed_source_hashes)
       or exists (
         select 1 from jsonb_array_elements_text(observed_source_hashes) hash(value)
         where hash.value !~ '^0x[0-9a-fA-F]{64}$'
            or lower(hash.value) = operation_row.transaction_hash
            or (
              select count(*)
              from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
              where lower(coalesce(step->>'transactionHash', '')) = lower(hash.value)
                and step->>'state' = 'success'
                and exists (
                  select 1 from jsonb_array_elements(intent_row.sources) source
                  where source->>'network' = step->>'network'
                )
            ) <> 1
       )
       or exists (
         select 1 from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
         where step->>'network' is not null
           and (
             step->>'state' <> 'success'
             or not exists (
               select 1 from jsonb_array_elements(intent_row.sources) source
               where source->>'network' = step->>'network'
             )
             or not exists (
               select 1 from jsonb_array_elements_text(observed_source_hashes) hash(value)
               where lower(hash.value) = lower(coalesce(step->>'transactionHash', ''))
             )
           )
       )
    then
      raise exception using errcode = '23514', detail = 'funding_spend_source_mapping_invalid';
    end if;

    attached := public.attach_funding_recovery_telemetry_atomic_cp14_internal(
      actor_id, target_program_id, target_intent_id, target_operation_id,
      observed_provider_state, observed_retryable, '[]'::jsonb,
      coalesce(observed_unbound_hashes, '[]'::jsonb),
      coalesce(observed_steps, '[]'::jsonb)
    );
    update public.funding_operations
    set status = case when status = 'submission_uncertain' then 'pending' else status end,
        submission_uncertain = false,
        updated_at = now()
    where id = target_operation_id;
    insert into public.audit_logs (
      actor_id, actor_type, action, entity_type, entity_id, metadata
    ) values (
      actor_id, 'user', 'funding.spend_source_telemetry_bound', 'funding_operation',
      target_operation_id::text,
      jsonb_build_object(
        'fundingIntent', target_intent_id,
        'sourceHashCount', jsonb_array_length(observed_source_hashes)
      )
    );
    return attached;
  end if;

  return public.attach_funding_recovery_telemetry_atomic_cp14_internal(
    actor_id, target_program_id, target_intent_id, target_operation_id,
    observed_provider_state, observed_retryable,
    coalesce(observed_source_hashes, '[]'::jsonb),
    coalesce(observed_unbound_hashes, '[]'::jsonb),
    coalesce(observed_steps, '[]'::jsonb)
  );
end $$;

revoke all on function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) to service_role;
