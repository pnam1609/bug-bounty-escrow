# Thread 3 — FND-003 Lint and formatting configuration

## Goal

Create shared ESLint and Prettier tooling, install all root tooling dependencies needed by FND-002/FND-003, and add lint scripts without editing TypeScript configuration files.

## Prerequisite

- `FND-001` is complete.
- This task may run concurrently with `Thread 2 — FND-002`.

## Allowed files

- `package.json`
- `pnpm-lock.yaml`
- `apps/api/package.json`
- `apps/web/package.json`
- `packages/ai/package.json`
- `packages/blockchain/package.json`
- `packages/contracts/package.json`
- `packages/database/package.json`
- `packages/domain/package.json`
- `packages/shared/package.json`
- `packages/ui/package.json`
- `eslint.config.mjs`
- `prettier.config.mjs`
- `.prettierignore`

Do not create or modify any other file.

## Do not modify

- `tsconfig.base.json`
- `tsconfig.node.json`
- `tsconfig.nextjs.json`
- `pnpm-workspace.yaml`
- `turbo.json`
- `.gitignore`
- Application or package source files
- `docs/**`

## Requirements

1. Use ESLint flat config.
2. Configure ESLint for JavaScript and TypeScript without adding Next.js- or NestJS-specific rules before those apps are scaffolded.
3. Configure Prettier and a matching ignore file.
4. Add root tooling dependencies using pnpm, including TypeScript and Node types required to validate Thread 2.
5. Add `lint` scripts to workspace package manifests so the existing root Turbo lint command performs real work.
6. Add root `format` and `format:check` scripts.
7. Preserve all existing package names, versions, privacy settings and root scripts.
8. Explain every new dependency in the completion summary.

## Technical constraints

- Keep tooling dependencies in the root `devDependencies`.
- Do not add runtime dependencies.
- Do not add framework-specific plugins yet.
- Do not run a repo-wide formatter with `--write`; it could modify files owned by Thread 2.
- Do not edit TypeScript configs even if lint validation suggests a config change.

## Acceptance criteria

- `pnpm install --lockfile-only=false` completes and the lockfile is current.
- ESLint flat config loads successfully.
- `pnpm lint` invokes a real lint task for every current workspace.
- `pnpm format:check` checks formatting without modifying files.
- Existing build/typecheck/test scripts remain present.
- No file outside the allowed list changes.

## Validation

Run:

```text
pnpm lint
pnpm format:check
pnpm exec eslint eslint.config.mjs
```

If `format:check` reports pre-existing files from FND-001, report them. Do not fix files outside the allowed list.

## Deliverables

- ESLint flat config.
- Prettier config and ignore file.
- Updated manifests and lockfile.
- Validation results.
- Dependency rationale.
- Changed-file summary and known limitations.
