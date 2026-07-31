# Off-chain MVP marathon report

Date: 2026-07-25

All assignment task IDs are complete locally. Hosted Supabase parity checks and one
pre-existing repository-wide formatting failure are recorded separately and do
not require changes inside the assignment's allowed paths.

## Task-ID checklist

### Foundation vertical slice

- [x] BE-PLT-010
- [x] BE-PLT-011 documentation
- [x] AUTH-001
- [x] AUTH-002
- [x] AUTH-003
- [x] AUTH-004
- [x] RLS-001
- [x] RLS-002
- [x] BE-PLT-008
- [x] BE-PLT-009
- [x] BE-PRG-001
- [x] BE-PRG-002
- [x] BE-PRG-003
- [x] BE-PRG-004
- [x] FE-PLT-001
- [x] FE-PLT-002
- [x] FE-PLT-003
- [x] FE-PLT-004
- [x] FE-PRG-001
- [x] FE-PRG-002

### Current user, database security, and storage

- [x] BE-AUTH-001
- [x] BE-AUTH-002
- [x] RLS-003
- [x] RLS-004
- [x] RLS-006
- [x] STO-001
- [x] STO-002
- [x] STO-003

### Report and collaboration backend

- [x] BE-RPT-001
- [x] BE-RPT-002
- [x] BE-RPT-003
- [x] BE-RPT-004
- [x] BE-RPT-006
- [x] BE-RPT-007
- [x] BE-RPT-008
- [x] BE-RPT-009
- [x] BE-RPT-010
- [x] BE-ATT-001
- [x] BE-ATT-002
- [x] BE-CMT-001
- [x] BE-CMT-002

### Frontend platform, Auth, and owner programs

- [x] FE-PLT-005
- [x] FE-PLT-006
- [x] FE-PLT-007
- [x] FE-AUTH-001
- [x] FE-AUTH-002
- [x] FE-AUTH-003
- [x] FE-AUTH-004
- [x] FE-PRG-003
- [x] FE-PRG-004
- [x] FE-PRG-005

### Researcher and reviewer frontend

- [x] FE-RPT-001
- [x] FE-RPT-002
- [x] FE-RPT-003
- [x] FE-RPT-004
- [x] FE-RPT-005
- [x] FE-RPT-006
- [x] FE-RPT-007
- [x] FE-RPT-008
- [x] FE-REV-001
- [x] FE-REV-002
- [x] FE-REV-004
- [x] FE-REV-005
- [x] FE-REV-006
- [x] FE-REV-007
- [x] FE-REV-008

### Seed, quality, security, and demo

- [x] SEED-001
- [x] SEED-002
- [x] SEED-003
- [x] SEED-005
- [x] QA-001
- [x] QA-002
- [x] QA-003
- [x] QA-E2E-001
- [x] QA-E2E-002
- [x] QA-E2E-003
- [x] QA-E2E-004
- [x] QA-E2E-005
- [x] QA-E2E-006
- [x] QA-E2E-007
- [x] QA-E2E-008
- [x] SEC-001
- [x] SEC-002
- [x] SEC-003
- [x] SEC-004
- [x] SEC-006
- [x] SEC-007
- [x] DEMO-001
- [x] DEMO-002
- [x] DEMO-004

## Migration and policy order

| Order | Migration                                         | Result                                                                       |
| ----: | ------------------------------------------------- | ---------------------------------------------------------------------------- |
|  1–14 | Existing `DB-001` through `DB-014` foundation     | Preserved                                                                    |
|    15 | `20260725001500_auth_profile_onboarding.sql`      | Safe profile trigger and onboarding RPC                                      |
|    16 | `20260725001600_rls_001_profiles.sql`             | Self-profile RLS and column grants                                           |
|    17 | `20260725001700_rls_002_programs.sql`             | Public, owner, and assigned-reviewer program policies                        |
|    18 | `20260725001800_rls_003_reports.sql`              | Private report and attachment-metadata policies                              |
|    19 | `20260725001900_rls_004_report_collaboration.sql` | Comment/review/AI visibility and write separation                            |
|    20 | `20260725002000_storage_report_attachments.sql`   | Private bucket, MIME/size limits, canonical object policies                  |
|    21 | `20260725002100_offchain_atomic_rpcs.sql`         | Atomic program, submission, comment, attachment, and manual-review workflows |

Every migration is forward-only. Static verification requires exactly 21 ordered
migrations. The disposable verifier applies the full sequence twice on separate
fresh databases.

## API endpoint matrix

