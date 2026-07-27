# Single thread — Off-chain MVP marathon

## Operating mode

This is a large, unattended, single-thread assignment.

- Use exactly one agent/thread.
- Do not spawn sub-agents.
- Do not delegate or run parallel implementation branches.
- Execute phases serially and continue immediately after each task.
- Resume correct existing work; do not recreate completed phases.
- Do not wait for external services. Continue independent phases and record precise blockers.
- Preserve unrelated user changes.

## Goal

Deliver the complete off-chain MVP:

```text
Auth and onboarding
→ Program browse/create/update
→ Private report submission and attachments
→ Researcher submission dashboard
→ Owner/reviewer inbox and manual review
→ Reward approval without payout
→ Seed/demo data
→ End-to-end and security tests
```

Blockchain deployment/funding/payout, smart contracts, AI triage and production deployment are explicitly out of scope.

## Task inventory

This assignment contains more than 60 independently tracked task IDs.

### Foundation vertical slice

- Every task in `single-thread-auth-program-vertical-slice.md`.
- `BE-AUTH-001` and `BE-AUTH-002`.

### Database security and demo

- `RLS-003`, `RLS-004`, `RLS-006`.
- `STO-001`, `STO-002`, `STO-003`.
- `SEED-001`, `SEED-002`, `SEED-003`, `SEED-005`.

### Report and collaboration backend

- `BE-RPT-001` through `BE-RPT-004`.
- `BE-RPT-006` through `BE-RPT-010`.
- `BE-ATT-001`, `BE-ATT-002`.
- `BE-CMT-001`, `BE-CMT-002`.

`BE-RPT-005` AI triage and `BE-RPT-011` payout are excluded.

### Frontend platform and Auth

- `FE-PLT-005` through `FE-PLT-007`.
- `FE-AUTH-001` through `FE-AUTH-004`.
- `FE-PRG-003` through `FE-PRG-005`.

### Researcher and reviewer frontend

- `FE-RPT-001` through `FE-RPT-008`.
- `FE-REV-001`, `FE-REV-002`.
- `FE-REV-004` through `FE-REV-008`.

AI triage and payout UI are excluded.

### Quality, security and demo

- `QA-001`, `QA-002`, `QA-003`.
- `QA-E2E-001` through `QA-E2E-008`.
- `SEC-001` through `SEC-004`.
- `SEC-006`, `SEC-007`.
- `DEMO-001`, `DEMO-002`, `DEMO-004`.

## Prerequisites

- Backend/database foundation assignment is complete.
- No other thread is modifying any allowed path.
- Supply-chain settings have explicit decisions for every current ignored build.

## Allowed files

- `apps/api/**`
- `apps/web/**`
- `packages/database/**`
- `packages/shared/**`
- `packages/ui/**`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `docs/program-vertical-slice-report.md`
- `docs/offchain-mvp-report.md`

Do not create or modify any other tracked file.

## Do not modify

- Root `package.json`
- `turbo.json`
- Root TypeScript, ESLint or Prettier configs
- `PROJECT_CONTEXT.md`
- `docs/tasks/**`
- `packages/domain/**`
- `packages/contracts/**`
- `packages/blockchain/**`
- `packages/ai/**`

## Supply-chain policy

1. Keep `minimumReleaseAge` protection active.
2. Pin new direct dependencies to explicit versions old enough to pass policy.
3. Keep `esbuild` explicitly approved.
4. Keep `@scarf/scarf` explicitly denied.
5. Do not approve any new lifecycle script automatically.
6. Do not set `minimumReleaseAge: 0`, `trustLockfile: true` or allow all builds.
7. If installation is blocked, continue all phases that require no new dependency.

## Persistence rules

1. Maintain a task-ID checklist in `docs/offchain-mvp-report.md`.
2. Do not stop after a child assignment or phase completes.
3. Diagnose and fix failures within allowed files.
4. Never rerun an unchanged failed command repeatedly.
5. After three materially different attempts fail for the same external reason:
   - Record the blocker.
   - Continue every independent phase.
   - Retry once after later phases finish.
6. Missing hosted Supabase credentials block only hosted parity checks.
7. Stop only when every task is complete or every remaining item requires unavailable infrastructure, new authority or real credentials.

## Phase 0 — Audit

1. Read all project context and relevant backlog files.
2. Read `docs/backend-foundation-report.md`.
3. Inspect current source, migrations, tests and dependency policy.
4. Create `docs/offchain-mvp-report.md`.
5. Record status for every task ID in this assignment.
6. Do not redo work already satisfying acceptance criteria.

## Phase 1 — Auth and Program vertical slice

Execute every unfinished phase in:

```text
docs/tasks/assignments/single-thread-auth-program-vertical-slice.md
```

Do not stop when that child assignment completes. Copy its final task statuses into the off-chain MVP report and continue Phase 2.

## Phase 2 — Current-user APIs

### BE-AUTH-001

Implement:

```text
GET /api/me
```

Requirements:

