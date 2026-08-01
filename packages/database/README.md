# Database migrations

This package owns the ordered Supabase PostgreSQL schema migrations, local
authorization verification, and guarded local/demo seed lifecycle. Demo identities
and their shared password are intentionally local-only; no production credential
belongs in this package.

## Migration order

| Order | Task           | Migration                                           | Purpose                                                                                  |
| ----- | -------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1     | DB-001         | `20260725000100_db_001_profiles.sql`                | Auth-backed profiles, safe role default, timestamp trigger function, and RLS enablement. |
| 2     | DB-002         | `20260725000200_db_002_programs.sql`                | Programs, normalized unique slugs, exact pool accounting, and owner relationship.        |
| 3     | DB-003         | `20260725000300_db_003_program_scopes.sql`          | Program-owned scope assets and asset-type constraints.                                   |
| 4     | DB-004         | `20260725000400_db_004_program_reward_tiers.sql`    | Unique severity tiers and exact reward ranges.                                           |
| 5     | DB-005         | `20260725000500_db_005_reports.sql`                 | Private reports, all current states/severities, hashes, and exact rewards.               |
| 6     | DB-006         | `20260725000600_db_006_report_attachments.sql`      | Private object identifiers and bounded safe attachment metadata.                         |
| 7     | DB-007         | `20260725000700_db_007_report_comments.sql`         | Private comments with audit-preserving soft deletion.                                    |
| 8     | DB-008         | `20260725000800_db_008_report_reviews.sql`          | Human review actions and state-transition metadata.                                      |
| 9     | DB-009         | `20260725000900_db_009_ai_triage_results.sql`       | Structured optional triage results or safe provider-failure metadata.                    |
| 10    | DB-010         | `20260725001000_db_010_escrow_contracts.sql`        | Unique per-program chain deployment state and identifiers.                               |
| 11    | DB-011         | `20260725001100_db_011_escrow_transactions.sql`     | Idempotent funding, reward, and refund chain events with exact amounts.                  |
| 12    | DB-012         | `20260725001200_db_012_notifications.sql`           | Notifications with recursive secret/private-content metadata rejection.                  |
| 13    | DB-013         | `20260725001300_db_013_audit_logs.sql`              | Append-only audit events with redacted metadata.                                         |
| 14    | DB-014         | `20260725001400_db_014_indexes_and_constraints.sql` | Access indexes, cross-table ownership FKs, and final lifecycle checks.                   |
| 15    | AUTH-002/003   | `20260725001500_auth_profile_onboarding.sql`        | Safe Auth profile bootstrap and idempotent self-onboarding RPC.                          |
| 16    | RLS-001        | `20260725001600_rls_001_profiles.sql`               | Self-profile visibility and safe-column update policies.                                 |
| 17    | RLS-002        | `20260725001700_rls_002_programs.sql`               | Public active program, owner, and assigned-reviewer policies.                            |
| 18    | RLS-003        | `20260725001800_rls_003_reports.sql`                | Private report and attachment metadata policies.                                         |
| 19    | RLS-004        | `20260725001900_rls_004_report_collaboration.sql`   | Comment, review, and AI-result role/action separation.                                   |
| 20    | STO-001/002    | `20260725002000_storage_report_attachments.sql`     | Private bucket limits and canonical object-path policies.                                |
| 21    | Off-chain RPCs | `20260725002100_offchain_atomic_rpcs.sql`           | Atomic program/report/comment/review workflows without payout.                           |

The filenames are chronological and must be applied in that order. Migrations 1–14
create the deny-by-default foundation; migrations 15–21 add the reviewed Auth,
authorization, Storage, and atomic off-chain application surface.

## Auth and redirect configuration

- Email/password Auth is enabled for local, staging, and hosted environments.
- Local/demo may auto-confirm email. Staging and production require email
  confirmation unless an operator makes a separately reviewed decision.
- Local allowed redirect origins are exact loopback application URLs. Staging and
  production use exact HTTPS application origins; wildcard production redirects
  are forbidden.
- The browser receives only the public Supabase URL and anon key. The service-role
  key remains API-only.
- Hosted dashboard parity is not mutated or verified by these local commands.

## Local demo lifecycle

The seed contains synthetic local identities, nine programs, 36 reports, and collaboration/review
history. Identity credentials are intentionally not documented or shared. Narratives are synthetic
rewrites inspired by common patterns in public security disclosures and contain no private exploit
data.

Reset a disposable PGlite database only with both guards:

```sh
DEMO_ENV=local \
DEMO_RESET_CONFIRM=RESET_OFFCHAIN_DEMO \
DEMO_DATABASE_PATH=./.local/offchain-demo \
pnpm --filter @bug-bounty-escrow/database demo:reset
```

The command migrates an empty database, resets only deterministic demo-owned UUID
ranges, seeds data, and always closes the database. It refuses missing environment,
confirmation, or path values. Re-running produces the same entity counts and no
duplicates.

`db:migrate --seed` remains available without extra flags for a loopback
PostgreSQL target. It always refuses `NODE_ENV=production`. A remote disposable
demo/test target additionally requires `DEMO_ENV=demo` (or `test`) and
`DEMO_SEED_CONFIRM=SEED_REMOTE_DEMO_DATABASE`; those flags never override the
production refusal. Production migrations also fail closed before changing the
schema if deterministic local-demo identities or local-demo password markers exist.
On a completely fresh bare PostgreSQL target, where both `auth.users` and the
`authenticated` role are absent, that preflight permits the compatibility shim
to install both. A partial Auth catalog (only one is present) is treated as an
inconsistent target and fails closed.
The API additionally rejects those identities when `NODE_ENV=production`, but
that is defense in depth for the service-role API path. A restrictive
authenticated-role policy also checks `auth.users.banned_until` on every
RLS-enabled application table and `storage.objects`, so an Auth ban immediately
blocks direct PostgREST and Storage use by an already-issued JWT. The policy
does not apply to `anon` public reads or the API's `service_role`.