| Method | Route                                                     | Authorization                                       |
| ------ | --------------------------------------------------------- | --------------------------------------------------- |
| GET    | `/api/health`                                             | Public, not rate limited                            |
| GET    | `/api/me`                                                 | Verified user                                       |
| PATCH  | `/api/me/onboarding`                                      | Verified user; owner/researcher input only          |
| GET    | `/api/programs`                                           | Public active programs; optional owner context      |
| POST   | `/api/programs`                                           | Owner                                               |
| GET    | `/api/programs/:slug`                                     | Public active or authorized owner/reviewer          |
| GET    | `/api/owner/programs/:id`                                 | Owning owner                                        |
| PATCH  | `/api/programs/:id`                                       | Owning owner                                        |
| GET    | `/api/reports`                                            | Researcher own or owner/reviewer permitted programs |
| POST   | `/api/programs/:id/reports`                               | Researcher                                          |
| GET    | `/api/reports/:id`                                        | Report participant                                  |
| PATCH  | `/api/reports/:id`                                        | Owning researcher in eligible state                 |
| POST   | `/api/reports/:id/attachments/upload-url`                 | Authorized participant; strict MIME/size/name       |
| GET    | `/api/reports/:id/attachments/:attachmentId/download-url` | Authorized participant and exact relation           |
| GET    | `/api/reports/:id/comments`                               | Report participant                                  |
| POST   | `/api/reports/:id/comments`                               | Report participant; author from principal           |
| POST   | `/api/reports/:id/request-information`                    | Permitted owner/reviewer                            |
| POST   | `/api/reports/:id/validate`                               | Permitted owner/reviewer                            |
| POST   | `/api/reports/:id/reject`                                 | Permitted owner/reviewer                            |
| POST   | `/api/reports/:id/mark-duplicate`                         | Permitted owner/reviewer                            |
| POST   | `/api/reports/:id/approve-reward`                         | **Legacy `410 Gone`**; not an owner/reviewer mutation |
| POST   | `/api/reports/:id/pay`                                    | **Legacy `410 Gone`**; not an owner/reviewer mutation |
| POST   | `/api/reports/:id/confirm-payment`                        | **Legacy `410 Gone`**; not an owner/reviewer mutation |
| POST   | `/api/reports/:id/reward-settlement-intents`              | Owner only; durable intent and atomic reservation    |
| GET    | `/api/reports/:id/reward-settlement-intents/current`      | Owner only; current durable intent                   |
| POST   | `/api/reports/:id/reward-settlement-intents/:intentId/approval-observations` | Owner only; persist wallet approval evidence |
| POST   | `/api/reports/:id/reward-settlement-intents/:intentId/reconcile` | Owner only; reconcile evidence/relay          |
| POST   | `/api/reports/:id/reward-settlement-intents/:intentId/cancel` | Owner only; cancel before submission             |

Sensitive state-changing endpoints use verified-user, route-scoped fixed-window
limits and return `429` with `Retry-After`. Spoofed forwarding headers do not
change the key. Health remains unaffected.

## Frontend route matrix

| Route                       | Outcome                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `/programs`                 | Public URL-synchronized browse/search/sort/pagination           |
| `/programs/[slug]`          | Public scopes, tiers, pool, deadline, and report CTA            |
| `/login`                    | Supabase email/password login with safe return URL              |
| `/register`                 | Supabase registration                                           |
| `/onboarding`               | Owner/researcher selection; reviewer omitted                    |
| `/logout`                   | Auth logout plus private TanStack Query cache clear             |
| `/owner/programs`           | Protected owner list                                            |
| `/owner/programs/new`       | Strict shared-schema create form                                |
| `/owner/programs/[id]/edit` | Conflict-aware edit form                                        |
| `/reports/new`              | Private report, local-only autosave, ephemeral upload URL       |
| `/reports`                  | Researcher submission dashboard                                 |
| `/reports/[id]`             | Private detail/edit/download/comment workflow                   |
| `/review`                   | Owner/reviewer inbox                                            |
| `/review/[id]`              | Confirmed manual review transitions; settlement intent is owner-only |

All pages have loading/error/unauthorized handling; collection pages include empty
states. Signed URLs are requested only at action time and are never cached.

## Demo data and lifecycle

- Three deterministic role identities: owner, researcher, reviewer.
- Shared local-only password: `local-demo-password`.
- Nine programs with varied statuses; scopes and all five severity tiers.
- Thirty-six synthetic reports across major states, 36 comments, and 30 reviews.
- Narratives are rewritten synthetic summaries inspired by common public
  disclosure patterns. They contain no private exploit or production data.
- `demo:reset` requires `DEMO_ENV`, exact confirmation
  `RESET_OFFCHAIN_DEMO`, and an explicit PGlite path.
- The reset was run twice in each of two fresh verification passes; entity counts
  remained stable.
- `NEXT_PUBLIC_DEMO_MODE=true` displays a visible synthetic-data banner.

## Validation results

| Check                                             | Result                          |
| ------------------------------------------------- | ------------------------------- |
| `pnpm install --frozen-lockfile`                  | Passed                          |
| `pnpm lint`                                       | Passed, 9 packages              |
| `pnpm typecheck`                                  | Passed                          |
| `pnpm test`                                       | Passed                          |
| `pnpm build`                                      | Passed; API plus 14 Next routes |
| API Vitest                                        | 17 files, 60 tests passed       |
| Shared-contract Vitest                            | 1 file, 4 tests passed          |
| Web Vitest                                        | 2 files, 8 tests passed         |
| Database migration/RLS/workflow verification      | 21 migrations, two fresh passes |
| Playwright                                        | 10 independent journeys passed  |
| OpenAPI stale/secret check                        | Passed                          |
| Configured secret scan                            | Passed                          |
| Production dependency audit at critical threshold | Passed; no critical findings    |
| In-scope Prettier check                           | Passed                          |

