-- Program lifecycle, escrow settlement, reviewer assignment, disclosure and notification RPCs.
--
-- Money only ever moves through the functions in this file. programs.total_pool,
-- reserved_pool and paid_pool are not writable by the `authenticated` role (see RLS-002), so
-- these SECURITY DEFINER functions are the single accounting path.

create or replace function public.assert_program_owner(actor_id uuid, target_program_id uuid)
returns public.programs
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
begin
  select * into program_record
  from public.programs
  where id = target_program_id
  for update;

  if not found or program_record.owner_id <> actor_id then
    perform public.reject_forbidden('program_not_accessible');
  end if;

  return program_record;
end;
$$;

------------------------------------------------------------------------------ escrow deployment

create or replace function public.record_program_escrow_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_chain_id bigint,
  deployment_hash text,
  deployed_contract_address text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
  escrow_id uuid;
begin
  program_record := public.assert_program_owner(actor_id, target_program_id);

  if program_record.status not in ('draft', 'awaiting_funding') then
    perform public.reject_business('invalid_program_transition');
  end if;

  if exists (
    select 1 from public.escrow_contracts
    where program_id = target_program_id
      and chain_id = target_chain_id
      and deployment_status <> 'failed'
  ) then
    perform public.reject_business('program_escrow_already_deployed');
  end if;

  -- Coverage must hold before an owner commits real funds to the program.
  perform public.assert_program_coverage(target_program_id);

  insert into public.escrow_contracts (
    program_id,
    chain_id,
    contract_address,
    deployment_transaction_hash,
    deployment_status,
    deployed_at
  )
  values (
    target_program_id,
    target_chain_id,
    lower(deployed_contract_address),
    lower(deployment_hash),
    'confirmed',
    now()
  )
  returning id into escrow_id;

  update public.programs
  set
    contract_address = lower(deployed_contract_address),
    status = 'awaiting_funding'
  where id = target_program_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.escrow_deployed', 'program', target_program_id::text,
    jsonb_build_object('chainId', target_chain_id, 'escrowId', escrow_id)
  );

  return escrow_id;
end;
$$;

------------------------------------------------------------------------------ funding

create or replace function public.fund_program_escrow_atomic(
  actor_id uuid,
  target_program_id uuid,
  funding_amount numeric,
  funding_transaction_hash text,
  funding_token_address text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
  escrow_record public.escrow_contracts;
  transaction_id uuid;
begin
  program_record := public.assert_program_owner(actor_id, target_program_id);

  if funding_amount is null or funding_amount <= 0 then
    perform public.reject_business('funding_amount_invalid');
  end if;

  select * into escrow_record
  from public.escrow_contracts
  where program_id = target_program_id
    and deployment_status = 'confirmed'
  order by created_at desc
  limit 1;

  if not found then
    perform public.reject_business('program_escrow_not_deployed');
  end if;

  if program_record.status in ('closed', 'expired') then
    perform public.reject_business('invalid_program_transition');
  end if;

  insert into public.escrow_transactions (
    program_id,
    escrow_contract_id,
    chain_id,
    transaction_hash,
    transaction_type,
    status,
    token_address,
    amount,
    block_number,
    block_hash,
    confirmations,
    confirmed_at
  )
  values (
    target_program_id,
    escrow_record.id,
    escrow_record.chain_id,
    lower(funding_transaction_hash),
    'funding',
    'confirmed',
    lower(funding_token_address),
    funding_amount,
    0,
    lower(funding_transaction_hash),
    1,
    now()
  )
  returning id into transaction_id;

  update public.programs
  set total_pool = total_pool + funding_amount
  where id = target_program_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.funded', 'program', target_program_id::text,
    jsonb_build_object('amount', funding_amount::text, 'transactionId', transaction_id)
  );

  return transaction_id;
end;
$$;

------------------------------------------------------------------------------ publish / pause / close

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

  if program_record.contract_address is null then
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

