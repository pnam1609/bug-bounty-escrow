# Thread 3 — FND-005 Shared constants, utility types and pure utilities

## Goal

Implement the framework-neutral shared package for cross-cutting constants, generic utility types and small pure utilities. Domain models and Zod schemas are explicitly out of scope.

## Prerequisites

- `FND-002` is complete.
- `FND-003` is complete.
- This task may run concurrently with `Thread 2 — FND-004`.

## Allowed files

- `packages/shared/**`

Do not create or modify any file outside this directory.

## Exclusive ownership

This thread has exclusive write ownership of `packages/shared/**` for the duration of the task.

## Do not modify

- Root `package.json`
- `pnpm-lock.yaml`
- Root TypeScript, ESLint or Prettier configs
- `packages/domain/**`
- `packages/database/**`
- `apps/**`
- `docs/**`

## Requirements

1. Create a public package entrypoint.
2. Add generic API utility types that do not duplicate domain models:
   - Pagination input/output metadata
   - Typed success response wrapper
   - Stable API error shape
   - Nullable/optional helper types only when they add real value
3. Add shared, environment-independent constants:
   - Default and maximum page size
   - Safe upload MIME types and maximum upload-size constant
   - Correlation/idempotency header names
4. Add small pure utilities:
   - Page/limit normalization
   - Exhaustive-check helper
   - Safe slug normalization
   - Non-empty string guard
5. Organize exports through explicit public entrypoints; do not expose internal paths accidentally.
6. Add package-local TypeScript configuration extending the root base config.
7. Add package scripts needed for build/typecheck/lint without changing root files.

## Technical constraints

- No dependency on React, Next.js, NestJS, Supabase, viem or Zod.
- Do not define Program, Report, Severity, role or state-transition types; those belong to `packages/domain`.
- Do not create Zod schemas; those belong to `FND-006`.
- Do not read `process.env` or include environment-specific URLs, chain IDs or secrets.
- Utilities must be pure and deterministic.
- Avoid a generic `utils.ts` dumping ground; group files by responsibility.
- Do not add dependencies or run a package-manager install.

## Acceptance criteria

- Public exports work without deep imports.
- Pagination normalization enforces the documented default and maximum values.
- Slug normalization is deterministic for supported ASCII input and documents unsupported cases.
- Shared constants contain no environment-specific value or secret.
- The package compiles independently with strict TypeScript settings.
- No file outside `packages/shared/**` changes.

## Validation

Run:

```text
pnpm --filter @bug-bounty-escrow/shared typecheck
pnpm --filter @bug-bounty-escrow/shared lint
```

If the package script names differ from the completed tooling setup, use the equivalent read-only validation command and explain the difference.

Do not run a repo-wide formatter with `--write`.

## Deliverables

- Shared source files and public entrypoint.
- Package-local TypeScript configuration and scripts.
- Validation results.
- Changed-file summary.
- Assumptions and known limitations.
