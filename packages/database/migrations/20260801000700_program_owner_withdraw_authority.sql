-- BountyEscrowAdmin owns support operations, while each program owner remains
-- the sole authority able to withdraw that program's residual pool.
-- Keep the original RPC for already deployed clients; this overload binds the
-- immutable program owner and prevents the admin controller from becoming a
-- program withdrawal recipient.
create or replace function public.create_escrow_deployment_server_atomic(
  actor_id uuid,
  target_program_id uuid,
  target_program_key text,
  target_platform_admin_wallet text,
  target_program_owner_wallet text,
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
  if target_program_owner_wallet !~ '^0x[0-9a-fA-F]{40}$' or lower(target_program_owner_wallet) = '0x0000000000000000000000000000000000000000' then
    raise exception using errcode='22023', detail='program_owner_wallet_required';
  end if;
  if target_withdraw_recipient is distinct from lower(target_program_owner_wallet) then
    raise exception using errcode='22023', detail='withdraw_recipient_must_equal_program_owner';
  end if;
  if not exists (select 1 from public.escrow_deployment_fee_quotes where id=target_fee_quote_id and program_id=target_program_id and status in ('paid','waived')) then
    raise exception using errcode='42501', detail='deployment_fee_payment_required';
  end if;
  select * into deployment_row from public.escrow_contracts where program_id=target_program_id and chain_id=5042002 for update;
  if found then
    if deployment_row.program_key is distinct from lower(target_program_key)
      or coalesce(deployment_row.platform_admin_wallet, '') is distinct from lower(target_platform_admin_wallet)
      or coalesce(deployment_row.owner_wallet, '') is distinct from lower(target_program_owner_wallet)
      or deployment_row.withdraw_recipient is distinct from lower(target_withdraw_recipient)
      or deployment_row.refund_unlock_at is distinct from target_refund_unlock_at then
      raise exception using errcode='22023', detail='escrow_deployment_parameters_locked';
    end if;
    update public.escrow_contracts set deployment_fee_quote_id=target_fee_quote_id,
      platform_admin_wallet=lower(target_platform_admin_wallet), owner_wallet=lower(target_program_owner_wallet),
      withdraw_recipient=lower(target_withdraw_recipient) where id=deployment_row.id;
  else
    insert into public.escrow_contracts (program_id,chain_id,deployment_status,program_key,contract_version,artifact_checksum,runtime_bytecode_checksum,immutable_references,token_address,token_decimals,owner_wallet,platform_admin_wallet,withdraw_recipient,refund_unlock_at,deploy_idempotency_key,deployment_fee_quote_id)
    values (target_program_id,5042002,'accepted',lower(target_program_key),'1.1.0',lower(target_artifact_checksum),lower(target_runtime_checksum),target_immutable_references,'0x3600000000000000000000000000000000000000',6,lower(target_program_owner_wallet),lower(target_platform_admin_wallet),lower(target_withdraw_recipient),target_refund_unlock_at,target_idempotency_key,target_fee_quote_id)
    returning * into deployment_row;
  end if;
  return deployment_row.id;
end $$;

revoke all on function public.create_escrow_deployment_server_atomic(uuid,uuid,text,text,text,text,timestamptz,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_escrow_deployment_server_atomic(uuid,uuid,text,text,text,text,timestamptz,text,text,jsonb,uuid,uuid) to service_role;
