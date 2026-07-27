-- BT-03: privacy-preserving sort key for the public bounty table.
--
-- Sorting public rows directly by `paid_pool` leaks information about owners who selected
-- `total_paid_visibility = 'private'` through relative row order. This generated key is null for
-- every private program, so PostgREST can put those rows last and use `id` as their only tie-break.

alter table public.programs
  add column public_paid_pool numeric(30, 6)
    generated always as (
      case
        when total_paid_visibility = 'public' then paid_pool
      end
    ) stored;

comment on column public.programs.public_paid_pool is
  'Public sort key only. Null for private totals so list ordering cannot reveal hidden paid_pool values.';

drop index if exists public.programs_public_paid_pool_idx;

create index programs_public_paid_pool_idx
  on public.programs (public_status, public_paid_pool desc nulls last, id)
  where public_status is not null;
