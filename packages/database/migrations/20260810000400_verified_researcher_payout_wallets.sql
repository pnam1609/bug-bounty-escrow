-- Verified researcher payout wallets and immutable per-report payout selection.
--
-- Wallet control is proven by the API before it calls the completion RPC. The database owns
-- challenge lifetime/replay protection, wallet provenance, report selection history, and the
-- lock ordering that prevents a wallet edit from racing reward settlement.

create table public.researcher_payout_wallets (
  id uuid primary key default gen_random_uuid(),
  researcher_id uuid not null references public.profiles (id) on delete restrict,
  chain_id bigint not null default 5042002 check (chain_id = 5042002),
  address text not null check (
    address ~ '^0x[0-9a-f]{40}$'
    and address <> '0x0000000000000000000000000000000000000000'
  ),
  label text check (label is null or length(btrim(label)) between 1 and 80),
  status text not null check (status in ('unverified', 'verified', 'revoked')),
  verification_method text check (
    verification_method is null or verification_method = 'eip191_personal_sign'
  ),
  verification_message_hash text check (
    verification_message_hash is null
    or verification_message_hash ~ '^0x[0-9a-f]{64}$'
  ),
  verified_at timestamp with time zone,
  revoked_at timestamp with time zone,
  source text not null check (source in ('signature', 'legacy_profile_unverified')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint researcher_payout_wallets_identity_key unique (researcher_id, chain_id, address),
  constraint researcher_payout_wallets_verification_state_check check (
    (
      status = 'verified'
      and verification_method = 'eip191_personal_sign'
      and verification_message_hash is not null
      and verified_at is not null
      and revoked_at is null
      and source = 'signature'
    )
    or (
      status = 'unverified'
      and verification_method is null
      and verification_message_hash is null
      and verified_at is null
      and revoked_at is null
    )
    or (
      status = 'revoked'
      and revoked_at is not null
    )
  )
);

create trigger researcher_payout_wallets_set_updated_at
before update on public.researcher_payout_wallets
for each row execute function public.set_updated_at();

create or replace function public.enforce_researcher_payout_wallet_identity_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.researcher_id is distinct from old.researcher_id
    or new.chain_id is distinct from old.chain_id
    or new.address is distinct from old.address
  then
    raise exception using
      errcode = '55000',
      detail = 'researcher_payout_wallet_identity_immutable';
  end if;
  return new;
end;
$$;

create trigger researcher_payout_wallets_identity_immutable
before update on public.researcher_payout_wallets
for each row execute function public.enforce_researcher_payout_wallet_identity_immutable();

create table public.researcher_wallet_verification_challenges (
  id uuid primary key default gen_random_uuid(),
  researcher_id uuid not null references public.profiles (id) on delete restrict,
  address text not null check (
    address ~ '^0x[0-9a-f]{40}$'
    and address <> '0x0000000000000000000000000000000000000000'
  ),
  chain_id bigint not null default 5042002 check (chain_id = 5042002),
  domain text not null check (length(domain) between 1 and 253 and domain = lower(domain)),
  uri text not null check (length(uri) between 1 and 2048 and uri ~ '^https?://'),
  purpose text not null check (purpose = 'researcher_payout_wallet_verification'),
  nonce text not null check (length(nonce) between 16 and 128),
  message text not null check (length(message) between 1 and 4000),
  message_hash text not null check (message_hash ~ '^0x[0-9a-f]{64}$'),
  issued_at timestamp with time zone not null,
  expires_at timestamp with time zone not null,
  consumed_at timestamp with time zone,
  invalidated_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint researcher_wallet_verification_challenges_nonce_key unique (nonce),
  constraint researcher_wallet_verification_challenges_lifetime_check check (
    expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'
  ),
  constraint researcher_wallet_verification_challenges_consumed_check check (
    consumed_at is null or consumed_at >= issued_at
  ),
  constraint researcher_wallet_verification_challenges_invalidated_check check (
    invalidated_at is null or invalidated_at >= issued_at
  )
);

create index researcher_wallet_verification_challenges_actor_created_idx
  on public.researcher_wallet_verification_challenges (researcher_id, created_at desc);
create unique index researcher_wallet_verification_challenges_one_active_key
  on public.researcher_wallet_verification_challenges (researcher_id, address, purpose)
  where consumed_at is null and invalidated_at is null;

create or replace function public.enforce_researcher_wallet_challenge_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id is distinct from old.id
    or new.researcher_id is distinct from old.researcher_id
    or new.address is distinct from old.address
    or new.chain_id is distinct from old.chain_id
    or new.domain is distinct from old.domain
    or new.uri is distinct from old.uri
    or new.purpose is distinct from old.purpose
    or new.nonce is distinct from old.nonce
    or new.message is distinct from old.message
    or new.message_hash is distinct from old.message_hash
    or new.issued_at is distinct from old.issued_at
    or new.expires_at is distinct from old.expires_at
    or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
    or (old.invalidated_at is not null and new.invalidated_at is distinct from old.invalidated_at)
  then
    raise exception using
      errcode = '55000',
      detail = 'wallet_verification_challenge_immutable';
  end if;
  return new;
end;
$$;

create trigger researcher_wallet_verification_challenges_immutable
before update on public.researcher_wallet_verification_challenges
for each row execute function public.enforce_researcher_wallet_challenge_immutable();

create table public.report_payout_wallet_snapshots (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete restrict,
  researcher_id uuid not null references public.profiles (id) on delete restrict,
  researcher_payout_wallet_id uuid references public.researcher_payout_wallets (id)
    on delete restrict,
  wallet_label text check (wallet_label is null or length(btrim(wallet_label)) between 1 and 80),
  address text not null check (
    address ~ '^0x[0-9a-f]{40}$'
    and address <> '0x0000000000000000000000000000000000000000'
  ),
  chain_id bigint not null check (chain_id = 5042002),
  verification_method text not null check (
    verification_method in ('eip191_personal_sign', 'legacy_intent_recipient')
  ),
  verification_message_hash text check (
    verification_message_hash is null
    or verification_message_hash ~ '^0x[0-9a-f]{64}$'
  ),
  wallet_verified_at timestamp with time zone,
  version integer not null check (version > 0),
  source text not null check (source in ('submission', 'researcher_edit', 'legacy_intent_backfill')),
  selected_by uuid not null references public.profiles (id) on delete restrict,
  selected_at timestamp with time zone not null default now(),
  source_settlement_intent_id uuid unique,
  constraint report_payout_wallet_snapshots_version_key unique (report_id, version),
  constraint report_payout_wallet_snapshots_provenance_check check (
    (
      verification_method = 'eip191_personal_sign'
      and researcher_payout_wallet_id is not null
      and verification_message_hash is not null
      and wallet_verified_at is not null
      and source in ('submission', 'researcher_edit')
    )
    or (
      verification_method = 'legacy_intent_recipient'
      and researcher_payout_wallet_id is null
      and verification_message_hash is null
      and wallet_verified_at is null
      and source = 'legacy_intent_backfill'
      and source_settlement_intent_id is not null
    )
  )
);

alter table public.reports
  add column payout_wallet_snapshot_id uuid
    references public.report_payout_wallet_snapshots (id) on delete restrict,
  add column payout_wallet_version integer not null default 0
    check (payout_wallet_version >= 0),
  add constraint reports_payout_wallet_pointer_check check (
    (payout_wallet_snapshot_id is null) = (payout_wallet_version = 0)
  );

alter table public.reward_settlement_intents
  add column report_payout_wallet_snapshot_id uuid
    references public.report_payout_wallet_snapshots (id) on delete restrict,
  add column researcher_payout_wallet_id uuid
    references public.researcher_payout_wallets (id) on delete restrict,
  add column recipient_chain_id bigint check (recipient_chain_id is null or recipient_chain_id = 5042002),
  add column recipient_verification_method text check (
    recipient_verification_method is null
    or recipient_verification_method in ('eip191_personal_sign', 'legacy_intent_recipient')
  ),
  add column recipient_verification_message_hash text check (
    recipient_verification_message_hash is null
    or recipient_verification_message_hash ~ '^0x[0-9a-f]{64}$'
  ),
  add column recipient_wallet_verified_at timestamp with time zone;

-- A legacy profile address is discoverable for migration UX, but remains explicitly unverified.
-- It cannot be selected for a report or used to create a new settlement intent.
insert into public.researcher_payout_wallets (
  researcher_id, chain_id, address, status, source
)
select profile.id, 5042002, lower(profile.wallet_address), 'unverified', 'legacy_profile_unverified'
from public.profiles profile
where profile.role = 'researcher'
  and profile.wallet_address is not null
on conflict (researcher_id, chain_id, address) do nothing;

-- Existing intents already contain the immutable recipient that was used for the on-chain flow.
-- Preserve their recovery path without promoting that legacy address to a verified wallet.
insert into public.report_payout_wallet_snapshots (
  report_id, researcher_id, address, chain_id, verification_method, version, source,
  selected_by, selected_at, source_settlement_intent_id
)
select
  intent.report_id,
  report.researcher_id,
  intent.recipient_address,
  5042002,
  'legacy_intent_recipient',
  row_number() over (partition by intent.report_id order by intent.created_at, intent.id)::integer,
  'legacy_intent_backfill',
  intent.actor_id,
  intent.created_at,
  intent.id
from public.reward_settlement_intents intent
join public.reports report on report.id = intent.report_id
where intent.report_payout_wallet_snapshot_id is null;

update public.reward_settlement_intents intent
set
  report_payout_wallet_snapshot_id = snapshot.id,
  researcher_payout_wallet_id = snapshot.researcher_payout_wallet_id,
  recipient_chain_id = snapshot.chain_id,
  recipient_verification_method = snapshot.verification_method,
  recipient_verification_message_hash = snapshot.verification_message_hash,
  recipient_wallet_verified_at = snapshot.wallet_verified_at
from public.report_payout_wallet_snapshots snapshot
where snapshot.source_settlement_intent_id = intent.id
  and intent.report_payout_wallet_snapshot_id is null;

update public.reports report
set payout_wallet_snapshot_id = latest.id,
    payout_wallet_version = latest.version
from (
  select distinct on (snapshot.report_id) snapshot.report_id, snapshot.id, snapshot.version
  from public.report_payout_wallet_snapshots snapshot
  order by snapshot.report_id, snapshot.version desc
) latest
where report.id = latest.report_id
  and report.payout_wallet_snapshot_id is null;

create or replace function public.enforce_report_payout_wallet_snapshot_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception using
    errcode = '55000',
    detail = 'report_payout_wallet_snapshot_immutable';
end;
$$;

create trigger report_payout_wallet_snapshots_append_only
before update or delete on public.report_payout_wallet_snapshots
for each row execute function public.enforce_report_payout_wallet_snapshot_append_only();

create or replace function public.enforce_reward_settlement_recipient_snapshot_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.recipient_address is distinct from old.recipient_address
    or new.report_payout_wallet_snapshot_id is distinct from old.report_payout_wallet_snapshot_id
    or new.researcher_payout_wallet_id is distinct from old.researcher_payout_wallet_id
    or new.recipient_chain_id is distinct from old.recipient_chain_id
    or new.recipient_verification_method is distinct from old.recipient_verification_method
    or new.recipient_verification_message_hash
      is distinct from old.recipient_verification_message_hash
    or new.recipient_wallet_verified_at is distinct from old.recipient_wallet_verified_at
  then
    raise exception using
      errcode = '55000',
      detail = 'reward_settlement_recipient_snapshot_immutable';
  end if;
  return new;
end;
$$;

create trigger reward_settlement_intents_recipient_snapshot_immutable
before update on public.reward_settlement_intents
for each row execute function public.enforce_reward_settlement_recipient_snapshot_immutable();

alter table public.researcher_payout_wallets enable row level security;
alter table public.researcher_wallet_verification_challenges enable row level security;
alter table public.report_payout_wallet_snapshots enable row level security;

revoke all on public.researcher_payout_wallets from public, anon, authenticated;
revoke all on public.researcher_wallet_verification_challenges from public, anon, authenticated;
revoke all on public.report_payout_wallet_snapshots from public, anon, authenticated;
grant select, insert, update on public.researcher_payout_wallets to service_role;
grant select, insert, update on public.researcher_wallet_verification_challenges to service_role;
grant select, insert on public.report_payout_wallet_snapshots to service_role;

create policy authenticated_user_must_be_active
  on public.researcher_payout_wallets as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));