create or replace function public.set_program_status_atomic(
  actor_id uuid,
  target_program_id uuid,
  next_status text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  program_record public.programs;
  allowed boolean;
begin
  program_record := public.assert_program_owner(actor_id, target_program_id);

  -- Mirrors PROGRAM_STATUS_TRANSITIONS in packages/domain.
  allowed := case program_record.status
    when 'draft' then next_status in ('awaiting_funding', 'closed')
    when 'awaiting_funding' then next_status in ('active', 'closed')
    when 'active' then next_status in ('paused', 'expired', 'closed')
    when 'paused' then next_status in ('active', 'expired', 'closed')
    when 'expired' then next_status = 'closed'
    else false
  end;

  if not allowed then
    perform public.reject_business('invalid_program_transition');
  end if;

  if next_status = 'active' then
    return public.publish_program_atomic(actor_id, target_program_id);
  end if;

  update public.programs
  set
    status = next_status,
    closed_at = case when next_status = 'closed' then now() else closed_at end
  where id = target_program_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.status_changed', 'program', target_program_id::text,
    jsonb_build_object('from', program_record.status, 'to', next_status)
  );

  return target_program_id;
end;
$$;

------------------------------------------------------------------------------ payout

-- Moves an approved reward from reserved_pool to paid_pool. Split into start/confirm so the
-- on-chain transaction can be recorded as pending before it settles.
create or replace function public.start_report_payment_atomic(
  actor_id uuid,
  target_report_id uuid,
  payment_transaction_hash text,
  payment_token_address text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  escrow_record public.escrow_contracts;
  transaction_id uuid;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status <> 'reward_approved' then
    perform public.reject_business('invalid_report_transition');
  end if;

  select * into escrow_record
  from public.escrow_contracts
  where program_id = report_record.program_id
    and deployment_status = 'confirmed'
  order by created_at desc
  limit 1;

  if not found then
    perform public.reject_business('program_escrow_not_deployed');
  end if;

  insert into public.escrow_transactions (
    program_id,
    report_id,
    escrow_contract_id,
    chain_id,
    transaction_hash,
    transaction_type,
    status,
    token_address,
    amount
  )
  values (
    report_record.program_id,
    target_report_id,
    escrow_record.id,
    escrow_record.chain_id,
    lower(payment_transaction_hash),
    'payout',
    'pending',
    lower(payment_token_address),
    report_record.approved_reward
  )
  returning id into transaction_id;

  update public.reports set status = 'payment_pending' where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  )
  values (
    target_report_id, actor_id, 'start_payment', 'reward_approved', 'payment_pending',
    jsonb_build_object('transactionId', transaction_id)
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'payment_pending',
    jsonb_build_object('reportId', target_report_id)
  );

  return transaction_id;
end;
$$;