- Protected by the verified Supabase Auth guard.
- Returns user ID, safe profile fields, application role and onboarding state.
- Never returns access/refresh token, password/Auth metadata, service key or internal Supabase response.
- Stable `401` for missing/invalid principal.
- Controller, service, repository and integration tests remain separate.

### BE-AUTH-002

Implement:

```text
PATCH /api/me/onboarding
```

Requirements:

- Strict Zod input.
- Only `owner` or `researcher` can be selected.
- `reviewer` self-assignment is rejected.
- Uses the onboarding database RPC created by AUTH-003.
- Retry is idempotent or returns the documented stable conflict.
- Includes privilege-escalation and forged-principal tests.

Add shared request/response schemas and public exports.

## Phase 3 — Report and collaboration RLS

### RLS-003

Create forward policies for `reports` and `report_attachments`:

- Researcher sees and mutates only their own report in allowed states.
- Owner/reviewer sees reports only for permitted programs.
- Report content is never public.
- Attachment metadata inherits report access.
- Client cannot rewrite researcher/program ownership.

### RLS-004

Create forward policies for:

- `report_comments`
- `report_reviews`
- `ai_triage_results`

Enforce role/action separation and inherit visibility from the parent report.

### RLS-006

Create an automated authorization matrix covering:

- Anonymous.
- Researcher owner/non-owner of report.
- Program owner and different owner.
- Reviewer.
- Service role simulation.
- Cross-program access.
- State-restricted writes.

Run against disposable local databases. Record exact Supabase parity checks still blocked.

## Phase 4 — Private Storage

### STO-001

- Create/configure a private `report-attachments` bucket through migration/config source.
- Add explicit MIME and size limits.
- Never make the bucket public.

### STO-002

- Add storage policies derived from report access.
- Prevent cross-report paths and path traversal.
- Require server-generated canonical object paths.

### STO-003

- Implement a dry-run-first orphan cleanup service/command.
- Never delete an attachment still referenced by the database.
- Require explicit environment and execution flags for mutation.
- Test dry-run, expiry and referenced-object behavior with mocks.

Do not call a hosted Storage project without explicit credentials/authority.

## Phase 5 — Shared Report API contracts

Create strict Zod schemas and inferred types for:

- Report list filters/pagination.
- Create report.
- Report ID params.
- Editable report update.
- Request information.
- Validate report with final severity.
- Reject report with reason.
- Mark duplicate with original report ID.
- Approve reward with canonical monetary string.
- Attachment upload/download URL contracts.
- Comment list/create.
- Safe report list/detail responses.

Rules:

- Reuse domain status/severity values.
- Never include storage service paths/keys in public response types.
- Report content must not enter error/telemetry metadata.
- State-transition request schemas remain separate.

## Phase 6 — Report backend read/write APIs

Implement independently:

- `BE-RPT-001` — `GET /api/reports`.
- `BE-RPT-002` — `POST /api/programs/:id/reports`.
- `BE-RPT-003` — `GET /api/reports/:id`.
- `BE-RPT-004` — `PATCH /api/reports/:id`.

Requirements:

- Thin controllers.
- Domain/application services own state rules.
- Repositories use focused projections.
- Role/resource authorization at both API and RLS layers.
- Content hash is deterministic and does not log content.
- Pagination and filters are stable.
- Tests cover happy path, validation, anonymous, wrong role and wrong owner.

## Phase 7 — Attachment and Comment APIs

Implement independently:

- `BE-ATT-001` — create short-lived upload URL.
- `BE-ATT-002` — create short-lived download URL.
- `BE-CMT-001` — list comments.
- `BE-CMT-002` — add comment.

Security requirements:

- Check report authorization before Storage operations.
- Generate canonical paths server-side.
- Never log signed URLs or private paths.
- Validate MIME, size and attachment/report relation.
- Comment author comes from principal.
- Notification failure cannot duplicate the comment mutation.

Use mocked Supabase Storage in tests.

## Phase 8 — Manual review backend APIs

Implement independently:

- `BE-RPT-006` — request information.
- `BE-RPT-007` — validate.
- `BE-RPT-008` — reject.
- `BE-RPT-009` — mark duplicate.
- `BE-RPT-010` — approve reward.

Requirements:

- One atomic PostgreSQL RPC per state-changing workflow.
- Validate current/next state with domain transitions.
- Write review/audit/notification records atomically where required.
- Duplicate target must be same program, not self and not cyclic.
- Reward must match tier/range and remaining pool.
- Approval never triggers payout.
- Concurrency, retry and invalid-transition tests.

## Phase 9 — Frontend Auth and protected platform

Implement:

- `FE-PLT-005` Supabase browser Auth session provider.
- `FE-PLT-006` role-aware route protection.
- `FE-PLT-007` shared loading/empty/error/confirmation UI.
- `FE-AUTH-001` login.
- `FE-AUTH-002` registration.
- `FE-AUTH-003` onboarding.
- `FE-AUTH-004` logout.

Rules:

