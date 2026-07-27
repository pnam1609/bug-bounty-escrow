# Thread 2 — FND-008 Environment schemas and examples

## Goal

Create separate, fail-fast environment validation contracts for the Next.js web app and NestJS API, plus safe example files containing no real credentials.

## Prerequisites

- `FND-006` is complete.
- `FND-009` is complete.
- This task may run concurrently with `Thread 3 — FND-007`.

## Allowed files

- `packages/shared/src/env/**`
- `packages/shared/src/index.ts`
- `.env.example`
- `apps/web/.env.example`
- `apps/api/.env.example`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of the environment modules, environment example files and the shared public entrypoint during this task.

## Do not modify

- Root `package.json`
- `pnpm-lock.yaml`
- `turbo.json`
- Any package manifest
- Existing shared constants, types, utilities or schemas outside `packages/shared/src/env/**`
- Application source files
- `packages/ui/**`
- `docs/**`

## Requirements

1. Create independent Zod schemas for web-public and API-server environments.
2. The web schema may expose only variables prefixed with `NEXT_PUBLIC_`.
3. Validate at least these web concerns:
   - NestJS API base URL
   - Supabase public URL and anonymous key
   - Arc chain ID and public RPC/explorer information
   - Public USDC address
4. Validate at least these API concerns:
   - Runtime mode, port and allowed web origin
   - Supabase URL, anonymous key and service-role key
   - Arc RPC URL, chain ID, USDC address and optional escrow-factory address
   - AI provider mode
   - Gemini key only when Gemini mode is selected
   - Log level
5. Export parse functions that accept an explicit input object; shared modules must not read `process.env` at import time.
6. Return typed, normalized environment objects.
7. Fail fast with useful variable names while never printing secret values.
8. Create root, web and API `.env.example` files with placeholders and comments.
9. Keep optional MVP services optional where the application has a documented fallback.

## Technical constraints

- Reuse Zod and address/URL primitives from `FND-006` where appropriate.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` or server RPC credentials through the web schema.
- Do not commit any working credential, token, wallet key or realistic secret-like value.
- Do not add a dependency or update the lockfile.
- Do not add framework bootstrap code; app-specific loading belongs to later FE/BE tasks.
- Do not use silent defaults for secrets, chain ID or production origins.

## Acceptance criteria

- A valid web environment parses into a typed public-only object.
- A valid API environment parses into a typed server object.
- Missing/invalid required variables fail with stable, redacted errors.
- Gemini mode requires a Gemini key; mock/disabled modes do not.
- Web parsing cannot return any server-only secret field.
- Example files contain every documented variable and no real credential.
- `@bug-bounty-escrow/shared` typechecks and lints successfully.
- No file outside the allowed list changes.

## Validation

Run package-scoped checks:

```text
pnpm --filter @bug-bounty-escrow/shared typecheck
pnpm --filter @bug-bounty-escrow/shared lint
```

Also inspect all changed example files for accidental secret-like values. Do not run a repo-wide formatter with `--write`.

## Deliverables

- Web and API environment schemas.
- Typed parse functions and public exports.
- Safe environment example files.
- Validation results.
- Changed-file summary.
- Assumptions and known limitations.
