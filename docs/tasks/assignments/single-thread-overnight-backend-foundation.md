# Single thread overnight — Backend platform and complete database foundation

## Operating mode

This is a long-running, single-thread assignment intended to run unattended.

- Use exactly one agent/thread.
- Do not spawn sub-agents.
- Do not delegate or run parallel implementation branches.
- Execute phases serially in the order below.
- Do not stop after completing an individual task ID.
- Do not ask the user for routine implementation choices; inspect the repository and follow existing conventions.
- Do not wait or sleep for external state. Continue with the next independent phase.
- Preserve unrelated user changes.

## Goal

Bring the backend foundation to a stable, tested state by:

1. Finishing and validating BE-PLT-001 through BE-PLT-007.
2. Implementing BE-PLT-010 OpenAPI generation.
3. Implementing BE-PLT-011 `GET /api/health`.
4. Validating the existing DB-001 through DB-004 migrations.
5. Implementing DB-005 through DB-014 as separate ordered migrations.
6. Implementing DB-015 database type generation when a local database is available.
7. Running package-scoped and root integration validation.

Authentication guards, RLS policies, seed data, product APIs, frontend, smart contracts and AI providers are not part of this assignment.

## Execution gate

Do not begin while another thread is modifying `apps/api/**`, `packages/database/**` or `pnpm-lock.yaml`.

Before editing, run:

```text
pnpm install --frozen-lockfile
```

If dependency installation fails:

1. Diagnose the exact repository or supply-chain policy error.
2. Do not bypass a security policy.
3. Continue database migration work that requires no dependency change.
4. Mark dependency-requiring backend phases blocked.
5. Continue every other safe phase before considering the assignment finished.

## Allowed files

- `apps/api/**`
- `packages/database/**`
- `pnpm-lock.yaml`
- `docs/backend-foundation-report.md`

Do not create or modify any other tracked file.

## Do not modify

