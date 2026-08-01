# Repository Guidelines

## Required Reading

Read the relevant flow and `PROJECT_CONTEXT.md`. Priority is flow docs → project context → contracts/code → Figma; flow docs win conflicts. Use Figma `Zdx9FTCAedUZ5R3phehFAp` and `packages/ui/CONVENTIONS.md` for visuals.

| Feature                                          | Required flow document                          |
| ------------------------------------------------ | ----------------------------------------------- |
| Auth, onboarding, roles, route guards            | `onboarding-role-flow-for-figma.md`             |
| Public bounty list, filters, discovery           | `bounty-table-program-list-for-figma.md`        |
| Program detail leading to submission             | Bounty Table + Submit Bug flows                 |
| Owner create/edit, deploy, fund, withdraw        | `create-program-owner-flow-for-figma.md`        |
| Composer, attachments, submit/resubmit, AI queue | `submit-bug-researcher-flow-for-figma.md`       |
| Researcher report list/detail navigation         | `my-reports-researcher-flow-for-figma.md`       |
| Owner/reviewer decisions and settlement          | `review-report-owner-flow-for-figma.md`         |
| Researcher profile, header, logout               | `account-settings-researcher-flow-for-figma.md` |
| Rewards preview, reward center, payout wallet    | `reward-future-researcher-flow-for-figma.md`    |

Paths are under `docs/flow/`. Open the [Delivery Backlog](https://app.notion.com/p/BountyEscrow-Delivery-Backlog-3a9800c6e76e8117a06bfb49143fee52) and [Tasks database](https://app.notion.com/p/06a0ee55892f4852bffd3b871ef4df8d). Find the task ID; inspect status, dependencies, Spec, acceptance criteria, and Figma. For review search `FE-REV-*`/`BE-RPT-*`. Never guess unavailable Notion state.

## Tool Routing

- Make Figma changes through Figma MCP in canonical file. Inspect first and verify changed nodes; screenshots/docs are not substitutes.
- Use Arc Docs MCP for Arc, App Kit, Gateway, chain, USDC, and settlement facts; prefer official docs over memory.
- Use Docker Hetzner VPS MCP for containers, services, files, proxy, and VPS. Inspect before mutations.
- On GitHub pipeline/deploy failure, use `read_logs`/`search_logs` on VPS; correlate time and commit, then report pipeline and runtime evidence. Restart, redeploy, or clean only when authorized.

## Architecture

`apps/web` is Next.js; `apps/api` owns business logic. Frontend calls NestJS REST, never Supabase directly. Use shared validation, thin controllers, services, and injected repositories.

## Commands & Testing

- Setup: `pnpm install --frozen-lockfile`, `pnpm exec supabase start`, then database `db:migrate --seed`.
- Develop/build: `pnpm dev`, `pnpm build`.
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
- Specialized: web `test:e2e`; API `openapi:check` after contract changes.

Tests use Vitest `*.spec.ts`, Playwright `apps/web/e2e`, Foundry `*.t.sol`, and `packages/database/tests/`. Cover regressions.

## Delivery Rules

Use strict TypeScript, named exports, two spaces, single quotes, semicolons, and kebab-case files. UI is dark-only with BBE tokens, WCAG AA, and 44×44px targets.

Never expose private report/AI data, signed URLs, or secrets; never store vulnerabilities on-chain or let AI/client/provider output trigger decisions or payout.

Use one outcome per `feat/<task-id>-<slug>` branch and Conventional Commits. PRs link Notion, list tests/assumptions, show UI changes, and call out migrations, OpenAPI, artifacts, or Figma deviations.
