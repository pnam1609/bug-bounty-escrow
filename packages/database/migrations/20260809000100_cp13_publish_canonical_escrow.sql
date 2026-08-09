-- CP-13: publish against the canonical escrow deployment projection.
--
-- `programs.contract_address` is a legacy denormalized field. Confirmed
-- deployments are authoritative in `escrow_contracts`; funding and the owner
-- readiness screen already use that projection. Publishing must use the same
-- source or a successfully funded program can be shown as ready while the
-- publish RPC rejects it as undeployed.

create or replace function public.publish_program_atomic(
  actor_id uuid,
  target_program_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
begin
  program_record := public.assert_program_owner(actor_id, target_program_id);

  if program_record.status not in ('draft', 'awaiting_funding', 'paused') then
    perform public.reject_business('invalid_program_transition');
  end if;

  perform public.assert_program_coverage(target_program_id);

  if program_record.reward_policy is null
    or length(btrim(program_record.reward_policy)) = 0
  then
    perform public.reject_business('program_not_ready_to_publish');
  end if;

  if not exists (
    select 1
    from public.escrow_contracts escrow
    where escrow.program_id = target_program_id
      and escrow.chain_id = 5042002
      and escrow.deployment_status = 'confirmed'
      and escrow.contract_address is not null
  ) then
    perform public.reject_business('program_escrow_not_deployed');
  end if;

  if program_record.deadline is null or program_record.deadline <= now() then
    perform public.reject_business('program_deadline_invalid');
  end if;

  -- A published program promises a funded reward pool; publishing an empty one is misleading.
  if program_record.available_pool <= 0 then
    perform public.reject_business('program_not_ready_to_publish');
  end if;

  update public.programs
  set
    status = 'active',
    published_at = coalesce(published_at, now())
  where id = target_program_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.published', 'program', target_program_id::text, '{}'::jsonb
  );

  return target_program_id;
end;
$$;
