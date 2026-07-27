# Foundation integration validation

## Audit state

- Audit task: `FND-011`
- Audited at: `2026-07-25T05:31:24+07:00`
- Time zone: `SE Asia Standard Time`
- Workspace: 9 packages plus the private root project
- Git revision: unavailable because the workspace is not a Git repository
- Node.js: `v22.22.3`
- pnpm: `11.17.0` through Corepack
- Turborepo: `2.10.6`
- TypeScript: `5.9.3`
- ESLint: `10.8.0`

The following hashes identify the root dependency and task-configuration state that
was audited:

| File | SHA-256 |
|---|---|
| `pnpm-lock.yaml` | `91AB3B216C1830284FE8FB4B0ECCB282FED5501CB8B1B5C3EC049FA6B018DFC0` |
| `package.json` | `975909AA37C37087C1F357231D9CF98524020592B754585AA1D1A5FD285EFCAB` |
| `turbo.json` | `B437AAC19522F32A1E1830589E605E3EC2F0766F67FF6EFD11CDF3DCE1733E09` |
| `pnpm-workspace.yaml` | `08D75840C97AB0E72D1D9B5B84A17E47A2E06CB159A5FBEC5EE0A6A56682DAD7` |

Status meanings:

- **PASS**: the check ran and met its acceptance condition.
- **FAIL**: the check ran and found a repository deficiency.
- **SKIPPED**: the check does not apply to the current package or source state.
- **BLOCKED**: the check could not reach the repository task because of an
  environmental or tooling prerequisite.

## Required command matrix

The machine does not expose a standalone `pnpm` command, so the exact pnpm
operations were invoked as `corepack pnpm ...`. All nine commands were blocked
before their repository scripts ran by the same supply-chain policy check.

| Required command | Status | Concise evidence |
|---|---|---|
| `pnpm install --frozen-lockfile` | **BLOCKED** | Lockfile resolution was skipped as up to date, then `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` rejected `eslint@10.8.0`. |
| `pnpm lint` | **BLOCKED** | pnpm stopped at the same release-age policy before `turbo run lint`. |
| `pnpm typecheck` | **BLOCKED** | pnpm stopped at the same release-age policy before `turbo run typecheck`. |
| `pnpm test` | **BLOCKED** | pnpm stopped at the same release-age policy before `turbo run test`. |
| `pnpm build` | **BLOCKED** | pnpm stopped at the same release-age policy before `turbo run build`. |
| `pnpm turbo run build --dry=json` | **BLOCKED** | pnpm stopped at the same release-age policy before Turbo started. |
| `pnpm turbo run lint --dry=json` | **BLOCKED** | pnpm stopped at the same release-age policy before Turbo started. |
| `pnpm turbo run typecheck --dry=json` | **BLOCKED** | pnpm stopped at the same release-age policy before Turbo started. |
| `pnpm turbo run test --dry=json` | **BLOCKED** | pnpm stopped at the same release-age policy before Turbo started. |

The rejected package was published at `2026-07-24T20:15:20.693Z`; the policy
cutoff during the audit was approximately `2026-07-23T22:27:40Z`. No policy,
manifest, or lockfile change was made by this audit.

## Supplemental execution

Local binaries already present in `node_modules` were used read-only to separate
repository behavior from the pnpm policy blocker.

| Check | Equivalent command or method | Status | Evidence |
|---|---|---|---|
| Repository lint | `node_modules/.bin/eslint . --no-error-on-unmatched-pattern` | **PASS** | Exit code 0 with no findings. |
| Domain typecheck | `tsc -p packages/domain/tsconfig.json --noEmit` | **PASS** | Exit code 0. |
| Shared typecheck | `tsc -p packages/shared/tsconfig.json --noEmit` | **PASS** | Exit code 0. |
| UI typecheck | `tsc -p packages/ui/tsconfig.json --noEmit` | **PASS** | Exit code 0. |
| Domain build | `tsc -p packages/domain/tsconfig.json` | **PASS** | Exit code 0. |
| Shared build | `tsc -p packages/shared/tsconfig.json` | **PASS** | Exit code 0. |
| UI build | TypeScript build followed by `scripts/copy-theme.mjs` | **PASS** | Exit code 0; JavaScript, declarations, and theme target were produced. |
| Tests | Package inventory and test/spec file scan | **FAIL** | No workspace declares a `test` script and no test/spec source file exists. |

The six structure-only workspaces without TypeScript or product source were not
given synthetic build or typecheck commands during this audit.

## Workspace inventory

| Workspace | Available scripts | Runtime dependencies | Development/peer dependencies |
|---|---|---|---|
| `@bug-bounty-escrow/api` | `lint` | None | None |
| `@bug-bounty-escrow/web` | `lint` | None | None |
| `@bug-bounty-escrow/ai` | `lint` | None | None |
| `@bug-bounty-escrow/blockchain` | `lint` | None | None |
| `@bug-bounty-escrow/contracts` | `lint` | None | None |
| `@bug-bounty-escrow/database` | `lint` | None | None |
| `@bug-bounty-escrow/domain` | `build`, `lint`, `typecheck` | None | None |
| `@bug-bounty-escrow/shared` | `build`, `lint`, `typecheck` | `zod` | None |
| `@bug-bounty-escrow/ui` | `build`, `lint`, `typecheck` | None | React and React DOM as peers; React typings and peer implementations for development |

## Turbo dry-run graph