create policy authenticated_user_must_be_active
  on public.researcher_wallet_verification_challenges as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));
create policy authenticated_user_must_be_active
  on public.report_payout_wallet_snapshots as restrictive for all to authenticated
  using ((select public.is_active_auth_user()))
  with check ((select public.is_active_auth_user()));

create or replace function public.create_researcher_wallet_verification_challenge_atomic(
  target_challenge_id uuid,
  actor_id uuid,
  target_address text,
  target_domain text,
  target_uri text,
  target_purpose text,
  challenge_nonce text,
  challenge_message text,
  challenge_message_hash text,
  issued_at timestamp with time zone,
  expires_at timestamp with time zone
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_id uuid;
  normalized_address text := lower(target_address);
  normalized_domain text := lower(btrim(target_domain));
  existing_challenge public.researcher_wallet_verification_challenges;
begin
  if not exists (
    select 1 from public.profiles where id = actor_id and role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;
  if normalized_address is null
    or normalized_address !~ '^0x[0-9a-f]{40}$'
    or normalized_address = '0x0000000000000000000000000000000000000000'
  then
    perform public.reject_business('wallet_address_invalid');
  end if;
  if target_challenge_id is null
    or target_purpose <> 'researcher_payout_wallet_verification'
    or normalized_domain is null
    or length(normalized_domain) not between 1 and 253
    or target_uri is null
    or target_uri !~ '^https?://'
    or length(target_uri) > 2048
    or challenge_nonce is null
    or length(challenge_nonce) not between 16 and 128
    or challenge_message is null
    or length(challenge_message) not between 1 and 4000
    or challenge_message_hash is null
    or lower(challenge_message_hash) !~ '^0x[0-9a-f]{64}$'
    or issued_at < now() - interval '1 minute'
    or issued_at > now() + interval '1 minute'
    or expires_at <= now()
    or expires_at > issued_at + interval '10 minutes'
  then
    perform public.reject_business('wallet_verification_challenge_invalid');
  end if;

  select * into existing_challenge
  from public.researcher_wallet_verification_challenges
  where id = target_challenge_id
  for update;
  if found then
    if existing_challenge.researcher_id = actor_id
      and existing_challenge.address = normalized_address
      and existing_challenge.chain_id = 5042002
      and existing_challenge.domain = normalized_domain
      and existing_challenge.uri = target_uri
      and existing_challenge.purpose = target_purpose
      and existing_challenge.nonce = challenge_nonce
      and existing_challenge.message = challenge_message
      and existing_challenge.message_hash = lower(challenge_message_hash)
      and existing_challenge.issued_at = issued_at
      and existing_challenge.expires_at = expires_at
    then
      return existing_challenge.id;
    end if;
    perform public.reject_business('wallet_verification_challenge_conflict');
  end if;

  update public.researcher_wallet_verification_challenges
  set invalidated_at = now()
  where researcher_id = actor_id
    and address = normalized_address
    and purpose = target_purpose
    and consumed_at is null
    and invalidated_at is null;

  insert into public.researcher_wallet_verification_challenges (
    id, researcher_id, address, chain_id, domain, uri, purpose, nonce, message, message_hash,
    issued_at, expires_at
  ) values (
    target_challenge_id, actor_id, normalized_address, 5042002, normalized_domain, target_uri,
    target_purpose,
    challenge_nonce, challenge_message, lower(challenge_message_hash), issued_at, expires_at
  )
  returning id into result_id;

  return result_id;
exception
  when unique_violation then
    perform public.reject_business('wallet_verification_challenge_conflict');
    return null;
end;
$$;

create or replace function public.complete_researcher_wallet_verification_atomic(
  actor_id uuid,
  target_challenge_id uuid,
  verified_address text,
  verified_message_hash text,
  wallet_label text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  challenge_record public.researcher_wallet_verification_challenges;
  result_id uuid;
  normalized_label text := nullif(btrim(wallet_label), '');
begin
  select * into challenge_record
  from public.researcher_wallet_verification_challenges
  where id = target_challenge_id
  for update;

  if not found or challenge_record.researcher_id <> actor_id then
    perform public.reject_forbidden('wallet_verification_challenge_not_accessible');
  end if;
  if challenge_record.consumed_at is not null then
    perform public.reject_business('wallet_verification_challenge_consumed');
  end if;
  if challenge_record.invalidated_at is not null then
    perform public.reject_business('wallet_verification_challenge_invalidated');
  end if;
  if challenge_record.expires_at <= now() then
    perform public.reject_business('wallet_verification_challenge_expired');
  end if;
  if lower(verified_address) <> challenge_record.address
    or lower(verified_message_hash) <> challenge_record.message_hash
  then
    perform public.reject_business('wallet_verification_challenge_mismatch');
  end if;
  if normalized_label is not null and length(normalized_label) > 80 then
    perform public.reject_business('wallet_label_invalid');
  end if;

  update public.researcher_wallet_verification_challenges
  set consumed_at = now()
  where id = target_challenge_id and consumed_at is null;

  if not found then
    perform public.reject_business('wallet_verification_challenge_consumed');
  end if;

  insert into public.researcher_payout_wallets (
    researcher_id, chain_id, address, label, status, verification_method,
    verification_message_hash, verified_at, revoked_at, source
  ) values (
    actor_id, 5042002, challenge_record.address, normalized_label, 'verified',
    'eip191_personal_sign', challenge_record.message_hash, now(), null, 'signature'
  )
  on conflict (researcher_id, chain_id, address) do update
  set label = coalesce(excluded.label, researcher_payout_wallets.label),
      status = 'verified',
      verification_method = excluded.verification_method,
      verification_message_hash = excluded.verification_message_hash,
      verified_at = excluded.verified_at,
      revoked_at = null,
      source = 'signature'
  returning id into result_id;

  return result_id;
end;
$$;

create or replace function public.report_payout_wallet_block_reason(
  actor_id uuid,
  target_report_id uuid
)
returns text
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
begin
  select * into report_record from public.reports where id = target_report_id;
  if not found or report_record.researcher_id <> actor_id then
    return 'report_payout_wallet_not_accessible';
  end if;
  if report_record.status not in ('submitted', 'triaged', 'needs_information', 'validated') then
    return 'report_payout_wallet_report_closed';
  end if;

  select * into program_record from public.programs where id = report_record.program_id;
  if program_record.status not in ('active', 'paused')
    or (program_record.deadline is not null and program_record.deadline <= now())
  then
    return 'report_payout_wallet_program_ended';
  end if;

  if report_record.approved_reward is not null
    or report_record.reward_approved_at is not null
    or report_record.paid_at is not null
    or exists (
      select 1
      from public.reward_settlement_intents intent
      where intent.report_id = target_report_id
        and (
          intent.status <> 'failed'
          or exists (
            select 1 from public.reward_settlement_operations operation
            where operation.intent_id = intent.id
              and operation.status in (
                'submission_uncertain', 'provider_accepted', 'submitted', 'confirmed'
              )
          )
        )
    )
    or exists (
      select 1 from public.escrow_transactions transaction
      where transaction.report_id = target_report_id
        and transaction.transaction_type = 'payout'
        and transaction.status in ('pending', 'confirmed')
    )
  then
    return 'report_payout_wallet_settlement_started';
  end if;

  return null;
end;
$$;

create or replace function public.set_report_payout_wallet_atomic(
  actor_id uuid,
  target_report_id uuid,
  target_wallet_id uuid,
  expected_version integer
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  wallet_record public.researcher_payout_wallets;
  blocked_reason text;
  next_snapshot_id uuid;
  next_version integer;
begin
  -- Uniform order with settlement: report, program, then payout selection/wallet rows.
  select * into report_record from public.reports where id = target_report_id for update;
  if not found or report_record.researcher_id <> actor_id then
    perform public.reject_forbidden('report_payout_wallet_not_accessible');
  end if;

  select * into program_record from public.programs
  where id = report_record.program_id for update;

  if expected_version is null or expected_version <> report_record.payout_wallet_version then
    perform public.reject_business('report_payout_wallet_version_conflict');
  end if;

  blocked_reason := public.report_payout_wallet_block_reason(actor_id, target_report_id);
  if blocked_reason is not null then
    if blocked_reason = 'report_payout_wallet_not_accessible' then
      perform public.reject_forbidden(blocked_reason);
    end if;
    perform public.reject_business(blocked_reason);
  end if;

  select * into wallet_record from public.researcher_payout_wallets
  where id = target_wallet_id for share;
  if not found or wallet_record.researcher_id <> actor_id then
    perform public.reject_forbidden('researcher_payout_wallet_not_accessible');
  end if;
  if wallet_record.chain_id <> 5042002
    or wallet_record.status <> 'verified'
    or wallet_record.revoked_at is not null
  then
    perform public.reject_business('researcher_payout_wallet_not_verified');
  end if;

  next_version := report_record.payout_wallet_version + 1;
  insert into public.report_payout_wallet_snapshots (
    report_id, researcher_id, researcher_payout_wallet_id, wallet_label, address, chain_id,
    verification_method, verification_message_hash, wallet_verified_at, version, source,
    selected_by
  ) values (
    report_record.id, actor_id, wallet_record.id, wallet_record.label, wallet_record.address,
    wallet_record.chain_id, wallet_record.verification_method,
    wallet_record.verification_message_hash, wallet_record.verified_at, next_version,
    'researcher_edit', actor_id
  ) returning id into next_snapshot_id;

  update public.reports
  set payout_wallet_snapshot_id = next_snapshot_id,
      payout_wallet_version = next_version
  where id = target_report_id;

  return next_snapshot_id;
end;
$$;

create or replace function public.get_report_payout_wallet_state(
  actor_id uuid,
  target_report_id uuid
)
returns table (
  snapshot_id uuid,
  wallet_id uuid,
  wallet_label text,
  wallet_address text,
  chain_id bigint,
  version integer,
  verified_at timestamp with time zone,
  can_edit boolean,
  blocked_reason text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  reason text;
begin
  select * into report_record from public.reports where id = target_report_id;
  if not found or report_record.researcher_id <> actor_id then
    perform public.reject_forbidden('report_payout_wallet_not_accessible');
  end if;
  reason := public.report_payout_wallet_block_reason(actor_id, target_report_id);

  return query
  select
    snapshot.id,
    snapshot.researcher_payout_wallet_id,
    snapshot.wallet_label,
    snapshot.address,
    snapshot.chain_id,
    report_record.payout_wallet_version,
    snapshot.wallet_verified_at,
    reason is null,
    reason
  from (select 1) singleton
  left join public.report_payout_wallet_snapshots snapshot
    on snapshot.id = report_record.payout_wallet_snapshot_id;
end;
$$;

-- The submission signature remains stable for existing API callers. payoutWalletId is a required
-- member of input, and payout selection is deliberately excluded from content hash/revisions/AI.
create or replace function public.submit_report_atomic(
  actor_id uuid,
  target_program_id uuid,
  input jsonb,
  generated_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_report_id uuid;
  program_record public.programs;
  scope_record public.program_scopes;
  wallet_record public.researcher_payout_wallets;
  selected_impact_count integer;
  custom_impact_count integer;
  selected_wallet_id uuid;
  created_snapshot_id uuid;
begin
  select * into program_record
  from public.programs
  where id = target_program_id
  for update;

  if not found then
    perform public.reject_business('program_not_accepting_reports');
  end if;
  if program_record.owner_id = actor_id then
    perform public.reject_business('program_owner_cannot_submit_reports');
  end if;
  if not exists (
    select 1 from public.profiles where id = actor_id and role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;
  if program_record.status <> 'active' then
    perform public.reject_business('program_not_accepting_reports');
  end if;

  select * into scope_record
  from public.program_scopes
  where id = (input ->> 'affectedScopeId')::uuid
    and program_id = target_program_id
    and is_in_scope
    and archived_at is null;
  if not found then perform public.reject_business('scope_not_eligible'); end if;

  if program_record.poc_policy = 'required'
    and length(btrim(coalesce(input ->> 'reproductionSteps', ''))) = 0
  then
    perform public.reject_business('reproduction_steps_required');
  end if;

  selected_impact_count := coalesce(jsonb_array_length(input -> 'programImpactIds'), 0);
  custom_impact_count := coalesce(jsonb_array_length(input -> 'customImpacts'), 0);
  if selected_impact_count + custom_impact_count = 0 then
    perform public.reject_business('impact_selection_required');
  end if;
  if custom_impact_count > 0 and not program_record.allow_custom_impact then
    perform public.reject_business('custom_impact_not_allowed');
  end if;
  if selected_impact_count > 0 and exists (
    select 1
    from jsonb_array_elements_text(input -> 'programImpactIds') requested(impact_id)
    where not exists (
      select 1 from public.program_impacts impact
      where impact.id = requested.impact_id::uuid
        and impact.program_id = target_program_id
        and impact.asset_type = scope_record.asset_type
        and impact.enabled
        and impact.archived_at is null
    )
  ) then
    perform public.reject_business('impact_not_eligible');
  end if;

  if coalesce(input ->> 'payoutWalletId', '')
    !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  then
    perform public.reject_business('researcher_payout_wallet_required');
  end if;
  selected_wallet_id := (input ->> 'payoutWalletId')::uuid;
  select * into wallet_record from public.researcher_payout_wallets
  where id = selected_wallet_id for share;
  if not found or wallet_record.researcher_id <> actor_id then
    perform public.reject_forbidden('researcher_payout_wallet_not_accessible');
  end if;
  if wallet_record.status <> 'verified'
    or wallet_record.revoked_at is not null
    or wallet_record.chain_id <> 5042002
  then
    perform public.reject_business('researcher_payout_wallet_not_verified');
  end if;

  insert into public.reports (
    program_id, researcher_id, affected_scope_id, title, description, reproduction_steps,
    secret_gist_url, proposed_severity, severity_mismatch_acknowledged, status, content_hash,
    submitted_at
  ) values (
    target_program_id, actor_id, scope_record.id, input ->> 'title', input ->> 'description',
    nullif(btrim(coalesce(input ->> 'reproductionSteps', '')), ''),
    nullif(btrim(coalesce(input ->> 'secretGistUrl', '')), ''),
    input ->> 'proposedSeverity',
    coalesce((input ->> 'severityMismatchAcknowledged')::boolean, false),
    'submitted', generated_content_hash, now()
  ) returning id into created_report_id;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source, impact_title_snapshot,
    impact_severity_snapshot, asset_type_snapshot
  )
  select created_report_id, target_program_id, impact.id, 'program', impact.title,
    impact.severity, impact.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'programImpactIds', '[]'::jsonb))
    requested(impact_id)
  join public.program_impacts impact on impact.id = requested.impact_id::uuid;

  insert into public.report_impacts (
    report_id, program_id, program_impact_id, source, custom_title, impact_title_snapshot,
    impact_severity_snapshot, asset_type_snapshot
  )
  select created_report_id, target_program_id, null, 'custom', btrim(proposed.title),
    btrim(proposed.title), null, scope_record.asset_type
  from jsonb_array_elements_text(coalesce(input -> 'customImpacts', '[]'::jsonb)) proposed(title)
  where length(btrim(proposed.title)) > 0;

  if not exists (select 1 from public.report_impacts where report_id = created_report_id) then
    perform public.reject_business('impact_selection_required');
  end if;

  insert into public.report_payout_wallet_snapshots (
    report_id, researcher_id, researcher_payout_wallet_id, wallet_label, address, chain_id,
    verification_method, verification_message_hash, wallet_verified_at, version, source,
    selected_by
  ) values (
    created_report_id, actor_id, wallet_record.id, wallet_record.label, wallet_record.address,
    wallet_record.chain_id, wallet_record.verification_method,
    wallet_record.verification_message_hash, wallet_record.verified_at, 1, 'submission', actor_id
  ) returning id into created_snapshot_id;

  update public.reports
  set payout_wallet_snapshot_id = created_snapshot_id,
      payout_wallet_version = 1
  where id = created_report_id;

  perform public.enqueue_report_ai_run_atomic(
    created_report_id, target_program_id, generated_content_hash
  );

  insert into public.notifications (recipient_id, type, metadata)
  values (
    program_record.owner_id, 'report_submitted',
    jsonb_build_object('reportId', created_report_id, 'programId', target_program_id)
  );

  return created_report_id;
end;
$$;

create or replace function public.create_reward_settlement_intent_atomic(
  actor_id uuid,
  target_report_id uuid,
  reward_amount numeric,
  calculation_basis_amount numeric,
  target_report_key text,
  target_content_hash text,
  target_owner_wallet text,
  request_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report_record public.reports;
  program_record public.programs;
  escrow_record public.escrow_contracts;
  tier_record public.program_reward_tiers;
  snapshot_record public.report_payout_wallet_snapshots;
  scope_asset_type text;
  allowed_bounds numrange;
  settled_amount numeric;
  existing_intent public.reward_settlement_intents;
  result_id uuid;
begin
  select * into report_record from public.reports
  where id = target_report_id for update;
  if not found then perform public.reject_forbidden('report_not_accessible'); end if;
  if report_record.status <> 'validated' or report_record.final_severity is null then
    perform public.reject_business('invalid_report_transition');
  end if;

  select * into program_record from public.programs
  where id = report_record.program_id for update;
  if program_record.owner_id <> actor_id then
    perform public.reject_forbidden('program_owner_required');
  end if;

  select * into existing_intent
  from public.reward_settlement_intents
  where program_id = report_record.program_id and idempotency_key = request_idempotency_key
  order by created_at
  limit 1
  for update;
  if found then
    if existing_intent.report_id <> target_report_id
      or existing_intent.owner_wallet <> lower(target_owner_wallet)
      or existing_intent.report_key <> lower(target_report_key)
      or existing_intent.approved_content_hash <> lower(target_content_hash)
      or (
        existing_intent.calculation_type = 'percentage'
        and (
          reward_amount is not null
          or calculation_basis_amount is distinct from existing_intent.calculation_basis_amount
        )
      )
      or (
        existing_intent.calculation_type in ('range', 'flat')
        and (
          calculation_basis_amount is not null
          or reward_amount is distinct from existing_intent.amount
        )
      )
    then
      perform public.reject_business('reward_settlement_idempotency_mismatch');
    end if;
    return existing_intent.id;
  end if;

  if report_record.payout_wallet_snapshot_id is null then
    perform public.reject_business('researcher_payout_wallet_required');
  end if;
  select * into snapshot_record
  from public.report_payout_wallet_snapshots
  where id = report_record.payout_wallet_snapshot_id
  for share;
  if not found
    or snapshot_record.report_id <> report_record.id
    or snapshot_record.researcher_id <> report_record.researcher_id
    or snapshot_record.chain_id <> 5042002
    or snapshot_record.verification_method <> 'eip191_personal_sign'
    or snapshot_record.wallet_verified_at is null
  then
    perform public.reject_business('researcher_payout_wallet_not_verified');
  end if;

  select * into escrow_record
  from public.escrow_contracts
  where program_id = report_record.program_id
    and chain_id = 5042002
    and deployment_status = 'confirmed'
    and contract_version = '1.1.0'
  order by created_at desc
  limit 1
  for update;
  if not found
    or escrow_record.contract_address is null
    or escrow_record.owner_wallet is null
    or escrow_record.token_address <> '0x3600000000000000000000000000000000000000'
  then
    perform public.reject_business('canonical_program_escrow_required');
  end if;
  if escrow_record.owner_wallet <> lower(target_owner_wallet) then
    perform public.reject_business('escrow_owner_wallet_mismatch');
  end if;

  select scope.asset_type into scope_asset_type
  from public.program_scopes scope where scope.id = report_record.affected_scope_id;
  select * into tier_record
  from public.program_reward_tiers
  where program_id = report_record.program_id
    and asset_type = scope_asset_type
    and severity = report_record.final_severity
    and archived_at is null;
  if not found then perform public.reject_business('reward_tier_coverage_missing'); end if;

  if tier_record.calculation_type = 'percentage' then
    if reward_amount is not null
      or calculation_basis_amount is null
      or calculation_basis_amount <= 0
    then
      perform public.reject_business('reward_basis_required');
    end if;
    settled_amount := round(
      least(
        calculation_basis_amount * tier_record.percentage_bps / 10000,
        tier_record.max_reward_cap
      ),
      6
    );
  else
    if reward_amount is null or calculation_basis_amount is not null then
      perform public.reject_business('reward_amount_required');
    end if;
    allowed_bounds := public.reward_tier_bounds(tier_record);
    if not (allowed_bounds @> reward_amount) then
      perform public.reject_business('reward_out_of_bounds');
    end if;
    settled_amount := reward_amount;
  end if;
  if settled_amount <= 0 then perform public.reject_business('reward_out_of_bounds'); end if;
  if settled_amount > program_record.available_pool then
    perform public.reject_business('insufficient_available_pool');
  end if;

  insert into public.reward_settlement_intents (
    report_id, program_id, escrow_contract_id, actor_id, idempotency_key, owner_wallet,
    report_key, approved_content_hash, recipient_address, calculation_type,
    calculation_basis_base_units, calculation_basis_amount, percentage_bps,
    max_reward_cap_base_units, max_reward_cap, amount_base_units, amount,
    report_payout_wallet_snapshot_id, researcher_payout_wallet_id, recipient_chain_id,
    recipient_verification_method, recipient_verification_message_hash,
    recipient_wallet_verified_at
  ) values (
    target_report_id, report_record.program_id, escrow_record.id, actor_id,
    request_idempotency_key, lower(target_owner_wallet), lower(target_report_key),
    lower(report_record.content_hash), snapshot_record.address, tier_record.calculation_type,
    case when tier_record.calculation_type = 'percentage'
      then round(calculation_basis_amount * 1000000)::bigint else null end,
    case when tier_record.calculation_type = 'percentage'
      then calculation_basis_amount else null end,
    case when tier_record.calculation_type = 'percentage'
      then tier_record.percentage_bps else null end,
    case when tier_record.calculation_type = 'percentage'
      then round(tier_record.max_reward_cap * 1000000)::bigint else null end,
    case when tier_record.calculation_type = 'percentage'
      then tier_record.max_reward_cap else null end,
    round(settled_amount * 1000000)::bigint,
    settled_amount,
    snapshot_record.id,
    snapshot_record.researcher_payout_wallet_id,
    snapshot_record.chain_id,
    snapshot_record.verification_method,
    snapshot_record.verification_message_hash,
    snapshot_record.wallet_verified_at
  ) returning id into result_id;

  update public.programs
  set reserved_pool = reserved_pool + settled_amount
  where id = report_record.program_id;

  return result_id;
end;
$$;

revoke all on function public.create_researcher_wallet_verification_challenge_atomic(
  uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone,
  timestamp with time zone
) from public, anon, authenticated;
revoke all on function public.complete_researcher_wallet_verification_atomic(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.report_payout_wallet_block_reason(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_report_payout_wallet_atomic(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_report_payout_wallet_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.submit_report_atomic(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.create_reward_settlement_intent_atomic(
  uuid, uuid, numeric, numeric, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.create_researcher_wallet_verification_challenge_atomic(
  uuid, uuid, text, text, text, text, text, text, text, timestamp with time zone,
  timestamp with time zone
) to service_role;
grant execute on function public.complete_researcher_wallet_verification_atomic(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.set_report_payout_wallet_atomic(uuid, uuid, uuid, integer)
  to service_role;
grant execute on function public.get_report_payout_wallet_state(uuid, uuid)
  to service_role;
grant execute on function public.submit_report_atomic(uuid, uuid, jsonb, text)
  to service_role;
grant execute on function public.create_reward_settlement_intent_atomic(
  uuid, uuid, numeric, numeric, text, text, text, uuid
) to service_role;

comment on table public.report_payout_wallet_snapshots is
  'Append-only payout selection history. reports.payout_wallet_snapshot_id identifies the sole current selection.';
comment on function public.complete_researcher_wallet_verification_atomic(
  uuid, uuid, text, text, text
) is
  'Consumes a challenge after the API verifies its EIP-191 signature; raw signatures are never persisted.';
