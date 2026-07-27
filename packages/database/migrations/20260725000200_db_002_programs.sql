-- DB-002: Bounty program identity, policies, and exact USDC pool accounting.

create table public.programs (
  id uuid default gen_random_uuid()
    constraint programs_pkey primary key,
  owner_id uuid not null
    constraint programs_owner_id_fkey
      references public.profiles (id) on delete restrict,

  -- Public identity -----------------------------------------------------------------------
  name text not null
    constraint programs_name_length_check check (length(btrim(name)) between 1 and 200),
  slug text not null
    constraint programs_slug_format_check
      check (slug = lower(slug) and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  short_summary text not null
    constraint programs_short_summary_length_check
      check (length(btrim(short_summary)) between 1 and 280),
  description text not null
    constraint programs_description_length_check
      check (length(btrim(description)) between 1 and 20000),
  website_url text
    -- Length is checked separately: PostgreSQL regexes cap {m,n} repetition at 255.
    constraint programs_website_url_check
      check (
        website_url is null
        or (length(website_url) <= 2000 and website_url ~* '^https://[^[:space:]]+$')
      ),
  logo_storage_path text
    constraint programs_logo_storage_path_check
      check (
        logo_storage_path is null
        or (
          length(logo_storage_path) between 1 and 1024
          and logo_storage_path !~ '(^/|//|\.\.?(/|$)|[[:cntrl:]])'
        )
      ),

  status text not null default 'draft'
    constraint programs_status_check
      check (status in ('draft', 'awaiting_funding', 'active', 'paused', 'expired', 'closed')),

  -- Pool accounting -----------------------------------------------------------------------
  -- total_pool  : USDC funded into escrow.
  -- reserved_pool: approved rewards not yet paid out. Reserving at approval time is what stops
  --                two reports from each being approved for the whole balance.
  -- paid_pool   : settled payouts; this is the value surfaced as "Total paid".
  total_pool numeric(30, 6) not null default 0
    constraint programs_total_pool_non_negative_check check (total_pool >= 0),
  reserved_pool numeric(30, 6) not null default 0
    constraint programs_reserved_pool_non_negative_check check (reserved_pool >= 0),
  paid_pool numeric(30, 6) not null default 0
    constraint programs_paid_pool_non_negative_check check (paid_pool >= 0),
  available_pool numeric(30, 6)
    generated always as (total_pool - reserved_pool - paid_pool) stored,
  paid_report_count integer not null default 0
    constraint programs_paid_report_count_check check (paid_report_count >= 0),
  total_paid_visibility text not null default 'private'
    constraint programs_total_paid_visibility_check
      check (total_paid_visibility in ('public', 'private')),

  -- Denormalized list projection ----------------------------------------------------------
  -- Maintained by the program RPCs so the public bounty table can sort and filter without
  -- joining program_scopes / program_reward_tiers on every request.
  max_bounty numeric(30, 6) not null default 0
    constraint programs_max_bounty_non_negative_check check (max_bounty >= 0),
  in_scope_asset_types text[] not null default '{}'::text[]
    constraint programs_in_scope_asset_types_check
      check (in_scope_asset_types <@ array['smart_contract', 'website', 'api', 'mobile']::text[]),
  reward_severities text[] not null default '{}'::text[]
    constraint programs_reward_severities_check
      check (
        reward_severities
          <@ array['critical', 'high', 'medium', 'low', 'informational']::text[]
      ),
  -- Public-facing lifecycle: null means the program must never appear in a public listing.
  public_status text
    generated always as (
      case
        when status = 'active' then 'active'
        when status in ('expired', 'closed') then 'ended'
      end
    ) stored,

  -- Program rules and policies ------------------------------------------------------------
  poc_policy text not null default 'required'
    constraint programs_poc_policy_check check (poc_policy in ('required', 'optional')),
  poc_policy_note text
    constraint programs_poc_policy_note_check
      check (poc_policy_note is null or length(poc_policy_note) <= 2000),
  reward_policy text
    constraint programs_reward_policy_check
      check (reward_policy is null or length(btrim(reward_policy)) between 1 and 20000),
  testing_restrictions text
    constraint programs_testing_restrictions_check
      check (testing_restrictions is null or length(testing_restrictions) <= 10000),
  submission_acknowledgment text
    constraint programs_submission_acknowledgment_check
      check (submission_acknowledgment is null or length(submission_acknowledgment) <= 1000),
  allow_custom_impact boolean not null default true,

  -- Escrow and timeline -------------------------------------------------------------------
  contract_address text
    constraint programs_contract_address_format_check
      check (contract_address is null or contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  deadline timestamp with time zone,
  published_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint programs_slug_key unique (slug),
  constraint programs_pool_solvency_check
    check (total_pool >= reserved_pool + paid_pool),
  -- A program can only have been researcher-visible if it was published at some point.
  constraint programs_published_state_check
    check (published_at is not null or status not in ('active', 'paused', 'expired')),
  constraint programs_closed_state_check
    check ((status = 'closed') = (closed_at is not null))
);

comment on constraint programs_owner_id_fkey on public.programs is
  'Restrict profile deletion while its programs still exist; programs are audit-relevant records.';

comment on column public.programs.available_pool is
  'Reward budget still free to commit. approve_report_reward_atomic must reserve against this.';

comment on column public.programs.public_status is
  'Null for draft/awaiting_funding/paused. Public listings filter on `public_status is not null`.';

comment on column public.programs.total_paid_visibility is
  'Owner-controlled. The API must decide visibility before serializing, never hide a real number client-side.';

create trigger programs_set_updated_at
before update on public.programs
for each row
execute function public.set_updated_at();

alter table public.programs enable row level security;
