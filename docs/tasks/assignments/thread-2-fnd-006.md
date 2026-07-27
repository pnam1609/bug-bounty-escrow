# Thread 2 — FND-006 Shared Zod schema foundation

## Goal

Add Zod to the shared package and implement the reusable schema primitives that later API endpoint tasks will compose into request and response contracts.

## Prerequisites

- `FND-004` is complete.
- `FND-005` is complete.
- This task may run concurrently with `Thread 3 — FND-009`.

## Allowed files

- `packages/shared/package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/schemas/**`
- `pnpm-lock.yaml`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of:

- `packages/shared/package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/schemas/**`
- `pnpm-lock.yaml`

## Do not modify

- Root `package.json`
- `turbo.json`
- Root TypeScript, ESLint or Prettier configs
- Existing files under `packages/shared/src/constants/**`
- Existing files under `packages/shared/src/types/**`
- Existing files under `packages/shared/src/utils/**`
- `packages/domain/**`
- `packages/ui/**`
- `apps/**`
- `docs/**`

## Requirements

1. Add Zod as a runtime dependency of `@bug-bounty-escrow/shared` using pnpm.
2. Create reusable schemas for:
   - UUID/string identifiers
   - EVM address
   - Transaction hash
   - Non-negative decimal monetary string
   - ISO date-time string
   - Pagination page and limit
   - Non-empty trimmed text
   - Idempotency key
3. Create shared pagination query and pagination metadata schemas.
4. Create the stable API error-response schema matching the shared TypeScript error shape from `FND-005`.
5. Infer TypeScript types from schemas when a schema is the source of truth.
6. Export schemas and inferred types through the shared public entrypoint.
7. Keep endpoint-specific Program, Report, Comment and Transaction DTO schemas out of this foundation task; their endpoint tasks will compose these primitives.

## Technical constraints

- Do not duplicate status, severity, role or state-transition values from `packages/domain`.
- Do not use permissive `z.any()` or unbounded `z.unknown()` for known fields.
- Do not coerce money into JavaScript `number`.
- Normalize only when normalization cannot change security meaning.
- Schema modules must not read environment variables.
- Adding Zod and updating the lockfile are the only dependency changes allowed.
- Do not modify root scripts or Turbo configuration; those belong to Thread 3.

## Acceptance criteria

- Valid identifiers, addresses, hashes, monetary strings, dates and pagination values parse successfully.
- Invalid/negative/scientific-notation monetary values are rejected unless explicitly documented.
- Pagination applies the shared default and maximum page-size constants.
- API error schema matches the existing shared TypeScript contract.
- All schemas are available from the package public entrypoint.
- `@bug-bounty-escrow/shared` typechecks and lints successfully.
- No file outside the allowed list changes.

## Validation

Run package-scoped checks only:

```text
pnpm --filter @bug-bounty-escrow/shared typecheck
pnpm --filter @bug-bounty-escrow/shared lint
```

Do not run root-wide Turbo tasks while Thread 3 is editing root task configuration. Do not run a repo-wide formatter with `--write`.

## Deliverables

- Zod dependency and updated lockfile.
- Shared schema primitives and public exports.
- Validation results.
- Dependency rationale.
- Changed-file summary.
- Assumptions and known limitations.
