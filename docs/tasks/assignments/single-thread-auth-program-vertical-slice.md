# Single thread — Auth, RLS and Program vertical slice

## Operating mode

This is a long-running, single-thread assignment.

- Use exactly one agent/thread.
- Do not spawn sub-agents or parallel implementation branches.
- Execute phases serially.
- Resume from current repository state and do not redo completed work.
- Continue after an individual task completes.
- Do not wait for external services; continue independent work and record blocked integration checks.
- Preserve unrelated user changes.

## Goal

Deliver the first usable vertical slice after the backend/database foundation:

```text
Supabase Auth contract and profile bootstrap
→ Profile/program RLS
→ NestJS authentication and authorization guards
→ Program list/create/detail/update APIs
→ Next.js public program list/detail UI
```

## Included task IDs

- Finish `BE-PLT-010` and OpenAPI documentation for `BE-PLT-011`.
- `AUTH-001` through `AUTH-004`.
- `RLS-001` and `RLS-002`.
- `BE-PLT-008` and `BE-PLT-009`.
- `BE-PRG-001` through `BE-PRG-004`.
- `FE-PLT-001` through `FE-PLT-004`.
- `FE-PRG-001` and `FE-PRG-002`.

Do not implement blockchain program actions, report workflows, AI, owner program UI, frontend login/onboarding UI or seed data.

## Prerequisites

- `docs/backend-foundation-report.md` exists.
- DB-001 through DB-014 are complete.
- BE-PLT-001 through BE-PLT-007 are complete.
- `GET /api/health` implementation is complete.
- No other thread is modifying the allowed paths.

## Allowed files

- `apps/api/**`
- `apps/web/**`
- `packages/database/**`
- `packages/shared/**`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `docs/program-vertical-slice-report.md`

Do not create or modify any other tracked file.

## Do not modify

- Root `package.json`
- `turbo.json`
- Root TypeScript, ESLint or Prettier configs
- `PROJECT_CONTEXT.md`
- `docs/tasks/**`
- `packages/domain/**`
- `packages/ui/**`
- Smart contract, blockchain or AI packages

## Dependency and build-script policy

1. Keep the 24-hour package release-age policy enabled.
2. Pin direct dependencies to explicit policy-compliant versions; do not use `latest`.
3. In `pnpm-workspace.yaml`, replace the existing Scarf placeholder with:

```yaml
allowBuilds:
  "@scarf/scarf": false
  esbuild: true
```

4. Denying `@scarf/scarf` must prevent its telemetry install script from running.
5. Do not approve any additional build script automatically.
6. If a new ignored-build dependency appears:
   - Identify why it is present.
   - Continue work that does not require it.
   - Record it for coordinator review.
7. Do not set `minimumReleaseAge: 0`, `trustLockfile: true` or a global allow-all build policy.

## Persistence rules

1. Maintain a phase/task checklist in `docs/program-vertical-slice-report.md`.
2. After completing a phase, immediately continue to the next phase.
3. Diagnose and fix in-scope failures.
4. Do not repeat an unchanged failed command.
5. After three materially different in-scope attempts fail for the same external reason, record that check as blocked and continue.
6. Stop only when all phases are complete or every remaining item requires real credentials, external infrastructure or user authority.

## Phase 0 — Audit and preflight

1. Read:
   - `PROJECT_CONTEXT.md`
   - `docs/backend-foundation-report.md`
   - `docs/tasks/backend.md`
   - `docs/tasks/frontend.md`
   - `docs/tasks/database-auth.md`
2. Inspect current API, web, shared and database files.
3. Confirm no other thread is writing allowed paths.
4. Normalize only the explicit Scarf decision described above.
5. Run:

```text
pnpm install
pnpm install --frozen-lockfile
```

6. Record the exact starting status and dependency-policy result.

## Phase 1 — Finish OpenAPI platform work

Complete `BE-PLT-010` and the documentation portion of `BE-PLT-011`.

Requirements:

1. Install a NestJS 11-compatible Swagger/OpenAPI package only after Scarf is explicitly denied.
2. Do not serve Swagger UI in production by default.
3. Generate a deterministic OpenAPI JSON document without starting a public listener.
4. Document:
   - Stable API error shape
   - Correlation header
   - `GET /api/health`
5. Add generate/check scripts to the API package.
6. Add tests proving the document is valid and contains no secret/config values.
7. Keep generated output under `apps/api/**`.

If the dependency still cannot be installed without running telemetry, remove the attempted dependency cleanly, record the blocker and continue Phase 2.

