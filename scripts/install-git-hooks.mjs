import { execFileSync } from "node:child_process";

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
});

console.log("Git hooks installed: core.hooksPath=.githooks");