- Supabase browser client is used only for Auth session operations.
- Application/profile data uses NestJS APIs.
- Service-role key never reaches the browser.
- Logout clears private query cache.
- Safe return URLs; no open redirects.
- Reviewer option never appears in onboarding.

## Phase 10 — Owner Program UI

Implement:

- `FE-PRG-003` owner program list.
- `FE-PRG-004` create-program form.
- `FE-PRG-005` edit-program form.

Include scopes/reward tiers, strict shared validation, conflict handling, role protection and all loading/empty/error states.

Do not add deploy, fund or close actions.

## Phase 11 — Researcher Report UI

Implement:

- `FE-RPT-001` report form.
- `FE-RPT-002` private attachment upload.
- `FE-RPT-003` researcher submissions list.
- `FE-RPT-004` report detail.
- `FE-RPT-005` eligible report edit.
- `FE-RPT-006` private attachment download.
- `FE-RPT-007` comment thread.
- `FE-RPT-008` add comment.

Rules:

- No report content in browser logs/analytics.
- Upload/download URLs are obtained only when needed and not persisted.
- Autosave is local and does not expose data to third parties.
- Every page has loading, empty, error and unauthorized states.

## Phase 12 — Owner/Reviewer Manual Review UI

Implement:

- `FE-REV-001` report inbox.
- `FE-REV-002` review detail.
- `FE-REV-004` request information.
- `FE-REV-005` validate.
- `FE-REV-006` reject.
- `FE-REV-007` mark duplicate.
- `FE-REV-008` approve reward.

Do not implement AI triage or payout UI.

Every mutation must:

- Require explicit user confirmation when destructive/state-changing.
- Prevent double submission.
- Invalidate only relevant query keys.
- Display stable API errors without report content leakage.

## Phase 13 — Demo seed and reset

Implement:

- `SEED-001` demo users/profiles.
- `SEED-002` programs/scopes/reward tiers.
- `SEED-003` reports/comments/reviews.
- `SEED-005` idempotent seed/reset command.
- `DEMO-001` guarded demo reset.
- `DEMO-002` safe demo-mode indicator/config.
- `DEMO-004` public-data provenance note.

Rules:

- Local/demo only.
- Reset requires environment guard and explicit confirmation.
- No production credentials.
- No private exploit data.
- Seed content is rewritten and labeled as demo data based on public disclosures.

## Phase 14 — Test infrastructure and E2E

Implement:

- `QA-001` deterministic unit/integration fixtures.
- `QA-002` Playwright role fixtures.
- `QA-003` local database lifecycle.
- `QA-E2E-001` public browse.
- `QA-E2E-002` register/login/onboard/logout.
- `QA-E2E-003` owner create/edit program.
- `QA-E2E-004` researcher submit report.
- `QA-E2E-005` researcher manage report.
- `QA-E2E-006` request information.
- `QA-E2E-007` validate/reject/duplicate.
- `QA-E2E-008` reward approval without payout.

E2E tests must be independent, reset their own state and never require production services.

## Phase 15 — Security and resilience

Implement:

- `SEC-001` API authorization matrix.
- `SEC-002` report confidentiality.
- `SEC-003` attachment security.
- `SEC-004` log/telemetry leakage.
- `SEC-006` dependency/secret scan configuration within allowed files.
- `SEC-007` rate limiting for sensitive endpoints.

Required negative cases:

- Cross-user and cross-program reads.
- Forged role/owner IDs.
- Expired token.
- Path traversal and cross-report attachment.
- Oversized/invalid MIME.
- Report content, signed URL and token leakage.
- Rate-limit bypass attempts through untrusted headers.

## Phase 16 — Full validation and repair

Run:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

Also run:

- API integration tests.
- Web unit/component tests.
- Database migration and RLS tests on two fresh disposable databases.
- Playwright off-chain journeys.
- Secret/dependency scan.

Rules:

- Fix in-scope failures.
- Do not use a repo-wide formatter with `--write`.
- Do not weaken tests, RLS, validation or security controls.
- Record hosted Supabase parity checks separately if unavailable.

## Final report

Complete `docs/offchain-mvp-report.md` with:

- Status of every task ID.
- Migration and RLS policy order.
- API endpoint matrix.
- Frontend route matrix.
- Unit/integration/E2E/security results.
- Dependencies and build-script decisions.
- Blocked external parity checks.
- Files changed.
- Assumptions and known limitations.
- Exact next recommended smart-contract/blockchain task.

## Completion criteria

This assignment is complete only when:

- The Auth/Program child assignment is complete or its external-only blockers are recorded.
- Current-user, Program, Report, Attachment, Comment and manual-review APIs pass tests.
- Auth/profile/program/report RLS tests pass locally.
- Private Storage behavior is implemented and mocked tests pass.
- Public, owner, researcher and reviewer UI flows build and pass focused tests.
- Off-chain E2E journeys pass locally, or only external runtime parity is precisely blocked.
- Reward approval does not trigger payout.
- No smart contract, blockchain settlement, AI provider or production deployment work was added.
- No tracked file outside the allowed list changed.