## Phase 2 — AUTH-001 to AUTH-004

### AUTH-001 — Supabase Auth contract/configuration

1. Document expected email/password Auth settings for local/staging/hosted environments inside the allowed report/database documentation.
2. Define exact redirect-origin rules; no wildcard production redirects.
3. Do not mutate a hosted Supabase project.
4. Add safe test fixtures for valid, expired, malformed and missing access tokens.
5. Keep real tokens and credentials out of source.

Hosted configuration verification may be recorded as blocked when credentials are unavailable.

### AUTH-002 — Profile bootstrap

Create a new forward migration that:

1. Creates a profile idempotently when an Auth user is created.
2. Defaults the application role to `researcher`.
3. Does not trust client metadata to assign `reviewer`.
4. Handles missing display name safely.
5. Does not expose Auth secrets.
6. Extends transactional migration verification.

Do not rewrite DB-001.

### AUTH-003 — Onboarding and role rules

Implement database rules/RPC needed to complete onboarding:

1. Authenticated users may choose only `researcher` or `owner`.
2. Users cannot self-assign `reviewer`.
3. Repeated onboarding is idempotent or returns a stable conflict.
4. Role changes are auditable without storing token contents.
5. Use a new forward migration and explicit `search_path`.
6. Test privilege-escalation attempts.

Do not add a frontend onboarding page in this assignment.

### AUTH-004 — Access-token/user contract

Add shared framework-neutral types/schemas for:

- Authenticated user ID.
- Authentication state.
- Application role loaded from `profiles`.
- Request principal used by NestJS guards.

Security rule:

- Trust the verified JWT for user identity.
- Load the application role from the database.
- Do not trust a role supplied in request body/query or unverified JWT metadata.

Export contracts through the shared public entrypoint and add type/schema tests using the existing package conventions.

## Phase 3 — RLS-001 and RLS-002

Create separate forward migrations for profile and program policies.

### RLS-001 — Profiles

1. User may read the profile fields required for the application according to the documented privacy contract.
2. User may update only safe fields of their own profile.
3. Client updates cannot change role or user ID.
4. Reviewer assignment remains server/admin controlled.
5. Service role behavior remains available for trusted backend operations.

### RLS-002 — Programs, scopes and reward tiers

1. Anonymous users may read only active public programs and their public scopes/tiers.
2. Owners may read their own non-public programs.
3. Owners may create/update only their own programs.
4. Owner ID cannot be reassigned by client update.
5. Scope/tier writes require ownership of the parent program.
6. Reviewer access must be explicit and must not expose unrelated private program data.

Add automated SQL security tests for:

- Anonymous user.
- Researcher.
- Owner of the program.
- Different owner.
- Reviewer.
- Service role/admin simulation.
- Role escalation and owner reassignment attempts.

Use disposable local PostgreSQL/PGlite verification when full Supabase is unavailable. Record exact Supabase parity checks that remain blocked.

## Phase 4 — BE-PLT-008 authentication guard

Implement a Supabase JWT authentication guard:

1. Parse Bearer tokens strictly.
2. Verify the token through the existing Supabase integration.
3. Reject missing, malformed, expired and invalid tokens with stable `401`.
4. Load the current profile/application role.
5. Attach a typed request principal.
6. Never log tokens or Auth responses containing sensitive fields.
7. Allow explicitly public routes through a reusable decorator/metadata contract.
8. Mock all network calls in tests.

## Phase 5 — BE-PLT-009 role and ownership authorization

Implement:

1. Reusable role decorator and guard.
2. Resource-ownership policy abstraction.
3. Program-owner authorization helper/guard.
4. Stable `403` behavior without leaking existence of inaccessible resources.
5. Tests for owner, researcher, reviewer, wrong owner, missing principal and forged role inputs.

Keep domain-specific database lookup in repositories/services, not decorators.

## Phase 6 — Shared Program API schemas

Add Zod request/query/response contracts for:

- Program list filters, pagination and sorting.
- Create program.
- Program ID params.
- Update program.
- Public program response with scopes and reward tiers.
- Paginated program-list response.

Requirements:

- Reuse domain status/severity/asset values without duplicating divergent literals.
- Monetary values remain canonical decimal strings.
- Create/update schemas are strict.
- Public responses contain no private owner/Auth/storage fields.
- Export schemas/types through `packages/shared`.

## Phase 7 — BE-PRG-001 to BE-PRG-004

Implement each endpoint as an independent controller method/service/repository path.

### BE-PRG-001

```text
GET /api/programs
```

