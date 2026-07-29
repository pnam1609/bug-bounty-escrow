-- CP-14 defense in depth: runtime roles read funding operations while all recovery mutations flow
-- through SECURITY DEFINER RPCs, and Spend source evidence preserves a one-hash/one-network map.

revoke insert, update, delete, truncate, references, trigger
on table public.funding_operations from service_role;
grant select on table public.funding_operations to service_role;

create or replace function public.normalize_funding_destination_terminal_step()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.operation_type in ('send','bridge','spend')
     and new.transaction_hash is not null
     and jsonb_typeof(new.steps) = 'array'
  then
    select coalesce(jsonb_agg(
      case
        when lower(coalesce(step.value->>'transactionHash', '')) = lower(new.transaction_hash)
          and (
            (
              lower(coalesce(step.value->>'name', '')) = 'mint'
              and step.value->>'state' = 'success'
            )
            or (
              lower(coalesce(step.value->>'name', '')) = 'destination'
              and new.status = 'failed'
              and step.value->>'state' = 'error'
              and step.value->>'errorCode' = 'server.funding_destination_reverted'
            )
          )
        then step.value - 'transactionHash'
        else step.value
      end
      order by step.ordinal
    ), '[]'::jsonb)
    into new.steps
    from jsonb_array_elements(new.steps) with ordinality step(value, ordinal);
  end if;
  return new;
end $$;

create trigger funding_operations_normalize_destination_terminal_step
before insert or update of steps, transaction_hash on public.funding_operations
for each row execute function public.normalize_funding_destination_terminal_step();

-- Fire the deterministic normalizer before validating the new forward-deployment constraints.
update public.funding_operations
set steps = steps
where operation_type in ('send','bridge','spend');

update public.funding_operations
set failure_code = 'server.source_deposit_reverted',
    updated_at = now()
where operation_type = 'deposit'
  and status = 'failed'
  and failure_code = 'server.funding_destination_reverted'
  and transaction_hash is not null;

create or replace function public.funding_operation_recovery_buckets_are_valid(
  destination_hash text,
  candidate_steps jsonb,
  unbound_hashes jsonb
) returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(candidate_steps) = 'array'
    and jsonb_typeof(unbound_hashes) = 'array'
    and not exists (
      select 1 from jsonb_array_elements_text(unbound_hashes) hash(value)
      where hash.value !~ '^0x[0-9a-f]{64}$'
    )
    and (
      select count(distinct lower(value))
      from jsonb_array_elements_text(unbound_hashes) hash(value)
    ) = jsonb_array_length(unbound_hashes)
    and not exists (
      select 1 from jsonb_array_elements(candidate_steps) step
      where step->>'transactionHash' is not null
        and step->>'transactionHash' !~ '^0x[0-9a-f]{64}$'
    )
    and not exists (
      select 1 from jsonb_array_elements(candidate_steps) step
      where step->>'transactionHash' is not null
        and (
          lower(step->>'transactionHash') = lower(destination_hash)
          or exists (
            select 1 from jsonb_array_elements_text(unbound_hashes) hash(value)
            where lower(hash.value) = lower(step->>'transactionHash')
          )
        )
    )
    and not exists (
      select 1 from jsonb_array_elements_text(unbound_hashes) hash(value)
      where lower(hash.value) = lower(destination_hash)
    )
    and (
      (case when destination_hash is null then 0 else 1 end)
      + (
        select count(distinct coalesce(
          'tx:' || lower(nullif(step->>'transactionHash', '')),
          'name:' || lower(nullif(step->>'name', ''))
        ))
        from jsonb_array_elements(candidate_steps) step
      )
      + jsonb_array_length(unbound_hashes)
    ) <= 33
$$;

revoke all on function public.funding_operation_recovery_buckets_are_valid(text,jsonb,jsonb)
from public, anon, authenticated, service_role;

alter table public.funding_operations
  add constraint funding_operations_recovery_buckets_check
  check (
    public.funding_operation_steps_have_unique_identities(steps)
    and public.funding_operation_recovery_buckets_are_valid(
      transaction_hash, steps, unbound_transaction_hashes
    )
  ) not valid;

alter table public.funding_operations
  validate constraint funding_operations_recovery_buckets_check;

