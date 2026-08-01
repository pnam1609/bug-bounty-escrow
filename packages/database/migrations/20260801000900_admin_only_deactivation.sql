-- Deactivation is an admin-controller emergency action only. Program owners
-- may pause/close/extend/approve, but cannot transition a program to this
-- terminal soft-deactivated state through the owner lifecycle RPC.
create or replace function public.set_program_status_atomic(
  actor_id uuid,
  target_program_id uuid,
  next_status text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
  allowed boolean;
begin
  program_record := public.assert_program_owner(actor_id, target_program_id);

  allowed := case program_record.status
    when 'draft' then next_status in ('awaiting_funding', 'closed')
    when 'awaiting_funding' then next_status in ('active', 'closed')
    when 'active' then next_status in ('paused', 'expired', 'closed')
    when 'paused' then next_status in ('active', 'expired', 'closed')
    else false
  end;

  if not allowed then
    perform public.reject_business('invalid_program_transition');
  end if;

  if next_status = 'active' then
    return public.publish_program_atomic(actor_id, target_program_id);
  end if;

  update public.programs
  set status = next_status,
      closed_at = case when next_status = 'closed' then now() else closed_at end
  where id = target_program_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    actor_id, 'user', 'program.status_changed', 'program', target_program_id::text,
    jsonb_build_object('from', program_record.status, 'to', next_status)
  );

  return target_program_id;
end;
$$;

revoke all on function public.set_program_status_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_program_status_atomic(uuid, uuid, text) to service_role;