- Public.
- Returns active programs only for anonymous callers.
- Validated filters, stable sorting and pagination.
- No private owner data.

### BE-PRG-002

```text
POST /api/programs
```

- Authenticated owner only.
- Creates program, scopes and reward tiers atomically through one PostgreSQL RPC.
- Slug uniqueness and reward/scope validation.
- Owner ID comes from verified principal.

### BE-PRG-003

```text
GET /api/programs/:id
```

- Public for active programs.
- Owner may read their own draft/non-public program.
- Unauthorized callers do not receive existence details.

### BE-PRG-004

```text
PATCH /api/programs/:id
```

- Authenticated owner of the program only.
- Strict partial update.
- Funded/immutable fields cannot be changed.
- Uses documented optimistic conflict behavior.

For every endpoint include:

- Thin controller.
- Application/domain service.
- Focused repository queries.
- Zod validation.
- Authorization.
- Stable errors.
- Happy path, validation, unauthenticated and unauthorized integration tests where applicable.

Do not implement deploy, fund or close endpoints.

## Phase 8 — FE-PLT-001 to FE-PLT-004

Bootstrap the public Next.js frontend foundation.

1. Use Next.js 15 App Router as specified by `PROJECT_CONTEXT.md`.
2. Pin exact policy-compliant Next.js/React versions; do not resolve a release younger than 24 hours.
3. Add package scripts for dev, build, lint, typecheck and test.
4. Configure environment loading through the existing shared web env schema.
5. Add the reusable UI package and base theme.
6. Create a typed NestJS API client using shared schemas.
7. Add TanStack Query provider and stable query-key factory.
8. Create shared loading, empty and error states required by the two public pages.
9. Do not add Supabase browser Auth, wallet or protected dashboard code.

Do not approve new dependency build scripts without explicit existing policy.

## Phase 9 — FE-PRG-001 and FE-PRG-002

### FE-PRG-001 — Public program listing

- Fetches only through NestJS API.
- URL-synchronized pagination/filter/sort.
- Responsive accessible program cards/table.
- Loading, empty and retryable error states.
- Links to program details.

### FE-PRG-002 — Public program detail

- Uses the typed API client.
- Displays status, pool, deadline, scopes and reward tiers.
- Does not render private fields.
- Handles not-found/error/loading states.
- Provides a disabled or explanatory report-submission CTA when Auth/report flow is not yet implemented.

Add focused frontend tests for API parsing and critical rendering/state behavior without requiring a live backend.

## Phase 10 — Validation and report

Run:

```text
pnpm install --frozen-lockfile
pnpm --filter @bug-bounty-escrow/shared lint
pnpm --filter @bug-bounty-escrow/shared typecheck
pnpm --filter @bug-bounty-escrow/api lint
pnpm --filter @bug-bounty-escrow/api typecheck
pnpm --filter @bug-bounty-escrow/api test
pnpm --filter @bug-bounty-escrow/api build
pnpm --filter @bug-bounty-escrow/web lint
pnpm --filter @bug-bounty-escrow/web typecheck
pnpm --filter @bug-bounty-escrow/web test
pnpm --filter @bug-bounty-escrow/web build
pnpm --filter @bug-bounty-escrow/database lint
pnpm --filter @bug-bounty-escrow/database test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database validation:

1. Apply all migrations in order to two fresh disposable databases.
2. Run schema and RLS security verification.
3. Record blocked Supabase-specific parity checks separately.

Do not run a repository-wide formatter with `--write`.

## Final report

Write `docs/program-vertical-slice-report.md` containing:

- Status for every included task ID.
- Migration order added by this task.
- Dependency and build-script decisions.
- API endpoint/test matrix.
- Frontend route/test matrix.
- Commands and pass/fail/blocked results.
- Exact external validation still requiring Supabase credentials/runtime.
- Files changed.
- Assumptions and known limitations.
- Exact next recommended task.

## Completion criteria

This assignment is complete only when:

- AUTH-001 through AUTH-004 are implemented as far as local authority permits.
- RLS-001 and RLS-002 migrations and security tests pass locally.
- BE-PLT-008 and BE-PLT-009 pass tests.
- BE-PRG-001 through BE-PRG-004 pass API tests.
- FE-PLT-001 through FE-PLT-004 are complete.
- Public program listing/detail pages build and pass focused tests.
- Frozen install and relevant package validations pass.
- Any remaining hosted Supabase/OpenAPI blocker is evidenced precisely.
- No out-of-scope report, blockchain, payment, AI or protected frontend workflow was added.
