# Thread 3 — FND-007 UI package and base theme

## Goal

Create a small reusable React UI package with framework-neutral design tokens, accessible base primitives and a theme stylesheet, without committing the project to Mantine or shadcn/ui yet.

## Prerequisites

- `FND-002` is complete.
- `FND-003` is complete.
- `FND-009` is complete.
- This task may run concurrently with `Thread 2 — FND-008`.

## Allowed files

- `packages/ui/**`
- `pnpm-lock.yaml`

Do not create or modify any other file.

## Exclusive ownership

This thread has exclusive write ownership of `packages/ui/**` and `pnpm-lock.yaml` for the duration of the task.

## Do not modify

- Root `package.json`
- `turbo.json`
- Root TypeScript, ESLint or Prettier configs
- `apps/**`
- `packages/shared/**`
- `packages/domain/**`
- Other package directories
- `docs/**`

## Requirements

1. Configure `@bug-bounty-escrow/ui` as a typed React package.
2. Declare React and React DOM as peer dependencies and add only the development dependencies needed to typecheck locally.
3. Create framework-neutral design tokens for:
   - Color roles
   - Typography scale
   - Spacing
   - Radius
   - Shadow
   - Focus ring
4. Create a theme stylesheet using CSS custom properties.
5. Implement only these accessible base primitives:
   - `Button`
   - `Card`
   - `StatusBadge`
6. Support `className`, refs and standard HTML attributes without using `any`.
7. Include visible keyboard focus and disabled/loading semantics for `Button`.
8. Ensure `StatusBadge` does not rely on color alone to communicate status.
9. Export components and theme tokens through explicit public entrypoints.
10. Expose the theme stylesheet through the package export map.
11. Add package-local build/typecheck/lint scripts and TypeScript configuration.

## Technical constraints

- Do not install Mantine, Tailwind, shadcn/ui, Radix or a CSS-in-JS library in this task.
- Do not create application layouts, dashboards or feature-specific components.
- Do not import Next.js or NestJS.
- Components must work in a normal React application.
- Avoid blockchain/security-specific status logic; accept presentation-safe variants only.
- Use pnpm for dependency changes and update only the UI package manifest plus lockfile.
- Do not run a repo-wide formatter with `--write`.

## Acceptance criteria

- The UI package builds/typechecks without importing an application.
- Components accept refs and native element props with strict types.
- Button keyboard focus, disabled state and loading state are accessible.
- Theme values are available as CSS custom properties.
- Package consumers can import components, tokens and the theme stylesheet through documented exports.
- No component-library decision is locked in.
- No file outside the allowed list changes.

## Validation

Run package-scoped checks:

```text
pnpm --filter @bug-bounty-escrow/ui typecheck
pnpm --filter @bug-bounty-escrow/ui lint
pnpm --filter @bug-bounty-escrow/ui build
```

Do not run root-wide formatting with `--write`.

## Deliverables

- UI package source and public exports.
- Theme tokens and stylesheet.
- Package manifest/config updates and lockfile.
- Validation results.
- Dependency rationale.
- Changed-file summary.
- Assumptions and known limitations.
