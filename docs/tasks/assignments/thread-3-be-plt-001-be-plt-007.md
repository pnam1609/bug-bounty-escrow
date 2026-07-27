# Thread 3 — BE-PLT-001 to BE-PLT-007 NestJS platform

## Goal

Bootstrap the NestJS API and implement its shared platform layer: global Zod validation, validated configuration and CORS, stable error handling, correlation IDs, redacted logging, Supabase server provider and repository infrastructure.

## Prerequisites

- Foundation Wave 5 is complete.
- Shared environment schemas, Zod primitives and API error contract are available.
- A frozen pnpm install succeeds under the active dependency-age/security policy.
- This assignment may run concurrently with `Thread 2 — DB-001 to DB-004`.

## Preflight gate

Before modifying files, run:

```text
pnpm install --frozen-lockfile
```

If this fails because of `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` or another repository-wide dependency-policy error, stop and report the task as blocked. Do not bypass the policy, downgrade unrelated root dependencies or regenerate the lockfile as a workaround.

## Included task IDs

| ID | Deliverable |
|---|---|
| BE-PLT-001 | NestJS API bootstrap |
| BE-PLT-002 | Global Zod validation pipe |
| BE-PLT-003 | Configuration, CORS and environment validation |
| BE-PLT-004 | Global exception filter and correlation ID |
| BE-PLT-005 | Structured logging and redaction |
| BE-PLT-006 | Supabase server-client provider |
| BE-PLT-007 | Repository base, database errors and atomic-operation pattern |

Do not implement BE-PLT-008 authentication, BE-PLT-009 authorization, health endpoints or product APIs in this assignment.

## Allowed files

- `apps/api/**`
- `pnpm-lock.yaml`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of `apps/api/**` and `pnpm-lock.yaml`.

## Do not modify

- Root `package.json`
- `turbo.json`
- Root tooling configs
- `packages/database/**`
- `packages/domain/**`
- `packages/shared/**`
- `apps/web/**`
- Other packages
- Existing task documentation

## BE-PLT-001 — NestJS bootstrap

1. Scaffold a NestJS application inside the existing `apps/api` workspace.
2. Preserve the package name `@bug-bounty-escrow/api`.
3. Use the standard HTTP adapter compatible with Supertest.
4. Configure global prefix `/api`.
5. Enable graceful shutdown.
6. Add package scripts for dev, build, lint, typecheck and test.
7. Use Vitest and Supertest for platform tests.
8. Do not add a product controller or `/health` endpoint.

## BE-PLT-002 — Global Zod validation

1. Implement a reusable NestJS pipe accepting an explicit Zod schema.
2. Support body, query and route-param validation.
3. Return HTTP `400` using the shared stable API error shape.
4. Include safe field paths/messages without echoing secret or report values.
5. Reject or strip unknown keys according to the supplied schema contract.
6. Add unit tests for success, coercion, unknown fields and invalid input.

Do not introduce `class-validator` DTOs alongside Zod.

## BE-PLT-003 — Configuration and CORS

1. Parse API environment input using the shared `parseApiEnvironment`.
2. Fail startup before listening when configuration is invalid.
3. Make validated config injectable without exposing raw `process.env`.
4. Allow only the configured web origin through CORS.
5. Configure allowed methods/headers needed by REST and correlation/idempotency headers.
6. Never log configuration values containing secrets.
7. Add tests for invalid env and disallowed origins.

## BE-PLT-004 — Errors and correlation IDs

1. Accept a valid incoming correlation header or generate a new safe ID.
2. Attach correlation ID to request context and response header.
3. Implement a global exception filter producing the shared API error shape.
4. Map known HTTP/validation/database errors to stable codes and statuses.
5. Return a generic `500` response for unknown errors without stack leakage.
6. Include correlation ID in error responses/log context.
7. Add tests for known and unknown exceptions.

## BE-PLT-005 — Logging redaction

1. Add structured request/application logging suitable for NestJS.
2. Redact at minimum:
   - Authorization and cookie headers
   - Supabase keys
   - Gemini key
   - Signed URLs
   - Report title/content/impact/reproduction fields
3. Avoid logging request/response bodies by default.
4. Bind correlation ID to request logs.
5. Configure log level from validated environment.
6. Add automated redaction tests using captured logger output.

Explain the structured-logger dependency choice in the completion summary.

## BE-PLT-006 — Supabase server provider

1. Create a NestJS database module/provider for a server-side Supabase client.
2. Source URL/service-role credentials only from the validated config provider.
3. Ensure the service-role key never appears in public exports, error payloads or logs.
4. Expose the client through a typed injection token.
5. Make the provider replaceable with a test double.
6. Add provider tests verifying config wiring without using real credentials or network calls.

Do not create browser Supabase clients or Auth guards in this task.

## BE-PLT-007 — Repository infrastructure

1. Create a small repository foundation around the injected Supabase client.
2. Normalize PostgREST/database failures into typed application-safe database errors.
3. Preserve safe constraint/error codes while redacting SQL, credentials and record content.
4. Provide a clear pattern for atomic operations:
   - Do not pretend multiple client calls are a transaction.
   - Require a dedicated PostgreSQL function/RPC for multi-write atomic workflows.
5. Keep repositories independent of HTTP controllers.
6. Avoid a generic CRUD repository that hides domain-specific queries.
7. Add unit tests using mocked Supabase responses for success, not-found, constraint and unknown errors.

## Dependency rules

- Reuse `@bug-bounty-escrow/shared` for env validation, headers, Zod primitives and API error types.
- Reuse `@bug-bounty-escrow/domain` only for domain types when needed.
- Add NestJS/backend dependencies only to `apps/api/package.json`.
- Use pnpm and update the lockfile.
- Do not add frontend, blockchain, AI-provider or ORM dependencies.
- Do not import migration SQL into application code.

## Acceptance criteria

- API starts with valid env and fails before listening with invalid env.
- Global prefix, CORS, correlation IDs, error responses and logging behave as specified.
- Zod validation produces the shared error shape.
- Captured logs prove required sensitive fields are redacted.
- Supabase provider is injectable and fully mockable without network access.
- Repository errors are typed/redacted and atomic multi-write guidance is explicit.
- Unit/platform tests cover each included BE-PLT task.
- Build, lint, typecheck and tests pass for `@bug-bounty-escrow/api`.
- No Auth guard, role guard, health route or product endpoint is introduced.
- No file outside the allowed list changes.

## Validation

Run API-scoped commands only:

```text
pnpm --filter @bug-bounty-escrow/api lint
pnpm --filter @bug-bounty-escrow/api typecheck
pnpm --filter @bug-bounty-escrow/api test
pnpm --filter @bug-bounty-escrow/api build
```

Also run a test bootstrap with safe fake environment values. Do not call real Supabase, Gemini or Arc services.

Do not run a repo-wide formatter with `--write`.

## Deliverables

- NestJS platform implementation and tests.
- Updated API manifest and lockfile.
- Per-task result for BE-PLT-001 through BE-PLT-007.
- Dependency rationale.
- Validation results.
- Changed-file summary, assumptions and known limitations.
