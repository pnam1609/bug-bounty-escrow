-- DB-004: Per-asset-type reward calculation for every supported severity.

create table public.program_reward_tiers (
  id uuid default gen_random_uuid()
    constraint program_reward_tiers_pkey primary key,
  program_id uuid not null
    constraint program_reward_tiers_program_id_fkey
      references public.programs (id) on delete cascade,
  asset_type text not null
    constraint program_reward_tiers_asset_type_check
      check (asset_type in ('smart_contract', 'website', 'api', 'mobile')),
  severity text not null
    constraint program_reward_tiers_severity_check
      check (severity in ('critical', 'high', 'medium', 'low', 'informational')),
  calculation_type text not null default 'range'
    constraint program_reward_tiers_calculation_type_check
      check (calculation_type in ('range', 'flat', 'percentage')),

  -- calculation_type = 'range'
  min_reward numeric(30, 6)
    constraint program_reward_tiers_min_reward_non_negative_check
      check (min_reward is null or min_reward >= 0),
  max_reward numeric(30, 6)
    constraint program_reward_tiers_max_reward_non_negative_check
      check (max_reward is null or max_reward >= 0),
  -- calculation_type = 'flat'
  flat_amount numeric(30, 6)
    constraint program_reward_tiers_flat_amount_check
      check (flat_amount is null or flat_amount > 0),
  -- calculation_type = 'percentage'
  percentage_bps integer
    constraint program_reward_tiers_percentage_bps_check
      check (percentage_bps is null or percentage_bps between 1 and 10000),
  max_reward_cap numeric(30, 6)
    constraint program_reward_tiers_max_reward_cap_check
      check (max_reward_cap is null or max_reward_cap > 0),

  calculation_note text
    constraint program_reward_tiers_calculation_note_check
      check (calculation_note is null or length(calculation_note) <= 2000),
  -- Soft delete: a tier that already priced an approved reward is part of the payment record,
  -- so removing it from the program retires the row instead of deleting it.
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint program_reward_tiers_min_lte_max_check
    check (min_reward is null or max_reward is null or min_reward <= max_reward),
  -- Exactly one calculation shape may be populated, and it must match calculation_type.
  constraint program_reward_tiers_calculation_shape_check
    check (
      (
        calculation_type = 'range'
        and min_reward is not null
        and max_reward is not null
        and flat_amount is null
        and percentage_bps is null
        and max_reward_cap is null
      )
      or (
        calculation_type = 'flat'
        and flat_amount is not null
        and min_reward is null
        and max_reward is null
        and percentage_bps is null
        and max_reward_cap is null
      )
      or (
        calculation_type = 'percentage'
        and percentage_bps is not null
        and max_reward_cap is not null
        and min_reward is null
        and max_reward is null
        and flat_amount is null
      )
    )
);

comment on constraint program_reward_tiers_program_id_fkey on public.program_reward_tiers is
  'Cascade because reward tiers are value objects owned exclusively by their parent program.';

comment on column public.program_reward_tiers.archived_at is
  'Archived tiers keep the pricing that a historical approval used, but no longer apply to new reports.';

-- A severity may be priced differently per asset type, so uniqueness is per asset type. The
-- index is partial so an archived tier does not block re-adding that severity later.
create unique index program_reward_tiers_active_key
  on public.program_reward_tiers (program_id, asset_type, severity)
  where archived_at is null;

comment on column public.program_reward_tiers.max_reward_cap is
  'Ceiling for percentage tiers. The server derives the reward from the reviewer-supplied basis and clamps it here.';

-- Resolved payout bounds for the tiers whose amount the reviewer enters directly. Percentage
-- tiers are computed instead (see approve_report_reward_atomic), not bounds-checked.
create or replace function public.reward_tier_bounds(tier public.program_reward_tiers)
returns numrange
language sql
immutable
set search_path = pg_catalog
as $$
  select case tier.calculation_type
    when 'range' then numrange(tier.min_reward, tier.max_reward, '[]')
    when 'flat' then numrange(tier.flat_amount, tier.flat_amount, '[]')
    else numrange(0, tier.max_reward_cap, '[]')
  end;
$$;

create trigger program_reward_tiers_set_updated_at
before update on public.program_reward_tiers
for each row
execute function public.set_updated_at();

alter table public.program_reward_tiers enable row level security;