-- Release-A compatibility accepted both a detailed source step and the same hash in the source
-- hash list. Canonicalize that redundant input before the legacy body; no evidence is discarded.
alter function public.observe_funding_operation_atomic(
  uuid,text,text,text,jsonb,text,boolean,boolean,jsonb
) rename to observe_funding_operation_atomic_cp14_internal;

revoke all on function public.observe_funding_operation_atomic_cp14_internal(
  uuid,text,text,text,jsonb,text,boolean,boolean,jsonb
) from public, anon, authenticated, service_role;

create function public.observe_funding_operation_atomic(
  target_intent_id uuid,
  observed_operation_id text,
  observed_destination_hash text,
  observed_transfer_id text,
  observed_source_hashes jsonb,
  observed_provider_state text,
  observed_retryable boolean,
  observed_submission_uncertain boolean,
  observed_steps jsonb
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare canonical_source_hashes jsonb;
begin
  if jsonb_typeof(coalesce(observed_source_hashes, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(observed_steps, '[]'::jsonb)) <> 'array'
  then
    raise exception using errcode = '22023', detail = 'funding_operation_observation_invalid';
  end if;
  select coalesce(jsonb_agg(hash.value order by hash.ordinal), '[]'::jsonb)
  into canonical_source_hashes
  from jsonb_array_elements_text(coalesce(observed_source_hashes, '[]'::jsonb))
    with ordinality hash(value, ordinal)
  where not exists (
    select 1 from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
    where lower(coalesce(step->>'transactionHash', '')) = lower(hash.value)
  );
  return public.observe_funding_operation_atomic_cp14_internal(
    target_intent_id, observed_operation_id, observed_destination_hash,
    observed_transfer_id, canonical_source_hashes, observed_provider_state,
    observed_retryable, observed_submission_uncertain,
    coalesce(observed_steps, '[]'::jsonb)
  );
end $$;

revoke all on function public.observe_funding_operation_atomic(
  uuid,text,text,text,jsonb,text,boolean,boolean,jsonb
) from public, anon, authenticated;
grant execute on function public.observe_funding_operation_atomic(
  uuid,text,text,text,jsonb,text,boolean,boolean,jsonb
) to service_role;

alter function public.attach_funding_recovery_telemetry_atomic(
  uuid,uuid,uuid,uuid,text,boolean,jsonb,jsonb,jsonb
) rename to attach_funding_recovery_telemetry_atomic_cp14_mapping_internal;

revoke all on function public.attach_funding_recovery_telemetry_atomic_cp14_mapping_internal(
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

  if operation_row.operation_type = 'spend'
     and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) = 0
     and exists (
       select 1 from jsonb_array_elements(coalesce(observed_steps, '[]'::jsonb)) step
       where step->>'network' is not null and step->>'transactionHash' is not null
     )
  then
    raise exception using errcode = '23514', detail = 'funding_spend_source_mapping_invalid';
  end if;

  if operation_row.operation_type = 'spend'
     and jsonb_array_length(coalesce(observed_source_hashes, '[]'::jsonb)) > 0
     and (
       jsonb_array_length(observed_source_hashes)
         <> jsonb_array_length(coalesce(observed_steps, '[]'::jsonb))
       or (
         select count(distinct step->>'network')
         from jsonb_array_elements(observed_steps) step
       ) <> jsonb_array_length(observed_steps)
       or (
         select count(distinct lower(step->>'transactionHash'))
         from jsonb_array_elements(observed_steps) step
       ) <> jsonb_array_length(observed_steps)
       or exists (
         select 1 from jsonb_array_elements(observed_steps) step
         where step->>'network' is null
            or step->>'state' <> 'success'
            or not exists (
              select 1 from jsonb_array_elements(intent_row.sources) source
              where source->>'network' = step->>'network'
            )
            or not exists (
              select 1 from jsonb_array_elements_text(observed_source_hashes) hash(value)
              where lower(hash.value) = lower(coalesce(step->>'transactionHash', ''))
            )
       )
       or exists (
         select 1 from jsonb_array_elements_text(observed_source_hashes) hash(value)
         where (
           select count(*) from jsonb_array_elements(observed_steps) step
           where lower(coalesce(step->>'transactionHash', '')) = lower(hash.value)
         ) <> 1
       )
     )
  then
    raise exception using errcode = '23514', detail = 'funding_spend_source_mapping_invalid';
  end if;

  return public.attach_funding_recovery_telemetry_atomic_cp14_mapping_internal(
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
