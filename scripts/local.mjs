// `npm run local`: start the local Redis stack, `next build`, then
// `next start` listening on all interfaces — a production-like run for
// checking a finished EPIC on PC and on a phone.
//
// Plain Node, no shell-only syntax — resolves next's own CLI entry point
// and spawns it directly instead of relying on a shell to find `next`.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import {
  ensureDockerRunning,
  printLocalUrls,
  startLocalRedis,
} from "./lib/local-redis.mjs";

const PORT = 3000;

ensureDockerRunning();
startLocalRedis();

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

console.log("[local] next build ...");
const build = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
});
if (build.error || build.status !== 0) {
  process.exit(build.status ?? 1);
}

printLocalUrls(PORT);

const child = spawn(
  process.execPath,
  [nextBin, "start", "-H", "0.0.0.0", "-p", String(PORT)],
  { stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
