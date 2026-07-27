# Thread 2 — FND-010 Contributor setup guide

## Goal

Create a concise, reproducible contributor guide for installing, configuring, validating and running the current monorepo without inventing commands or exposing secrets.

## Prerequisites

- `FND-007` is complete.
- `FND-008` is complete.
- `FND-009` is complete.
- This task may run concurrently with `Thread 3 — FND-011`.

## Allowed files

- `README.md`
- `docs/development-setup.md`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of root `README.md` and `docs/development-setup.md`.

## Do not modify

- `PROJECT_CONTEXT.md`
- `docs/tasks/**`
- Any package/application source
- Any package manifest
- `pnpm-lock.yaml`
- Workspace, Turbo, TypeScript, ESLint or Prettier configs
- Environment example files

## Requirements

1. Create a short root README containing:
   - Product summary
   - Monorepo layout
   - Prerequisites
   - Quick-start commands
   - Links to `PROJECT_CONTEXT.md`, task backlog and detailed setup guide
2. Create `docs/development-setup.md` containing:
   - Supported Node.js and pnpm requirements based on repository configuration
   - Install steps using the committed package-manager version
   - Environment setup using the existing `.env.example` files
   - Root development, build, lint, typecheck, test and format-check commands
   - Package-filter examples for web, API, domain, shared and UI
   - Current limitations for apps/services not scaffolded yet
   - Common troubleshooting for frozen lockfile, Turbo cache, ports and missing env
3. Clearly distinguish commands that are currently runnable from commands planned for later tasks.
4. Include security warnings for service-role keys, Gemini keys and wallet private keys.
5. Use only relative repository links in the Markdown files.

## Technical constraints

- Read scripts and versions from the repository; do not guess them.
- Do not claim Supabase, Arc, Next.js or NestJS services run if they have not been scaffolded.
- Do not include real credentials or realistic secret-like placeholders.
- Do not recommend disabling validation, RLS or TLS to solve setup problems.
- Do not run commands that modify manifests, lockfiles or source files.
- Do not use a repo-wide formatter with `--write`.

## Acceptance criteria

- A new contributor can install dependencies and run every currently available validation command from the guide.
- All documented script names exist in the relevant package manifests.
- All relative links resolve to existing files, except links explicitly labeled as planned.
- Environment instructions map to the committed example files.
- Security-sensitive variables are described without exposing values.
- No file outside the allowed list changes.

## Validation

Perform read-only documentation checks:

```text
1. Verify every documented command against package.json files.
2. Verify every relative Markdown link resolves.
3. Verify referenced environment variable names exist in the example files.
4. Search the changed files for accidental credentials or private keys.
```

Do not run `format:check` while Thread 3 is active; the coordinator will run it after both assignments finish.

## Deliverables

- Root README.
- Detailed contributor setup guide.
- Link/command/environment verification results.
- Changed-file summary.
- Assumptions and known limitations.