- Root `package.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- Root TypeScript, ESLint or Prettier configs
- `PROJECT_CONTEXT.md`
- `docs/tasks/**`
- `apps/web/**`
- `packages/domain/**`
- `packages/shared/**`
- `packages/ui/**`
- Smart contract, blockchain or AI packages

## Persistence rules

1. Maintain a checklist for every phase and task ID.
2. After finishing a phase, immediately start the next phase.
3. If validation fails, diagnose and fix it within the allowed files.
4. Do not rerun an unchanged failing command repeatedly.
5. After three materially different in-scope attempts fail for the same reason:
   - Record the blocker.
   - Continue all independent phases.
   - Return to the blocker once after later phases are complete.
6. A missing optional local service blocks only its integration check, not source implementation or mocked tests.
7. Stop only when:
   - All phases are complete; or
   - Every remaining item requires user authority, real credentials or unavailable external infrastructure.

## Phase 0 — Audit and resume

1. Read:
   - `PROJECT_CONTEXT.md`
   - `docs/tasks/backend.md`
   - `docs/tasks/database-auth.md`
   - `docs/tasks/assignments/thread-3-be-plt-001-be-plt-007.md`
   - `packages/database/README.md`
2. Inspect current `apps/api/**` and `packages/database/**`.
3. Determine which acceptance criteria are already satisfied.
4. Do not recreate or overwrite correct work.
5. Record the initial status of:
   - BE-PLT-001 through BE-PLT-007
   - DB-001 through DB-004
6. Create or update `docs/backend-foundation-report.md` with the checklist.

## Phase 1 — Finish BE-PLT-001 through BE-PLT-007

Execute the implementation requirements in:

```text
docs/tasks/assignments/thread-3-be-plt-001-be-plt-007.md
```

Required outcomes:

- NestJS bootstrap with `/api` prefix and graceful shutdown.
- Global reusable Zod validation pipe.
- Validated injectable API configuration and strict CORS.
- Stable API error response, correlation ID and exception filter.
- Structured logging with sensitive-data redaction tests.
- Mockable Supabase service-role provider.
- Typed/redacted database error mapping.
- Explicit PostgreSQL RPC pattern for atomic multi-write operations.

Do not implement Auth guards, role guards, health or product endpoints during this phase.

Run API lint, typecheck, tests and build before proceeding.

## Phase 2 — BE-PLT-010 OpenAPI generation

Implement OpenAPI support as a standalone platform task:

1. Add the NestJS Swagger/OpenAPI dependency to the API package only.
2. Generate a deterministic OpenAPI document without starting a public listener.
3. Document the shared API error shape and correlation header.
4. Ensure Zod-backed request contracts can be represented without creating duplicate validation DTOs.
5. Add an API package script that generates/checks the document.
6. Keep generated output under `apps/api/**`.
7. Add a test that detects an invalid or empty OpenAPI document.
8. Do not add product endpoints to make the document look populated.

Acceptance criteria:

- OpenAPI generation succeeds in test/CI mode.
- The document contains API metadata, server prefix and shared error/correlation definitions.
- Generation uses safe fake environment values.
- No real secret or host-specific absolute path appears in output.

## Phase 3 — BE-PLT-011 health endpoint

Implement exactly one endpoint:

```text
GET /api/health
```

Requirements:

1. The endpoint is public and does not require Auth.
2. Return a stable, minimal response containing service status and safe dependency readiness.
3. Do not return environment variables, connection strings, keys, stack traces or package inventory.
4. Dependency checks must be time-bounded.
5. A dependency failure returns the documented non-ready status without crashing the process.
6. Tests must mock dependencies; do not call real Supabase/Arc services.
7. Document the endpoint in generated OpenAPI.

Do not add `/live`, `/ready` or another health route in this task.

## Phase 4 — Validate DB-001 through DB-004

Inspect the existing core migrations without rewriting migration history.

Verify:

- `profiles`
- `programs`
- `program_scopes`
- `program_reward_tiers`
- Foreign keys and named constraints
- Exact monetary storage
- Current domain status/role/asset/severity values
- RLS enabled with no policies yet
- Core schema verification SQL

If a defect exists in an already-applied migration:

- Prefer a new forward corrective migration.
- Do not silently edit historical migrations unless the database work is explicitly confirmed to be local and unapplied.
- Record the decision in the database README and final report.

## Phase 5 — DB-005 through DB-009 report schema

Create one ordered migration per task ID.

### DB-005 — `reports`

- References program, researcher profile and affected scope.
- Matches every current report status and severity.
- Stores private report fields, content hash and optional final reward fields.
- Uses exact monetary storage and named constraints.
- Enables RLS without policies.

### DB-006 — `report_attachments`

- References report and uploader.
- Stores private bucket/path and safe metadata, never a public URL.
- Constrains size and required storage identifiers.
- Enables RLS without policies.

### DB-007 — `report_comments`

- References report and author.
- Stores comment body and timestamps.
- Supports the documented deletion strategy without losing audit identity.
- Enables RLS without policies.

### DB-008 — `report_reviews`

- References report and reviewer.
- Stores action, from/to state, reason and review metadata.
- Constrains actions/states to current domain values.
- Enables RLS without policies.

### DB-009 — `ai_triage_results`

- References report.
- Stores provider/model/schema version, structured result, confidence and safe error metadata.
- Never stores an API key.
- Enables RLS without policies.

Add or extend transactional schema-verification SQL for every migration.

## Phase 6 — DB-010 through DB-013 operational schema

Create one ordered migration per task ID.

### DB-010 — `escrow_contracts`

- References program.
- Stores chain ID, contract address, deployment transaction and deployment status.
- Enforces chain/address/hash formats and uniqueness where appropriate.
- Enables RLS without policies.

### DB-011 — `escrow_transactions`

- References program, optional report and escrow contract.
- Stores chain/hash/log identity, transaction type/status, token, exact amount and block data.
- Enforces idempotency using chain ID, transaction hash and log index where applicable.
- Enables RLS without policies.

### DB-012 — `notifications`

- References recipient.
- Stores type, read state, safe structured metadata and timestamps.
- Must not store report content or secrets in metadata.
- Enables RLS without policies.

### DB-013 — `audit_logs`

- Stores actor, action and entity reference with redacted metadata.
- Is append-oriented and does not store report content, signed URLs or secrets.
- Enables RLS without client-write policies.

Add or extend transactional schema-verification SQL for every migration.

## Phase 7 — DB-014 indexes and final constraints

Create a new forward migration; do not edit prior migrations merely to add indexes.

Add indexes for documented access patterns, including:

- Programs by owner/status/slug/deadline.
- Reports by program/researcher/status/submission time.
- Comments/reviews/attachments by report and time.
- Transactions by program/report/status/chain/hash.
- Notifications by recipient/read state/time.
- Audit logs by actor/entity/time.
- AI results by report/time.

Requirements:

- Do not create duplicate indexes already provided by primary/unique constraints.
- Add final cross-table/check constraints that do not require RLS policies.
- Document index rationale in `packages/database/README.md`.
- Verification SQL confirms important indexes and constraints exist.

## Phase 8 — DB-015 generated database types

1. Add a reproducible package-local type-generation command.
2. Generate database types from the migrated local database; do not hand-write generated output.
3. Export generated row/insert/update types through a database package public entrypoint.
4. Ensure API code can import database types without importing Supabase CLI/runtime tooling.
5. Add stale-generation guidance or a check suitable for later CI integration.

If no local database or approved generator is available:

- Implement the generation command and documentation if possible.
- Do not fabricate generated types.
- Mark only generated output/integration validation blocked.
- Continue to Phase 9.

## Phase 9 — Full validation and repair

Run:

```text
pnpm --filter @bug-bounty-escrow/api lint
pnpm --filter @bug-bounty-escrow/api typecheck
pnpm --filter @bug-bounty-escrow/api test
pnpm --filter @bug-bounty-escrow/api build
pnpm --filter @bug-bounty-escrow/database lint
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Database validation:

1. Apply every migration in order to a fresh disposable local database.
2. Run all schema verification SQL.
3. Reset the local database.
4. Apply and verify a second time.

Rules:

- Fix failures only within allowed files.
- Do not run a repo-wide formatter with `--write`.
- Do not weaken tests, types, lint, schema constraints or security controls to obtain a pass.
- Do not connect to staging or production.

## Final report

Complete `docs/backend-foundation-report.md` with:

- Status for each BE-PLT and DB task ID.
- Files changed by phase.
- Dependencies added and rationale.
- Commands run and pass/fail/blocked results.
- Migration order.
- Test coverage summary.
- Any unavailable local-service validation.
- Assumptions and known limitations.
- Exact next recommended task.

## Completion criteria

The assignment is complete only when:

- BE-PLT-001 through BE-PLT-007, BE-PLT-010 and BE-PLT-011 meet acceptance criteria.
- DB-001 through DB-014 are implemented and verified.
- DB-015 is complete or specifically blocked only by unavailable local generation infrastructure.
- API package validation passes.
- Root validation passes, or unrelated pre-existing failures are evidenced precisely.
- No out-of-scope product API, Auth policy, RLS policy, seed, frontend, contract or AI work was added.
- No tracked file outside the allowed list changed.
