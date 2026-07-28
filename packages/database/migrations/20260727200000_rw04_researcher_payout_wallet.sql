-- RW-04: researcher payout-wallet singleton.
--
-- Wallet is deliberately not part of PATCH /api/me. Reads and writes go through dedicated
-- service-role RPCs that derive the subject from the authenticated principal, require the
-- researcher role, enforce the reward lifecycle, and append a redacted audit event.

alter table public.profiles
  add column wallet_updated_at timestamp with time zone;

update public.profiles
set
  wallet_address = lower(wallet_address),
  wallet_updated_at = updated_at
where wallet_address is not null;

alter table public.profiles
  drop constraint profiles_wallet_address_format_check,
  add constraint profiles_wallet_address_format_check
    check (
      wallet_address is null
      or (
        wallet_address ~ '^0x[0-9a-f]{40}$'
        and wallet_address <> '0x0000000000000000000000000000000000000000'
      )
    ),
  add constraint profiles_wallet_timestamp_pair_check
    check ((wallet_address is null) = (wallet_updated_at is null));

comment on column public.profiles.wallet_updated_at is
  'Last payout-wallet change. The wallet remains a payout destination, never an auth identity.';

create or replace function public.researcher_payout_wallet(actor_id uuid)
returns table (
  wallet_address text,
  wallet_updated_at timestamp with time zone,
  has_active_rewards boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role text;
begin
  select profile.role
  into actor_role
  from public.profiles as profile
  where profile.id = actor_id;

  if not found then
    perform public.reject_missing('profile_not_found');
  end if;

  if actor_role <> 'researcher' then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  return query
  select
    profile.wallet_address,
    profile.wallet_updated_at,
    exists (
      select 1
      from public.reports as report
      where report.researcher_id = actor_id
        and report.status in ('reward_approved', 'payment_pending')
    )
  from public.profiles as profile
  where profile.id = actor_id;
end;
$$;

create or replace function public.set_researcher_payout_wallet(
  actor_id uuid,
  new_wallet_address text,
  confirm_active_reward_change boolean
)
returns table (
  wallet_address text,
  wallet_updated_at timestamp with time zone,
  has_active_rewards boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_role text;
  current_wallet text;
  normalized_wallet text;
  active_rewards boolean;
  changed_at timestamp with time zone := now();
begin
  normalized_wallet := lower(new_wallet_address);

  if normalized_wallet is null
    or normalized_wallet !~ '^0x[0-9a-f]{40}$'
    or normalized_wallet = '0x0000000000000000000000000000000000000000'
  then
    perform public.reject_business('wallet_address_invalid');
  end if;

  select profile.role, profile.wallet_address
  into actor_role, current_wallet
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found then
    perform public.reject_missing('profile_not_found');
  end if;

  if actor_role <> 'researcher' then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  -- Serialize with every lifecycle RPC, all of which lock the target report before changing its
  -- status. Locking the researcher's complete report set (not only rows currently active) closes
  -- the race where a validated report becomes reward_approved between the requirement check and
  -- the wallet write.
  perform report.id
  from public.reports as report
  where report.researcher_id = actor_id
  order by report.id
  for update;

  select exists (
    select 1
    from public.reports as report
    where report.researcher_id = actor_id
      and report.status in ('reward_approved', 'payment_pending')
  )
  into active_rewards;

  if current_wallet is distinct from normalized_wallet and not active_rewards then
    perform public.reject_business('payout_wallet_not_required');
  end if;

  if current_wallet is not null
    and lower(current_wallet) <> normalized_wallet
    and not confirm_active_reward_change
  then
    perform public.reject_business('wallet_change_confirmation_required');
  end if;

  if current_wallet is distinct from normalized_wallet then
    update public.profiles
    set
      wallet_address = normalized_wallet,
      wallet_updated_at = changed_at
    where id = actor_id;

    insert into public.audit_logs (
      actor_id,
      actor_type,
      action,
      entity_type,
      entity_id,
      metadata
    )
    values (
      actor_id,
      'user',
      case
        when current_wallet is null then 'profile.payout_wallet_set'
        else 'profile.payout_wallet_changed'
      end,
      'profile',
      actor_id::text,
      jsonb_build_object(
        'network', 'Arc',
        'asset', 'USDC',
        'hadPreviousDestination', current_wallet is not null,
        'activeRewardChangeConfirmed',
          current_wallet is not null and confirm_active_reward_change
      )
    );
  else
    select profile.wallet_updated_at
    into changed_at
    from public.profiles as profile
    where profile.id = actor_id;
  end if;

  return query
  select normalized_wallet, changed_at, active_rewards;
end;
$$;

revoke all on function public.researcher_payout_wallet(uuid) from public;
revoke all on function public.researcher_payout_wallet(uuid) from anon;
revoke all on function public.researcher_payout_wallet(uuid) from authenticated;
grant execute on function public.researcher_payout_wallet(uuid) to service_role;

revoke all on function public.set_researcher_payout_wallet(uuid, text, boolean) from public;
revoke all on function public.set_researcher_payout_wallet(uuid, text, boolean) from anon;
revoke all on function public.set_researcher_payout_wallet(uuid, text, boolean) from authenticated;
grant execute on function public.set_researcher_payout_wallet(uuid, text, boolean) to service_role;