create or replace function public.confirm_report_payment_atomic(
  actor_id uuid,
  target_report_id uuid,
  settled_block_number bigint,
  settled_block_hash text,
  settled_confirmations integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  transaction_record public.escrow_transactions;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found
    or not public.actor_can_review_program(actor_id, report_record.program_id)
  then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if report_record.status <> 'payment_pending' then
    perform public.reject_business('invalid_report_transition');
  end if;

  select * into transaction_record
  from public.escrow_transactions
  where report_id = target_report_id
    and transaction_type = 'payout'
    and status = 'pending'
  order by created_at desc
  limit 1
  for update;

  if not found then
    perform public.reject_business('invalid_report_transition');
  end if;

  -- Lock the program before shifting the pool so concurrent settlements serialize.
  perform 1 from public.programs where id = report_record.program_id for update;

  update public.escrow_transactions
  set
    status = 'confirmed',
    block_number = settled_block_number,
    block_hash = lower(settled_block_hash),
    confirmations = greatest(settled_confirmations, 1),
    confirmed_at = now()
  where id = transaction_record.id;

  update public.programs
  set
    reserved_pool = reserved_pool - transaction_record.amount,
    paid_pool = paid_pool + transaction_record.amount,
    paid_report_count = paid_report_count + 1
  where id = report_record.program_id;

  update public.reports
  set status = 'paid', paid_at = now()
  where id = target_report_id;

  insert into public.report_reviews (
    report_id, reviewer_id, action, from_status, to_status, metadata
  )
  values (
    target_report_id, actor_id, 'confirm_payment', 'payment_pending', 'paid',
    jsonb_build_object('transactionId', transaction_record.id)
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    report_record.researcher_id,
    'payment_confirmed',
    jsonb_build_object('reportId', target_report_id, 'amount', transaction_record.amount::text)
  );

  return transaction_record.id;
end;
$$;

------------------------------------------------------------------------------ reviewer assignment

-- Reviewer access is granted per program by the owner; it is never self-assignable.
create or replace function public.assign_program_reviewer_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_reviewer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_program_owner(actor_id, target_program_id);

  if not exists (
    select 1 from public.profiles
    where id = target_reviewer_id and role in ('reviewer', 'owner')
  ) then
    perform public.reject_business('reviewer_role_required');
  end if;

  insert into public.program_reviewers (program_id, reviewer_id, assigned_by)
  values (target_program_id, target_reviewer_id, actor_id)
  on conflict (program_id, reviewer_id) do nothing;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.reviewer_assigned', 'program', target_program_id::text,
    jsonb_build_object('reviewerId', target_reviewer_id)
  );

  return target_reviewer_id;
end;
$$;

create or replace function public.remove_program_reviewer_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_reviewer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.assert_program_owner(actor_id, target_program_id);

  delete from public.program_reviewers
  where program_id = target_program_id and reviewer_id = target_reviewer_id;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.reviewer_removed', 'program', target_program_id::text,
    jsonb_build_object('reviewerId', target_reviewer_id)
  );

  return target_reviewer_id;
end;
$$;

------------------------------------------------------------------------------ disclosure

-- A resolved report becomes a public "known issue" only through an explicit owner decision,
-- taken after the program has ended, using public-safe text the owner writes themselves.
create or replace function public.decide_report_disclosure_atomic(
  actor_id uuid,
  target_report_id uuid,
  decision text,
  disclosure_title text,
  disclosure_summary text,
  disclosure_content text,
  disclosure_severity text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  disclosure_id uuid;
  publish_moment timestamp with time zone;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;

  if not found then
    perform public.reject_missing('report_not_accessible');
  end if;

  select * into program_record from public.programs where id = report_record.program_id;

  if program_record.owner_id <> actor_id then
    perform public.reject_forbidden('report_not_accessible');
  end if;

  if program_record.status not in ('expired', 'closed') then
    perform public.reject_business('disclosure_not_allowed_yet');
  end if;

  if report_record.status not in ('rejected', 'duplicate', 'validated', 'reward_approved', 'paid')
  then
    perform public.reject_business('disclosure_not_allowed_yet');
  end if;

  publish_moment := case when decision = 'keep_private' then null else now() end;

  insert into public.report_disclosures (
    report_id, program_id, decision, decided_by,
    public_title, public_summary, public_content, public_severity, published_at
  )
  values (
    target_report_id,
    report_record.program_id,
    decision,
    actor_id,
    case when decision = 'keep_private' then null else disclosure_title end,
    case when decision = 'keep_private' then null else disclosure_summary end,
    case when decision = 'publish_full' then disclosure_content else null end,
    case when decision = 'keep_private' then null else disclosure_severity end,
    publish_moment
  )
  on conflict (report_id) do update
  set
    decision = excluded.decision,
    decided_by = excluded.decided_by,
    decided_at = now(),
    public_title = excluded.public_title,
    public_summary = excluded.public_summary,
    public_content = excluded.public_content,
    public_severity = excluded.public_severity,
    published_at = excluded.published_at
  returning id into disclosure_id;

  if decision <> 'keep_private' then
    insert into public.notifications (recipient_id, type, metadata)
    values (
      report_record.researcher_id,
      'disclosure_published',
      jsonb_build_object('reportId', target_report_id)
    );
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'report.disclosure_decided', 'report', target_report_id::text,
    jsonb_build_object('decision', decision)
  );

  return disclosure_id;
