# Backend foundation report

Date: 2026-07-25

## Phase checklist

- [x] Phase 0 — Audit and resume
- [x] Phase 1 — Finish and validate BE-PLT-001 through BE-PLT-007
- [ ] Phase 2 — BE-PLT-010 OpenAPI generation (blocked by dependency policy)
- [ ] Phase 3 — BE-PLT-011 health endpoint (implementation complete; OpenAPI documentation blocked with Phase 2)
- [x] Phase 4 — Audit and validate DB-001 through DB-004
- [x] Phase 5 — Implement DB-005 through DB-009
- [x] Phase 6 — Implement DB-010 through DB-013
- [x] Phase 7 — Implement DB-014 indexes and final constraints
- [ ] Phase 8 — DB-015 (command/documentation complete; genuine output and exports blocked by unavailable local database)
- [ ] Phase 9 — Full validation (API/root/database checks complete; unrelated root formatting remains blocked)

## Task status

| Task       | Status                                         | Evidence or remaining work                                                                                                                      |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-PLT-001 | Complete                                       | NestJS Express bootstrap, `/api` prefix, shutdown hooks, scripts and platform tests pass.                                                       |
| BE-PLT-002 | Complete                                       | Explicit reusable Zod pipe covers body/query/params, coercion, strict unknown fields and safe errors.                                           |
| BE-PLT-003 | Complete                                       | Shared environment parsing, injectable frozen config and configured-origin CORS are tested.                                                     |
| BE-PLT-004 | Complete                                       | Correlation middleware and stable exception filter cover HTTP, validation, database and unknown errors.                                         |
| BE-PLT-005 | Complete                                       | Pino JSON logging, correlation context and sensitive-value redaction have captured-output tests.                                                |
| BE-PLT-006 | Complete                                       | Server-only Supabase provider uses validated service-role configuration and a replaceable factory.                                              |
| BE-PLT-007 | Complete                                       | Typed/redacted database errors and explicit single-RPC atomic workflow pattern are tested.                                                      |
| BE-PLT-010 | Blocked                                        | Every Nest 11-compatible `@nestjs/swagger` release examined pulls `swagger-ui-dist` with blocked `@scarf/scarf@1.4.0` install telemetry.        |
| BE-PLT-011 | Implementation complete; documentation blocked | `GET /api/health` is public, time-bounded, mocked in tests, returns minimal `200` ready or redacted `503` non-ready output; OpenAPI is blocked. |
| DB-001     | Complete; verified twice                       | Historical migration matches current roles, named Auth FK, timestamps and RLS-without-policies.                                                 |
| DB-002     | Complete; verified twice                       | Historical migration matches program states, exact pools, slug/owner/deadline/contract constraints and RLS.                                     |
| DB-003     | Complete; verified twice                       | Historical migration matches asset types, ownership/deletion rules and RLS.                                                                     |
| DB-004     | Complete; verified twice                       | Historical migration matches severity values, exact reward ranges, uniqueness and RLS.                                                          |
| DB-005     | Complete; verified twice                       | Private reports, complete status/severity sets, hashes and exact optional rewards.                                                              |
| DB-006     | Complete; verified twice                       | Private bucket/path attachment metadata, safe MIME/size/path constraints and no URL column.                                                     |
| DB-007     | Complete; verified twice                       | Comments preserve author identity and use `deleted_at` soft deletion.                                                                           |
| DB-008     | Complete; verified twice                       | Review actions, current from/to states, reason rules and final transition checks.                                                               |
| DB-009     | Complete; verified twice                       | Structured success/error triage outcomes, confidence bounds and no credential column.                                                           |
| DB-010     | Complete; verified twice                       | Canonical chain/address/hash values, unique deployment identities and coherent deployment outcomes.                                             |
| DB-011     | Complete; verified twice                       | Exact chain amounts, report/contract links, status/block data and `NULLS NOT DISTINCT` event idempotency.                                       |
| DB-012     | Complete; verified twice                       | Notifications with safe types/read state and recursive private/secret metadata-key rejection.                                                   |
| DB-013     | Complete; verified twice                       | Append-only audit events, retained actors, safe identifiers and recursively redacted metadata.                                                  |
| DB-014     | Complete; verified twice                       | Access-pattern indexes, cross-program composite FKs, report/review/deployment/confirmation lifecycle constraints.                               |
| DB-015     | Partially complete; infrastructure blocked     | Version-pinned generate/stale-check commands and guidance exist; generated output, public exports and API import were not fabricated.           |

## Files changed by phase

- Phase 0: `docs/backend-foundation-report.md`.
- Phase 1: no functional platform rewrite was needed. Existing `apps/api/src/**` and `apps/api/test/**` files were normalized with the repository formatter during Phase 9.
- Phase 2: no net manifest/lockfile change. The failed `@nestjs/swagger` addition was cleanly removed and frozen install passes.
- Phase 3: `apps/api/src/app.module.ts`, `apps/api/src/health/**`, `apps/api/test/health.spec.ts`, and build output under `apps/api/dist/**`.
- Phase 4: audit decision and migration guidance in `packages/database/README.md`; DB-001 through DB-004 history was preserved.
- Phase 5: migrations `20260725000500` through `20260725000900`.
- Phase 6: migrations `20260725001000` through `20260725001300`.
- Phase 7: migration `20260725001400`, `tests/backend-foundation/**`, and `scripts/verify-migrations.mjs`.
- Phase 8: `packages/database/package.json`, `scripts/database-types.mjs`, and DB-015 guidance in the database README.
- Phase 9: formatting was applied only to allowed API/database/report paths. No deliberate edit was made outside the assignment allowlist.

