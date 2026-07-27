# Thread 3 — FND-011 Foundation integration validation

## Goal

Run a read-only integration audit of the completed Foundation work and record reproducible evidence without fixing failures or modifying implementation/configuration files.

## Prerequisites

- `FND-004` is complete.
- `FND-005` is complete.
- `FND-006` is complete.
- `FND-007` is complete.
- `FND-008` is complete.
- `FND-009` is complete.
- This task may run concurrently with `Thread 2 — FND-010`.

## Allowed files

- `docs/foundation-validation.md`

Do not create or modify any other tracked file.

## Exclusive ownership

This thread has exclusive write ownership of `docs/foundation-validation.md`. All other repository files are read-only.

## Do not modify

- `README.md`
- `docs/development-setup.md`
- `PROJECT_CONTEXT.md`
- `docs/tasks/**`
- Any source or test file
- Any package manifest
- `pnpm-lock.yaml`
- Any workspace/tooling configuration
- Any environment example file

## Requirements

1. Verify installation reproducibility with the frozen lockfile.
2. Inventory every workspace package and its available scripts.
3. Verify the package dependency graph has no forbidden direction:
   - Domain must remain framework-independent.
   - Shared must not depend on web/API frameworks.
   - UI must not import application code.
   - Apps/packages must not use undeclared deep imports.
4. Run root lint, typecheck, test and build commands.
5. Run Turbo dry-runs and record the task graph summary.
6. Verify environment examples contain no obvious real credentials.
7. Verify service-role/Gemini/private-key variable names are absent from web-public parsing output.
8. Check that each workspace public entrypoint resolves as declared.
9. Record pass, fail, skipped or blocked for every check.
10. For every failure, record:
    - Exact command
    - Concise output/error
    - Likely owning task/file
    - Recommended follow-up task
11. Do not repair any failure in this assignment.

## Technical constraints

- Use `pnpm install --frozen-lockfile`; do not update dependencies.
- Generated caches, `node_modules` and build output may change as ignored artifacts, but no tracked implementation file may change.
- Do not run a formatter with `--write`.
- Do not run `format:check` while Thread 2 is writing documentation; leave it to the coordinator after both assignments finish.
- Never include secret values or full environment contents in the report.

## Acceptance criteria

- `docs/foundation-validation.md` identifies the repository revision/state being checked.
- Every required command has a recorded status and concise evidence.
- Package-boundary and public-entrypoint checks are documented.
- Failures are reported rather than silently fixed.
- The report contains no secrets or vulnerability content.
- No tracked file outside the allowed list changes.

## Validation commands

Run:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm turbo run build --dry=json
pnpm turbo run lint --dry=json
pnpm turbo run typecheck --dry=json
pnpm turbo run test --dry=json
```

If a command fails, continue with checks that do not depend on that failure and record the result.

## Deliverables

- Foundation validation report.
- Command result matrix.
- Package-boundary findings.
- Follow-up task recommendations for failures.
- Confirmation that no tracked implementation/configuration file was modified.