end;
$$;

------------------------------------------------------------------------------ profile

-- Account settings. Only the display name may change after onboarding: the role decides what a
-- person can reach, so letting it be edited here would be a privilege escalation path, and
-- complete_profile_onboarding_for_user deliberately rejects any post-onboarding change.
create or replace function public.update_profile_display_name_atomic(
  actor_id uuid,
  new_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  trimmed text := btrim(new_display_name);
begin
  if length(trimmed) not between 1 and 120 then
    perform public.reject_business('display_name_invalid');
  end if;

  update public.profiles
  set display_name = trimmed
  where id = actor_id;

  if not found then
    perform public.reject_missing('profile_not_found');
  end if;

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'profile.display_name_changed', 'profile', actor_id::text, '{}'::jsonb
  );

  return actor_id;
end;
$$;

------------------------------------------------------------------------------ notifications

create or replace function public.mark_notifications_read_atomic(
  actor_id uuid,
  notification_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer;
begin
  update public.notifications
  set read_at = now()
  where recipient_id = actor_id
    and read_at is null
    and (notification_ids is null or id = any (notification_ids));

  get diagnostics affected = row_count;

  return affected;
end;
$$;

------------------------------------------------------------------------------ grants

revoke all on function public.assert_program_owner(uuid, uuid) from public;
revoke all on function public.record_program_escrow_atomic(
  uuid, uuid, bigint, text, text
) from public;
revoke all on function public.fund_program_escrow_atomic(
  uuid, uuid, numeric, text, text
) from public;
revoke all on function public.publish_program_atomic(uuid, uuid) from public;
revoke all on function public.set_program_status_atomic(uuid, uuid, text) from public;
revoke all on function public.start_report_payment_atomic(uuid, uuid, text, text) from public;
revoke all on function public.confirm_report_payment_atomic(
  uuid, uuid, bigint, text, integer
) from public;
revoke all on function public.assign_program_reviewer_atomic(uuid, uuid, uuid) from public;
revoke all on function public.remove_program_reviewer_atomic(uuid, uuid, uuid) from public;
revoke all on function public.decide_report_disclosure_atomic(
  uuid, uuid, text, text, text, text, text
) from public;
revoke all on function public.update_profile_display_name_atomic(uuid, text) from public;
revoke all on function public.mark_notifications_read_atomic(uuid, uuid[]) from public;

grant execute on function public.record_program_escrow_atomic(
  uuid, uuid, bigint, text, text
) to service_role;
grant execute on function public.fund_program_escrow_atomic(
  uuid, uuid, numeric, text, text
) to service_role;
grant execute on function public.publish_program_atomic(uuid, uuid) to service_role;
grant execute on function public.set_program_status_atomic(uuid, uuid, text) to service_role;
grant execute on function public.start_report_payment_atomic(
  uuid, uuid, text, text
) to service_role;
grant execute on function public.confirm_report_payment_atomic(
  uuid, uuid, bigint, text, integer
) to service_role;
grant execute on function public.assign_program_reviewer_atomic(uuid, uuid, uuid) to service_role;
grant execute on function public.remove_program_reviewer_atomic(uuid, uuid, uuid) to service_role;
grant execute on function public.decide_report_disclosure_atomic(
  uuid, uuid, text, text, text, text, text
) to service_role;
grant execute on function public.update_profile_display_name_atomic(
  uuid, text
) to service_role;
grant execute on function public.mark_notifications_read_atomic(uuid, uuid[]) to service_role;