The workspace has no `.git` directory, so a tracked-file diff and historical applied-migration state cannot be inspected.

## Dependencies and rationale

- No dependency remains added.
- Existing `pino` is retained for low-overhead structured JSON logs and native path redaction.
- `@nestjs/swagger@11.4.6` was attempted because it is the Nest-native document generator. Installation failed with `ERR_PNPM_IGNORED_BUILDS` for `@scarf/scarf@1.4.0`; approving or suppressing that script would bypass repository policy, so the package and lockfile changes were removed.
- DB-015 uses `pnpm dlx supabase@2.54.11` in the package-local script. The exact CLI version is pinned and its generated stdout is validated before any file write.
- `@electric-sql/pglite@0.5.4` was used transiently through `pnpm dlx` as a disposable local PostgreSQL runtime. It was not added to a manifest, and its temporary verifier was removed after the two fresh runs.

## Migration order

1. `20260725000100_db_001_profiles.sql`
2. `20260725000200_db_002_programs.sql`
3. `20260725000300_db_003_program_scopes.sql`
4. `20260725000400_db_004_program_reward_tiers.sql`
5. `20260725000500_db_005_reports.sql`
6. `20260725000600_db_006_report_attachments.sql`
7. `20260725000700_db_007_report_comments.sql`
8. `20260725000800_db_008_report_reviews.sql`
9. `20260725000900_db_009_ai_triage_results.sql`
10. `20260725001000_db_010_escrow_contracts.sql`
11. `20260725001100_db_011_escrow_transactions.sql`
12. `20260725001200_db_012_notifications.sql`
13. `20260725001300_db_013_audit_logs.sql`
14. `20260725001400_db_014_indexes_and_constraints.sql`

## Test coverage

- API: 9 Vitest files and 30 tests pass.
- Existing platform tests cover bootstrap, safe environment failures, strict CORS, Zod input behavior, stable errors, correlation IDs, captured-log redaction, mockable Supabase wiring, typed database errors and the atomic RPC pattern.
- Health tests use only a dependency test double and cover ready, rejected dependency and never-settling timeout cases.
- Database static test verifies the exact ordered migration list, one table/RLS/no-policy contract per DB-001 through DB-013 migration, forbidden persisted URL/credential columns, required DB-014 indexes and full-runner order.
- Transactional SQL verifies all tables, important columns/FKs/checks/indexes, RLS/no-policy state, valid fixtures, cross-program rejection, traversal rejection, transition/outcome checks, canonical chain data, event idempotency, nested secret metadata rejection and append-only audits. It passed against two independent fresh disposable local PostgreSQL instances.

## Validation results

| Command                                                 | Result                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                        | Pass                                                                                         |
| API `lint`, `typecheck`, `test`, `build`                | Pass; 30 tests                                                                               |
| Database `lint`, `test`                                 | Pass; 14 ordered migrations statically verified                                              |
| `pnpm lint`                                             | Pass                                                                                         |
| `pnpm typecheck`                                        | Pass                                                                                         |
| `pnpm test`                                             | Pass                                                                                         |
| `pnpm build`                                            | Pass                                                                                         |
| Targeted allowed-path Prettier check                    | Pass                                                                                         |
| `pnpm format:check`                                     | Fail only in 18 untouched, out-of-scope pre-existing files listed by the command             |
| `pnpm --filter @bug-bounty-escrow/database types:check` | Blocked: pinned CLI runs, then reports missing Docker/local Supabase                         |
| Apply/verify against two fresh disposable databases     | Pass through transient PGlite; all 14 migrations and transactional verification passed twice |
| Exact `psql`/Supabase-container parity run              | Blocked: no `psql`, Docker daemon, local Supabase or database URL exists                     |
| OpenAPI generate/check                                  | Blocked: required Nest Swagger dependency is rejected by repository install-script policy    |

The unrelated root formatting failures are:

`docs/development-setup.md`, `docs/foundation-validation.md`, `docs/tasks/ai.md`, `docs/tasks/assignments/thread-2-db-001-db-004.md`, `docs/tasks/assignments/thread-3-be-plt-001-be-plt-007.md`, `docs/tasks/backend.md`, `docs/tasks/blockchain-integration.md`, `docs/tasks/database-auth.md`, `docs/tasks/foundation.md`, `docs/tasks/frontend.md`, `docs/tasks/operations.md`, `docs/tasks/quality-demo.md`, `docs/tasks/README.md`, `docs/tasks/smart-contracts.md`, `pnpm-workspace.yaml`, `PROJECT_CONTEXT.md`, `tsconfig.base.json`, and `tsconfig.node.json`.

## Assumptions and known limitations

- DB-001 through DB-004 may already be applied outside this source snapshot. Because they satisfy the current contract, their history was not rewritten.
- PostgreSQL 15 or newer is required for `UNIQUE NULLS NOT DISTINCT`, matching current Supabase PostgreSQL baselines.
- Metadata key constraints are defense in depth. Application code must still use explicit metadata allowlists and never pass sensitive values under innocuous keys.
- The health check performs a bounded `HEAD`-style `profiles` query and exposes only `ready`/`not_ready`; it does not expose environment, connection, package or failure details.
- Authentication, authorization, RLS policies, storage policies, seeds, product APIs, frontend, contracts and AI providers remain out of scope.

## Exact next recommended task

Provision an approved Docker/local Supabase runtime, then run `packages/database/tests/backend-foundation/apply-and-verify.sql` against two fresh resets and execute `pnpm --filter @bug-bounty-escrow/database types:generate`; this will unblock genuine DB-015 types, public exports and the API import check without fabricating schema output.
