-- SR-04b: Close the direct-write paths on report tables that could sidestep the guarantees
-- submit_report_atomic / update_report_atomic / prepare_report_attachment_atomic already make.
-- Grants only — no table shapes change, so the generated database types are unaffected. The
-- architecture is API-only (PROJECT_CONTEXT §11): apps/api talks to the database as
-- service_role (unaffected by these revokes), and the web app's only Supabase client is the
-- auth session handler — no client in the monorepo issues PostgREST table writes as
-- `authenticated`. This is the same hole class CP-01 closed for programs INSERT.
--
-- Finding 1 — reports INSERT was granted table-wide to `authenticated`.
--   The RLS-003 insert policy checks researcher identity, program active and scope in-scope,
--   but nothing else submit_report_atomic enforces: a researcher talking to PostgREST directly
--   could create a 'submitted' report with ZERO report_impacts rows (the at-least-one-impact
--   rule), no reproduction steps on a PoC-required program, a self-supplied content_hash and
--   submitted_at, and no owner notification. Revoked; the RPC is the only creation path.
--
-- Finding 2 — reports UPDATE was granted to `authenticated` on nine columns.
--   Same class on the same table: the update policy lets a researcher move their own draft or
--   needs_information report straight to 'submitted' (status and content_hash are in the column
--   list), bypassing update_report_atomic's PoC re-check, impact revalidation, the resubmit
--   review-trail and notification, and the submitted_at-preservation rule the resolution metric
--   depends on. Revoked column-by-column, mirroring the original grant, because a table-level
--   REVOKE does not remove column-level privileges.
--
-- Finding 3 — report_impacts INSERT was granted to `authenticated`.
--   RLS-004 forces row level security on the table and defines no insert policy, so the grant
--   is unusable today (default deny). It is revoked anyway: if a later migration ever adds an
--   insert policy, this dormant grant would silently open a path to forge impact snapshots
--   without the eligibility checks the RPCs perform.
--
-- Finding 4 — report_attachments INSERT was granted to `authenticated`.
--   prepare_report_attachment_atomic constructs storage_path itself
--   ('reports/<reportId>/<attachmentId>/<filename>') and owns the pending→uploaded lifecycle.
--   The RLS-003 insert policy only checks uploader identity and report access, so a direct
--   insert could forge a row on the researcher's OWN report whose storage_path points at
--   ANOTHER report's object with upload_status already 'uploaded' — and the API's download-URL
--   signing trusts the row's bucket/path once the caller can access the report and the status
--   is uploaded. That is a cross-report attachment disclosure path. Revoked.
--
-- report_comments INSERT is deliberately LEFT IN PLACE. Its RLS-004 policy (author_id =
-- auth.uid() and can_access_report) upholds every integrity rule on comments by itself; the
-- only thing add_report_comment_atomic adds is the comment_added notification side effect,
-- which is UX, not a data invariant. Direct-with-RLS comment access remains a legitimate
-- pattern should a client ever need it.
--
-- No other direct write grants exist on the report tables for `authenticated`:
-- report_impacts / report_attachments / report_comments carry no UPDATE or DELETE grant, and
-- report_reviews / ai_triage_results / report_disclosures are select-only. SELECT grants are
-- untouched everywhere — RLS-gated reads are not part of this hole class.
--
-- Rollback (restores the exact pre-migration grants; all statements are safe to re-run):
--   grant insert on public.reports to authenticated;
--   grant update (
--     affected_scope_id, title, description, reproduction_steps, proposed_severity,
--     status, content_hash, submitted_at, updated_at
--   ) on public.reports to authenticated;
--   grant insert on public.report_impacts to authenticated;
--   grant insert on public.report_attachments to authenticated;
--   delete from public.schema_migrations
--     where version = '20260727064652_sr04b_reports_direct_insert_revoke.sql';

revoke insert on public.reports from authenticated;

revoke update (
  affected_scope_id,
  title,
  description,
  reproduction_steps,
  proposed_severity,
  status,
  content_hash,
  submitted_at,
  updated_at
) on public.reports from authenticated;

revoke insert on public.report_impacts from authenticated;

revoke insert on public.report_attachments from authenticated;