The pnpm-wrapped dry-runs were blocked, but the equivalent local Turbo
`run <task> --dry=json` commands all returned valid JSON.

| Task | Graph status | Nodes | Executable nodes | Nonexistent commands | Dependency edges |
|---|---|---:|---:|---:|---:|
| `build` | **PASS** | 9 | 3 | 6 | 0 |
| `lint` | **PASS** | 9 | 9 | 0 | 0 |
| `typecheck` | **PASS** | 9 | 3 | 6 | 0 |
| `test` | **PASS** as graph generation; **FAIL** as test coverage | 9 | 0 | 9 | 0 |

Executable build/typecheck nodes are domain, shared, and UI. All nine workspaces
have lint commands. Turbo represents missing package scripts as
`<NONEXISTENT>`.

There are no dependency edges because no manifest currently declares an
internal workspace dependency. This is consistent with the present source:
domain and shared are independent, UI does not consume shared/domain, and the
application packages remain structure-only.

## Package-boundary audit

| Boundary check | Status | Evidence |
|---|---|---|
| Domain is framework-independent | **PASS** | No manifest dependency; source imports are relative type/module imports only. |
| Shared avoids web/API frameworks | **PASS** | Its only dependency/import outside relative files is `zod`; no React, Next.js, NestJS, Supabase, viem, or wagmi import was found. |
| UI does not import application code | **PASS** | UI imports React, Node built-ins in its build script, and relative UI modules only. |
| Workspace dependency direction | **PASS** | No internal workspace dependency is currently declared. |
| Undeclared workspace deep imports | **PASS** | No `@bug-bounty-escrow/*` source import was found. |
| Package export boundaries | **PASS** | Undeclared domain, shared, and UI internal subpaths returned `ERR_PACKAGE_PATH_NOT_EXPORTED`. |

The API, web, AI, blockchain, contracts, and database workspaces contain no
application source yet, so source-import boundary checks for them are
**SKIPPED**.

## Public entrypoints

Build output was generated as an ignored artifact before resolving entrypoints.

| Package | Status | Evidence |
|---|---|---|
| `@bug-bounty-escrow/domain` | **PASS** | Root JavaScript import succeeded; all 2 unique declared runtime/type targets exist. |
| `@bug-bounty-escrow/shared` | **PASS** | Root JavaScript import succeeded; all 2 unique declared runtime/type targets exist. |
| `@bug-bounty-escrow/ui` | **PASS** | Root, button, card, components, status-badge, and tokens imports succeeded; all 13 unique declared runtime/type/CSS targets exist. |
| API, web, AI, blockchain, contracts, database | **SKIPPED** | These structure-only manifests do not declare `main`, `types`, or `exports`. |

## Environment and credential audit

| Check | Status | Evidence |
|---|---|---|
| Root, web, and API examples scanned for obvious credentials | **PASS** | No JWT-shaped value, PEM private key, common provider-key prefix, Supabase secret prefix, or 64-hex private-key-shaped value was found. |
| Forbidden server variable names in web schema source | **PASS** | Service-role, Gemini, and private-key variable names are absent. |
| Web parser output isolation | **PASS** | Runtime parsing stripped injected server-only keys and returned only `NEXT_PUBLIC_*` properties. |
| Import-time environment access | **PASS** | Shared environment modules contain no `process.env` read. |

Only filenames and variable names were inspected or reported; no environment
value is included in this report.

## Findings and recommended follow-ups

### VAL-001: pnpm release-age policy blocks reproducible installation and root commands

- Status: **BLOCKED**
- Exact command: `pnpm install --frozen-lockfile`
- Also affects: all eight required pnpm root and dry-run commands in the matrix
- Error: `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` for `eslint@10.8.0`
- Likely owner: Foundation tooling/dependency configuration from FND-003 and
  the environment-level pnpm supply-chain policy
- Recommended follow-up: create a tooling-maintenance task to rerun the frozen
  install after the configured release-age window, or deliberately select a
  policy-approved ESLint version. Do not bypass or relax the policy without an
  explicit dependency-security decision.

### VAL-002: foundation packages have no executable tests

- Status: **FAIL**
- Exact checks:
  - `pnpm test` was attempted but blocked by VAL-001
  - local Turbo `run test --dry=json` reported 9 `<NONEXISTENT>` commands
  - package-manifest and `*test*`/`*spec*` source scans found none
- Likely owner: `packages/domain/package.json`,
  `packages/shared/package.json`, `packages/ui/package.json`, and the related
  Foundation source packages
- Recommended follow-up: add a dedicated Foundation unit-test task covering
  domain transitions, shared normalization/schema/environment behavior, and UI
  primitives; add package-local `test` scripts before treating root
  `pnpm test` as meaningful.

### VAL-003: no Git revision is available

- Status: **BLOCKED**
- Exact command: `git status --short`
- Error: `fatal: not a git repository`
- Likely owner: repository/bootstrap workflow rather than a Foundation source
  task
- Recommended follow-up: run future validation from an initialized or checked
  out Git repository so the report can identify a commit and verify tracked
  file cleanliness authoritatively.

## Mutation confirmation

This audit did not repair any finding and did not modify an implementation,
manifest, lockfile, workspace configuration, environment example, source file,
or test file. Root configuration and lockfile hashes were unchanged before and
after command execution. Generated `node_modules`, Turbo caches, and build
outputs may have changed as ignored artifacts permitted by the assignment.

The only tracked file written by FND-011 is this report:
`docs/foundation-validation.md`.
