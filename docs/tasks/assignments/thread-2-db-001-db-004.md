# Thread 2 — DB-001 to DB-004 Core database schema

## Goal

Create four ordered Supabase PostgreSQL migrations for profiles, programs, program scopes and reward tiers, with schema verification SQL. Do not implement RLS policies, seed data or application repositories.

## Prerequisites

- Foundation Wave 5 is complete.
- `FND-004` domain statuses and models are available.
- This assignment may run concurrently with `Thread 3 — BE-PLT-001 to BE-PLT-007`.

## Included task IDs

| ID | Deliverable |
|---|---|
| DB-001 | `profiles` migration |
| DB-002 | `programs` migration |
| DB-003 | `program_scopes` migration |
| DB-004 | `program_reward_tiers` migration |

Each ID must be implemented as a separate ordered migration file and reported separately in the completion summary.

## Allowed files

- `packages/database/migrations/**`
- `packages/database/tests/core-schema/**`
- `packages/database/README.md`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of the allowed database migration, verification and package-documentation paths.

## Do not modify

- `packages/database/package.json`
- `pnpm-lock.yaml`
- Root manifests or tooling configs
- `apps/api/**`
- Other application/package source
- `packages/domain/**`
- `packages/shared/**`
- Existing task documentation

## DB-001 — Profiles

Create a migration that:

1. Creates `public.profiles`.
2. Uses the Supabase Auth user UUID as the primary key and foreign key to `auth.users`.
3. Supports the domain roles `owner`, `researcher` and `reviewer`.
4. Uses a safe default role that cannot grant reviewer privileges.
5. Includes display name, optional wallet address, optional avatar URL and timestamps.
6. Constrains wallet addresses when present.
7. Provides a reusable `updated_at` trigger function if needed by later tables.
8. Enables RLS immediately, without adding policies in this assignment.

Do not create automatic reviewer assignment or an insecure client-controlled role trigger.

## DB-002 — Programs

Create a migration that:

1. Creates `public.programs`.
2. References the owner profile.
3. Supports all `ProgramStatus` values defined in `packages/domain`.
4. Includes name, unique normalized slug, description, total pool, remaining pool, optional contract address, optional deadline and timestamps.
5. Uses exact numeric storage suitable for six-decimal USDC values; do not use floating-point types.
6. Constrains pools to non-negative values and remaining pool not to exceed total pool.
7. Constrains an optional EVM contract address.
8. Enables RLS immediately, without policies.

## DB-003 — Program scopes

Create a migration that:

1. Creates `public.program_scopes`.
2. References `programs` with an explicitly justified delete behavior.
3. Supports `smart_contract`, `website`, `api` and `mobile` asset types.
4. Includes asset name, optional URL, optional contract address, in-scope flag, optional description and timestamps.
5. Constrains optional EVM addresses and non-empty asset names.
6. Enables RLS immediately, without policies.

## DB-004 — Program reward tiers

Create a migration that:

1. Creates `public.program_reward_tiers`.
2. References `programs` with an explicitly justified delete behavior.
3. Supports `critical`, `high`, `medium`, `low` and `informational`.
4. Stores min/max rewards as exact six-decimal values.
5. Constrains rewards to non-negative values and `min_reward <= max_reward`.
6. Allows only one row per program and severity.
7. Includes timestamps and enables RLS immediately, without policies.

## Cross-migration constraints

- Use deterministic chronological filenames so a fresh database applies DB-001 through DB-004 in order.
- Prefer check constraints over PostgreSQL enums unless there is a documented migration advantage.
- Name important foreign keys, unique constraints and check constraints for debuggable errors.
- Add only indexes required for primary/unique constraints in this assignment; broader query indexes belong to `DB-014`.
- Do not add RLS policies; those belong to `RLS-001` and `RLS-002`.
- Do not create seed users/data.
- Do not store private keys, access tokens or report content.
- Every migration must work on a clean Supabase PostgreSQL database.

## Schema verification

Add read-only/transactional SQL checks under `packages/database/tests/core-schema/**` that verify:

- All four tables exist in `public`.
- Required columns, types, defaults and nullability are present.
- Foreign keys point to the intended tables.
- Role/status/asset/severity checks contain every current domain value.
- Pool and reward constraints reject invalid values.
- Unique slug and unique program/severity constraints exist.
- RLS is enabled on all four tables.

Verification SQL must not leave data behind.

## Acceptance criteria

- Four separate migrations map cleanly to DB-001, DB-002, DB-003 and DB-004.
- A fresh database applies all migrations in order without manual edits.
- Schema verification passes against the migrated database.
- Rollback/re-apply strategy is documented in `packages/database/README.md`.
- Domain values match `packages/domain` exactly at implementation time.
- No RLS policy, seed data or backend code is introduced.
- No file outside the allowed list changes.

## Validation

Run the available database checks without installing dependencies or changing the lockfile:

```text
1. Apply all migrations to a fresh local Supabase/PostgreSQL database.
2. Run the core-schema verification SQL.
3. Run the available PostgreSQL/Supabase SQL lint command.
4. Reset and re-apply once to prove ordering.
```

If a local database CLI is not available, report those checks as blocked with the exact missing prerequisite. Do not modify manifests or install a global tool.

## Deliverables

- Four ordered migration files.
- Core-schema verification SQL.
- Database migration/readme notes.
- Per-task result for DB-001, DB-002, DB-003 and DB-004.
- Validation results.
- Changed-file summary, assumptions and known limitations.
