# Thread 2 — FND-004 Domain types and state enums

## Goal

Implement the framework-neutral domain package containing the core types, status values and state-transition definitions used by both NestJS and Next.js.

## Prerequisites

- `FND-002` is complete.
- `FND-003` is complete.
- This task may run concurrently with `Thread 3 — FND-005`.

## Allowed files

- `packages/domain/**`

Do not create or modify any file outside this directory.

## Exclusive ownership

This thread has exclusive write ownership of `packages/domain/**` for the duration of the task.

## Do not modify

- Root `package.json`
- `pnpm-lock.yaml`
- Root TypeScript, ESLint or Prettier configs
- `packages/shared/**`
- `packages/database/**`
- `apps/**`
- `docs/**`

## Requirements

1. Create a public package entrypoint.
2. Define the `ProgramStatus` values:
   - `draft`
   - `awaiting_funding`
   - `active`
   - `paused`
   - `expired`
   - `closed`
3. Define the `ReportStatus` values:
   - `draft`
   - `submitted`
   - `triaged`
   - `needs_information`
   - `rejected`
   - `duplicate`
   - `validated`
   - `reward_approved`
   - `payment_pending`
   - `paid`
4. Define `Severity`, `AssetType` and user-role values from `PROJECT_CONTEXT.md`.
5. Define framework-neutral types for:
   - `BountyProgram`
   - `ProgramScope`
   - `RewardTier`
   - `VulnerabilityReport`
   - User/profile identity
   - Escrow transaction summary
6. Define allowed report state transitions as domain data or pure functions.
7. Define allowed program state transitions as domain data or pure functions.
8. Export all public domain values and types from the package entrypoint.
9. Add package-local TypeScript configuration extending the root base config.
10. Add package scripts needed for build/typecheck/lint without changing root files.

## Technical constraints

- No dependency on React, Next.js, NestJS, Supabase, viem or Zod.
- Do not use TypeScript `enum`; prefer immutable value arrays/objects with inferred union types.
- Monetary values must remain strings at the domain boundary.
- IDs remain strings; do not introduce database-specific branded IDs yet.
- State-transition helpers must be pure and deterministic.
- Do not put API DTOs or database row types in this package.
- Do not add dependencies or run a package-manager install.

## Acceptance criteria

- All required domain values and types are exported from the public entrypoint.
- Invalid status/severity/role literals fail TypeScript compilation.
- Transition helpers accept documented transitions and reject invalid transitions.
- The package compiles independently with strict TypeScript settings.
- Importing the package does not load a framework or environment-specific module.
- No file outside `packages/domain/**` changes.

## Validation

Run:

```text
pnpm --filter @bug-bounty-escrow/domain typecheck
pnpm --filter @bug-bounty-escrow/domain lint
```

If the package script names differ from the completed tooling setup, use the equivalent read-only validation command and explain the difference.

Do not run a repo-wide formatter with `--write`.

## Deliverables

- Domain source files and public entrypoint.
- Package-local TypeScript configuration and scripts.
- Validation results.
- Changed-file summary.
- Assumptions and known limitations.
