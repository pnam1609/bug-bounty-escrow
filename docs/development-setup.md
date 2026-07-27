# Development setup

This guide describes the repository in its current foundation stage. See the
[project context](../PROJECT_CONTEXT.md), [task backlog](tasks/README.md), and
[root README](../README.md) for product and planning context.

## Tool requirements

The current ESLint toolchain supports Node.js `^20.19.0`, `^22.13.0`, or
`>=24.0.0`. Check the active runtime before installing:

```sh
node --version
```

The root `packageManager` field pins pnpm `11.17.0`. Use Corepack so commands select
that committed version:

```sh
corepack enable
pnpm --version
```

The second command must print `11.17.0`.

## Install dependencies

From the repository root:

```sh
pnpm install --frozen-lockfile
```

The frozen install verifies that package manifests and `pnpm-lock.yaml` agree. Do
not switch to a non-frozen install merely to hide a mismatch.

## Environment setup

The committed templates are:

- [Workspace reference](../.env.example) — combined inventory only; do not load it
  into either application.
- [Web example](../apps/web/.env.example) — browser-visible variables.
- [API example](../apps/api/.env.example) — server-only variables.

The applications are not scaffolded yet, so these files are not required for the
currently implemented package checks. To prepare local files for later app tasks,
copy only the matching application template:

> **Security note:** the current root `.gitignore` does not exclude these local
> environment destinations. Never stage or commit them after adding real values.
> Adding appropriate environment-file ignore rules belongs to a separate repository
> configuration task.

POSIX shell:

```sh
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env
```

PowerShell:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.env.example apps/api/.env
```

Replace the intentionally invalid placeholders only with values for your own
authorized development environment.

### Web variables

The web template contains only browser-visible names:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_ARC_RPC_URL`
- `NEXT_PUBLIC_ARC_EXPLORER_URL`
- `NEXT_PUBLIC_ARC_CHAIN_ID`
- `NEXT_PUBLIC_USDC_ADDRESS`

Anything prefixed with `NEXT_PUBLIC_` is visible to browser users and must not
contain a secret.

### API variables

The API template defines:

- `NODE_ENV`, `PORT`, and `WEB_APP_ORIGIN`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
- `ARC_RPC_URL`, `ARC_CHAIN_ID`, and `USDC_ADDRESS`
- optional `ESCROW_FACTORY_ADDRESS`
- `AI_PROVIDER`, optional `GEMINI_API_KEY`, and `LOG_LEVEL`

`GEMINI_API_KEY` is required only when `AI_PROVIDER=gemini`.

### Secret handling

- Never put `SUPABASE_SERVICE_ROLE_KEY` or `GEMINI_API_KEY` in the web environment,
  a `NEXT_PUBLIC_` variable, source control, screenshots, or logs.
- Supabase anon keys are intended for public-client use, but row-level security
  remains mandatory. Never substitute a service-role key for an anon key.
- No wallet private-key variable is currently defined. If a later deployment task
  introduces one, keep it in an approved local or deployment secret store. Never
  expose it to the browser, commit it, or paste it into issue reports.
- Do not work around setup failures by disabling validation, row-level security, or
  TLS.

## Root commands

The root delegates workspace orchestration to Turbo:

| Command | Current behavior |
|---|---|
| `pnpm dev` | Runnable orchestration command, but no workspace has a `dev` script yet; it starts no service. |
| `pnpm build` | Builds `@bug-bounty-escrow/domain`, `@bug-bounty-escrow/shared`, and `@bug-bounty-escrow/ui`. |
| `pnpm lint` | Lints all current workspace packages. Placeholder packages pass when they contain no lintable source. |
| `pnpm typecheck` | Typechecks domain, shared, and UI. Other packages do not yet define this script. |
| `pnpm test` | Runnable orchestration command, but no workspace test script exists yet; it runs no tests. |
| `pnpm format:check` | Checks repository formatting without writing files. It exits nonzero when differences exist. |
| `pnpm format` | Writes formatting changes across the repository. Use only when you own all affected files and no concurrent task is running. |

Currently useful validation:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm format:check
```

Running `pnpm dev` or `pnpm test` today verifies only that Turbo can resolve the task
graph; it does not start an app or execute tests.

## Package-filter examples

Web and API currently expose lint only:

```sh
pnpm --filter @bug-bounty-escrow/web lint
pnpm --filter @bug-bounty-escrow/api lint
```

Domain, shared, and UI expose build, typecheck, and lint:

```sh
pnpm --filter @bug-bounty-escrow/domain build
pnpm --filter @bug-bounty-escrow/domain typecheck
pnpm --filter @bug-bounty-escrow/domain lint

pnpm --filter @bug-bounty-escrow/shared build
pnpm --filter @bug-bounty-escrow/shared typecheck
pnpm --filter @bug-bounty-escrow/shared lint

pnpm --filter @bug-bounty-escrow/ui build
pnpm --filter @bug-bounty-escrow/ui typecheck
pnpm --filter @bug-bounty-escrow/ui lint
```

Do not use package-filtered `dev` or `test` commands until the target package
manifest defines those scripts.

## Current limitations

- The Next.js web application and NestJS API have package placeholders but no
  application source or development/build scripts.
- Database migrations, Supabase integration, Arc clients, escrow contracts, and AI
  providers are planned work and cannot be run from this repository yet.
- No workspace package currently defines a test script.
- Environment schemas exist in the shared package, but no application bootstrap
  consumes them yet.
- Root Turbo ordering is ready for workspace dependency edges that later package
  manifests will declare.

## Troubleshooting

### Frozen lockfile errors

Confirm `pnpm --version` prints `11.17.0` and that no manifest was edited
accidentally. If a dependency change is intentional, its owning task must run pnpm
and commit the resulting lockfile. Do not delete or bypass the lockfile in an
unrelated change.

If pnpm reports a package release-age or trust-policy violation, do not disable the
policy. Review the flagged package with the dependency owner and retry after the
policy window or an approved configuration change.

### Turbo cache

Turbo caches task results under `.turbo` and declared build outputs. To re-run a
task without deleting broad directories:

```sh
pnpm turbo run lint --force
```

Use the task name relevant to the problem. Persistent incorrect output usually
means a package has not declared its generated output or dependency yet.

### Port conflicts

The examples reserve port `3000` for the future web app and `3001` for the future
API. If a local process already uses one, choose an unused port and update `PORT`,
`WEB_APP_ORIGIN`, and `NEXT_PUBLIC_API_BASE_URL` consistently. Do not weaken TLS or
origin validation for remote environments.

### Missing or invalid environment

Copy the template for the affected app, compare variable names exactly, and replace
all required placeholder values. Keep `AI_PROVIDER=mock` or `disabled` when no
Gemini key is configured. Environment validation errors are designed to identify
variable names without echoing secret values; preserve that behavior when
troubleshooting.
