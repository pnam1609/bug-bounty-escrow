import { spawnSync } from "node:child_process";

const packageManager = process.platform === "win32" ? "corepack.cmd" : "corepack";
const checks = [
  ["lint", ["pnpm", "lint"]],
  // Foundry contract tests run in the Docker quality stage. Keeping them out
  // of this hook lets contributors without Foundry still run every JS/TS
  // workspace unit test locally while CI remains the final contract gate.
  ["unit tests", ["pnpm", "exec", "turbo", "run", "test", "--filter=!@bug-bounty-escrow/contracts"]],
];

for (const [label, args] of checks) {
  console.log(`\n[pre-commit] Running ${label}...`);
  const result = spawnSync(packageManager, args, {
    cwd: new URL("..", import.meta.url),
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });

  if (result.error) {
    console.error(`[pre-commit] Could not run ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\n[pre-commit] Lint and unit tests passed.");
