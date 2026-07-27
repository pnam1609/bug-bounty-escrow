-- CP-01: Close the two direct-write paths that could sidestep guarantees the Create Program
-- schema already makes through its RPCs. Grants only — no table shapes change, so the generated
-- database types are unaffected.
--
-- Finding 1 — programs INSERT was table-wide for `authenticated`.
--   RLS-002 grants column-limited UPDATE so the pool columns stay writable only by the
--   SECURITY DEFINER settlement RPCs, but INSERT covered every column. An owner talking to
--   PostgREST directly could therefore create a program with a fabricated total_pool /
--   paid_pool / paid_report_count, or born 'active' with a self-supplied published_at —
--   bypassing create_program_atomic and the publish gate entirely. The flow doc's
--   "Server-created values" section requires status = draft and zero pools at creation, so
--   INSERT is narrowed to the same identity/policy columns UPDATE already allows, plus
--   owner_id. Everything else falls back to the column defaults (draft status, zero pools,
--   no publication timestamps).
--
-- Finding 2 — program_reward_tiers DELETE was granted to `authenticated`.
--   A tier that priced an approved reward must be archived (archived_at), never deleted
--   (CP-01 AC 7). write_program_children enforces that, but it runs as SECURITY DEFINER and
--   does not need the grant; the grant only enabled direct PostgREST deletes, and no foreign
--   key protects tier rows the way reports.affected_scope_id and report_impacts protect
--   scopes and impacts. The API writes tiers exclusively through the program RPCs as
--   service_role (which keeps full access), so revoking DELETE removes the only path that
--   could hard-delete pricing history. INSERT and UPDATE stay untouched.
--
-- Scopes and impacts keep their DELETE grant deliberately: rows referenced by a report are
-- already undeletable through ON DELETE RESTRICT foreign keys, and deleting an unreferenced
-- row matches what write_program_children itself does.
--
-- Rollback (restores the exact pre-migration grants; both statements are safe to re-run):
--   grant insert on public.programs to authenticated;
--   grant delete on public.program_reward_tiers to authenticated;
--   delete from public.schema_migrations
--     where version = '20260727055104_cp01_tighten_program_write_grants.sql';

revoke insert on public.programs from authenticated;

grant insert (
  owner_id,
  name,
  slug,
  short_summary,
  description,
  website_url,
  logo_storage_path,
  deadline,
  poc_policy,
  poc_policy_note,
  reward_policy,
  testing_restrictions,
  submission_acknowledgment,
  allow_custom_impact,
  total_paid_visibility
) on public.programs to authenticated;

revoke delete on public.program_reward_tiers from authenticated;
