# Thread 2 — FND-002 Base TypeScript configuration

## Goal

Create strict reusable TypeScript configurations for shared code, Node.js/NestJS and Next.js without editing dependency manifests or lint/format files.

## Prerequisite

- `FND-001` is complete.
- This task may run concurrently with `Thread 3 — FND-003`.

## Allowed files

- `tsconfig.base.json`
- `tsconfig.node.json`
- `tsconfig.nextjs.json`

Do not create or modify any other file.

## Do not modify

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `turbo.json`
- `apps/**`
- `packages/**`
- `eslint.config.*`
- `prettier.config.*`
- `.prettierignore`
- `docs/**`

## Requirements

1. Create `tsconfig.base.json` with framework-neutral strict compiler options.
2. Create `tsconfig.node.json` extending the base config for Node.js/NestJS code.
3. Create `tsconfig.nextjs.json` extending the base config for Next.js code.
4. Keep DOM/JSX-specific options out of the framework-neutral base config.
5. Keep Node-specific module/types options out of the Next.js config.
6. Do not add path aliases before the package entrypoints are defined.
7. Do not run a package-manager install; Thread 3 exclusively owns manifests and the lockfile.

## Technical constraints

- Enable strict type checking.
- Use a modern target compatible with the planned Next.js and NestJS apps.
- Prefer `noEmit` for application type checking.
- Preserve framework-generated behavior where Next.js is expected to control compilation.
- Do not weaken checks merely to make an empty workspace pass.

## Acceptance criteria

- All three files are valid JSON.
- Both specialized configs successfully extend `tsconfig.base.json`.
- The resolved Node config contains Node-appropriate module resolution.
- The resolved Next.js config contains JSX/DOM and bundler-appropriate settings.
- No file outside the allowed list changes.

## Validation

Run read-only validation only:

```text
1. Parse all three files as JSON.
2. If TypeScript is already available, run:
   pnpm exec tsc -p tsconfig.node.json --showConfig
   pnpm exec tsc -p tsconfig.nextjs.json --showConfig
3. If TypeScript is still being installed by Thread 3, report the two tsc checks
   as pending for the coordinator instead of modifying package.json.
```

Do not run a repo-wide formatter with `--write`.

## Deliverables

- Three TypeScript config files.
- Validation result.
- Changed-file summary.
- Assumptions and pending integration checks.
