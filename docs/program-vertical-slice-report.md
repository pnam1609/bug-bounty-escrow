# Auth and Program vertical slice report

Date: 2026-07-25

## Task checklist

- [x] BE-PLT-010 — deterministic OpenAPI generation/check
- [x] BE-PLT-011 — documented health endpoint
- [x] AUTH-001 — Auth configuration and exact redirect-origin contract
- [x] AUTH-002 — safe, idempotent profile bootstrap
- [x] AUTH-003 — auditable onboarding and role rules
- [x] AUTH-004 — shared principal/auth contracts and fixtures
- [x] RLS-001 — self-profile policies and safe update grants
- [x] RLS-002 — public/owner/reviewer program, scope, and tier policies
- [x] BE-PLT-008 — verified Supabase access-token guard
- [x] BE-PLT-009 — role and resource-ownership authorization
- [x] BE-PRG-001 — public program list
- [x] BE-PRG-002 — owner program creation
- [x] BE-PRG-003 — public/owner/reviewer program detail
- [x] BE-PRG-004 — conflict-aware owner program update
- [x] FE-PLT-001 — Next.js 15 App Router foundation
- [x] FE-PLT-002 — reusable theme and responsive shell
- [x] FE-PLT-003 — typed NestJS API client with response parsing
- [x] FE-PLT-004 — TanStack Query provider and stable keys
- [x] FE-PRG-001 — URL-synchronized public program list
- [x] FE-PRG-002 — public program detail

## Implementation result

- OpenAPI is generated listener-free at `apps/api/openapi.json`; generation and
  stale checks are deterministic and include the stable error shape, correlation
  header, and health contract. Swagger UI is not served.
- Auth identity comes from `auth.getUser(accessToken)`. Application role always
  comes from `profiles`, never the request body or unverified user metadata.
- Profile bootstrap defaults to `researcher`; onboarding permits only `owner` or
  `researcher`, is retry-safe, and writes an audit record.
- Program repositories use focused projections. Public callers see active programs
  only; private owner/reviewer access is enforced again by RLS.
- The public UI uses only NestJS program APIs. It includes search, sort, pagination,
  loading, empty, retryable error, detail, scopes, reward tiers, and responsive
  states.

## Migration order added by the vertical slice

1. `20260725001500_auth_profile_onboarding.sql`
2. `20260725001600_rls_001_profiles.sql`
3. `20260725001700_rls_002_programs.sql`

Later marathon migrations extend these policies without rewriting them.

## Dependency and lifecycle decisions

- `@nestjs/swagger@11.4.6` was pinned and installed after Scarf telemetry was
  explicitly denied.
- Next.js `15.5.9`, React/React DOM `19.2.8`, TanStack Query `5.90.21`, and
  Supabase JS `2.110.8` are exact direct versions.
- `minimumReleaseAge: 1440` remains active.
- `esbuild` is explicitly allowed; `@scarf/scarf` and optional `sharp` builds are
  explicitly denied. No new lifecycle script was auto-approved.

## Validation

- Frozen install: passed.
- Root lint/typecheck/test/build: passed.
- API: 17 files / 60 tests passed, including Auth HTTP integration and OpenAPI.
- Shared contracts: 4 tests passed.
- Web: 8 unit tests and 10 Playwright journeys passed.
- Database/Auth/RLS: 21 ordered migrations passed twice on fresh PGlite databases.
- In-scope Prettier check: passed.

Hosted Supabase Auth dashboard settings, redirect allowlists, PostgREST behavior,
and Storage parity remain unverified because no hosted credentials or project
authority were supplied. No hosted project was contacted.
