# Thread 3 — FND-009 Root scripts and Turbo task graph

## Goal

Normalize root workspace scripts and complete the Turbo task graph, cache behavior and task ordering without touching package source, manifests or the lockfile.

## Prerequisites

- `FND-002` is complete.
- `FND-003` is complete.
- This task may run concurrently with `Thread 2 — FND-006`.

## Allowed files

- `package.json`
- `turbo.json`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of root `package.json` and `turbo.json`.

## Do not modify

- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- Any workspace package manifest
- Root TypeScript, ESLint or Prettier configs
- `apps/**`
- `packages/**`
- `docs/**`

## Requirements

1. Preserve existing package identity, `private`, package-manager and dependency fields.
2. Ensure root scripts exist for:
   - `dev`
   - `build`
   - `lint`
   - `typecheck`
   - `test`
   - `format`
   - `format:check`
3. Root orchestration scripts must delegate workspace work through Turbo where appropriate.
4. Configure the Turbo `dev` task as persistent and uncached.
5. Configure build dependencies and outputs for Next.js, NestJS/packages and generated artifacts.
6. Configure test coverage outputs without caching secrets or environment files.
7. Ensure lint, typecheck and test respect upstream package dependencies.
8. Avoid unnecessary cache misses caused by broad global dependencies.
9. Do not add, remove or upgrade any dependency.

## Technical constraints

- Use valid Turbo 2 configuration.
- Do not add a root `clean` script that recursively deletes broad directories.
- Do not place secrets or environment values in `turbo.json`.
- Do not add app-specific commands before the app scaffolding tasks define them.
- Do not run `pnpm install`; this thread does not own the lockfile.
- Do not run repo-wide tasks that could race with source files being written by Thread 2.

## Acceptance criteria

- Root scripts are present and keep the commands established by completed tasks.
- `turbo.json` passes schema validation.
- Turbo dry-run shows correct dependency ordering for build, lint, typecheck and test.
- `dev` is persistent and uncached.
- Build/test outputs are scoped and do not include secret-bearing files.
- No dependency field changes.
- No file outside `package.json` and `turbo.json` changes.

## Validation

Run dry-run/read-only checks:

```text
pnpm turbo run build --dry=json
pnpm turbo run lint --dry=json
pnpm turbo run typecheck --dry=json
pnpm turbo run test --dry=json
```

Do not run `pnpm install`, a repo-wide formatter with `--write`, or full root tasks while Thread 2 is active.

## Deliverables

- Updated root scripts.
- Updated Turbo task graph and cache settings.
- Dry-run validation results.
- Changed-file summary.
- Assumptions and known limitations.
