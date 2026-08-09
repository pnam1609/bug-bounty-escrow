-- CP-01: allow the public program summary to carry richer card/header copy.
-- Existing rows satisfy the previous 280-character constraint, so widening this check is
-- backward-compatible and leaves the long-form description limit at 20,000 characters.

alter table public.programs
  drop constraint if exists programs_short_summary_length_check;

alter table public.programs
  add constraint programs_short_summary_length_check
  check (length(btrim(short_summary)) between 1 and 1000);