## Data and deletion decisions

- Profile IDs are Supabase Auth user UUIDs. The default role is `researcher`; owner
  or reviewer roles must be assigned by a trusted server-side workflow.
- Deleting an Auth user cascades to its profile only when no owned program blocks
  the operation. Program ownership uses `ON DELETE RESTRICT` because programs are
  audit-relevant records.
- Scopes and reward tiers use `ON DELETE CASCADE` because they are value objects
  with no lifecycle outside their parent program.
- USDC pools and rewards use `numeric(30, 6)`. Application boundaries still expose
  monetary values as strings.
- DB-001 through DB-004 were audited against the current domain definitions. No
  historical defect was found, so no historical migration was rewritten and no
  corrective migration was needed.
- Report, attachment, comment, review, and AI rows use `ON DELETE RESTRICT` to
  preserve private-report audit history. Comment deletion is represented by
  `deleted_at`; API responses must hide deleted content without erasing author
  identity.
- Attachment rows persist private bucket/path identifiers, never public or signed
  URLs.
- Chain addresses and transaction hashes are stored in canonical lowercase form.
  `escrow_transactions_chain_event_key` uses `NULLS NOT DISTINCT` so transaction
  records without an event log index are still idempotent.
- Notification and audit metadata recursively rejects keys associated with report
  content, credentials, tokens, private keys, and signed URLs. This database guard
  complements, rather than replaces, application allowlists and log redaction.

## Index rationale

DB-014 adds indexes for the documented access patterns:

- Programs use owner/status/creation and status/deadline indexes. The existing
  unique slug constraint already supplies the slug index.
- Reports use program/status/submission and researcher/status/submission indexes.
- Attachments, comments, reviews, and AI results use report/time indexes.
- Transactions use program/time, optional report/time, and status/time indexes.
  The existing chain-event unique constraint already covers chain/hash lookups.
- Notifications use recipient/read/time and a partial recipient/unread/time index.
- Audit logs use partial actor/time and entity/time indexes.

Composite unique constraints added solely to support cross-table ownership foreign
keys are not query-index substitutes: they ensure a report scope, transaction
report, and escrow contract belong to the same program and chain.

## Apply and verify

Use a fresh, disposable Supabase PostgreSQL database that already contains the
`auth.users` table. To verify DB-001 through DB-004 only:

```sh
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f packages/database/tests/core-schema/apply-and-verify.sql
```

The core runner applies the first four migrations and then executes
`verify_core_schema.sql`. Verification inspects columns, defaults, foreign keys,
named checks, unique constraints, triggers, domain values, and RLS state. It also
uses transactional fixtures to prove invalid pool, reward, role, status, asset, and
severity values are rejected. The final `ROLLBACK` removes every verification
fixture, including temporary Auth users.

The runner is for a fresh database only. Running it against an already migrated
database correctly fails on duplicate objects instead of hiding schema drift.

To apply and verify DB-001 through DB-014:

```sh
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f packages/database/tests/backend-foundation/apply-and-verify.sql
```

The full runner checks every table, RLS state, absence of policies, important
columns, named constraints, indexes and safety functions. Transactional fixtures
exercise valid rows plus rejected cross-program references, path traversal,
invalid review transitions, inconsistent AI outcomes, non-canonical chain
identifiers, duplicate chain events, forbidden nested metadata, and audit-log
mutation.

## Rollback and re-apply

These migrations are forward-only. The preferred local rollback is to discard and
recreate the disposable Supabase database, then run the ordered migrations again.
This also proves the migrations do not depend on leftover objects.

If a database cannot be recreated, a local administrator may remove the objects in
reverse dependency order:

1. `public.audit_logs`
2. `public.notifications`
3. `public.escrow_transactions`
4. `public.escrow_contracts`
5. `public.ai_triage_results`
6. `public.report_reviews`
7. `public.report_comments`
8. `public.report_attachments`
9. `public.reports`
10. `public.program_reward_tiers`
11. `public.program_scopes`
12. `public.programs`
13. `public.profiles`
14. `public.prevent_audit_log_mutation()`
15. `public.jsonb_contains_forbidden_metadata_key(jsonb)`
16. `public.set_updated_at()`

Never use that manual rollback against a shared, staging, or production database.
Production corrections require a new reviewed forward migration.

After reset, run `apply-and-verify.sql` a second time to prove deterministic
ordering and re-application.

## DB-015 generated database types

After applying DB-001 through DB-014 to the local Supabase database, generate types
with the package-local, version-pinned command:

```sh
pnpm --filter @bug-bounty-escrow/database types:generate
```

It invokes Supabase CLI `2.54.11` against the local database and writes
`src/generated/database.types.ts` only when CLI output contains both the generated
`Json` and `Database` types. The generated file must not be hand-written.

Check for stale output with:

```sh
pnpm --filter @bug-bounty-escrow/database types:check
```

The check regenerates in memory from the migrated local database and compares exact
normalized output. After generation, add the generated row/insert/update aliases to
the package public entrypoint and compile an API import. That export/integration
step cannot be completed safely until genuine generated output exists.

## Current local prerequisite

The type command downloads only the pinned CLI through pnpm's active supply-chain
policy. Applying/verifying migrations still requires an approved local PostgreSQL
or Supabase runtime. Do not approve a blocked install script merely to run this
task, and do not bypass TLS or connect to a remote shared database.