`pnpm format:check` still reports 18 pre-existing out-of-scope files:
`PROJECT_CONTEXT.md`, root TypeScript configs, `docs/tasks/**`,
`docs/development-setup.md`, and `docs/foundation-validation.md`. The assignment
explicitly forbids modifying the first groups and does not allow the two unrelated
docs, so they were preserved.

The production audit reports 29 non-critical advisories: 2 low, 12 moderate, and
15 high. The configured acceptance threshold is critical, so the command exits
successfully; remediation should be planned independently rather than bypassing the
minimum-release-age policy.

## Supply-chain decisions

- `minimumReleaseAge: 1440` is active in `pnpm-workspace.yaml`.
- Explicit build decisions: `esbuild: true`, `@scarf/scarf: false`,
  `sharp: false`.
- No lifecycle script was automatically approved.
- Exact added direct versions include:
  - `@nestjs/swagger@11.4.6`
  - `@electric-sql/pglite@0.5.4`
  - `next@15.5.9`, `react@19.2.8`, `react-dom@19.2.8`
  - `@supabase/supabase-js@2.110.8`
  - `@tanstack/react-query@5.90.21`
  - `@playwright/test@1.58.2`, `vitest@4.1.10`
  - `zod@4.4.3`, `bcryptjs@3.0.2`, `prettier@3.9.6`

## Security evidence

- Auth tests cover missing, malformed, expired, invalid, and forged-role tokens.
- API and database matrices cover anonymous, own/other researcher, owning/different
  owner, assigned reviewer, service role, cross-program access, and state writes.
- Attachment tests cover traversal, invalid MIME, oversize, cross-report denial,
  canonical server paths, signed-URL redaction, and cleanup dry-run/reference rules.
- Atomic workflow verification covers retries, invalid state, self/cross-program
  duplicate rules, tier/pool bounds, review records, and no escrow transaction on
  approval.
- Captured logs verify tokens, cookies, keys, report content, private paths, and
  signed URLs are absent.

## External parity checks not performed

No hosted Supabase credentials or project authority were supplied. Therefore these
checks remain external-only:

- Hosted Auth provider settings and exact redirect allowlist.
- Hosted PostgREST behavior for the new RLS/RPC surface.
- Hosted private Storage bucket and signed upload/download behavior.
- Hosted service-role/API integration.

Browser E2E uses isolated deterministic Auth/API/Storage fixtures. The Nest API,
repository boundaries, PostgreSQL migrations/RLS/RPCs, and Storage mocks are tested
separately. A real Supabase local/hosted parity run remains the final environment
check when an authorized project is available.

## Files changed

- `apps/api/**`: Auth, guards, current-user, program, report, collaboration,
  Storage cleanup, rate limiting, OpenAPI, and 17 test files.
- `apps/web/**`: Next platform, Auth provider, protected routes, all public/owner/
  researcher/reviewer pages, unit tests, Playwright fixtures/journeys.
- `packages/database/**`: migrations 15–21, RLS/workflow verification, deterministic
  seed/reset harness, and documentation.
- `packages/shared/**`: Auth/program/report contracts, fixtures, tests, and scans.
- `packages/ui/**`: reused existing theme/components; no new product dependency.
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`: policy and exact dependencies.
- `docs/program-vertical-slice-report.md`, `docs/offchain-mvp-report.md`.

No smart-contract, blockchain settlement, AI-provider, payout, or production
deployment work was added.

The three report settlement routes retained by the off-chain API are historical compatibility
surfaces only: `POST /api/reports/:id/approve-reward`, `/pay`, and `/confirm-payment` return
`410 Gone` with `reward_settlement_flow_required`. They must not be presented as current
owner/reviewer mutations. Current settlement uses the owner-only durable intent routes above;
AI triage is advisory and never creates, approves, pays, or confirms settlement.

## Assumptions and known limitations

- The API is the sole application-data boundary; the browser uses Supabase only for
  Auth session operations.
- Rate-limit state is process-local. A horizontally scaled production API should
  replace it with an approved shared store and an explicit trusted-proxy policy.
- PGlite supplies deterministic PostgreSQL authorization/workflow verification but
  is not a substitute for final Supabase PostgREST/Auth/Storage parity.
- Owner scope/tier editing uses strict JSON-array form fields. It is functional and
  fully validated but can be replaced later with a richer dynamic form.

## Exact next recommended blockchain task

Start **SC-001 — finalize escrow invariants, roles, state machine, invalid
transitions, and threat assumptions**. Do not begin deployment or payout work until
SC-001 is reviewed; it is the dependency root for the contract implementation and
keeps the now-complete off-chain reward approval separate from token movement.
