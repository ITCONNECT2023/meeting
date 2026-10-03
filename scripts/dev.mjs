// `npm run dev`: start the local Redis stack, then `next dev` listening on
// all interfaces so a phone/tablet on the same LAN can reach it.
//
// Plain Node, no shell-only syntax — resolves next's own CLI entry point
// and spawns it directly instead of relying on a shell to find `next`.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import {
  ensureDockerRunning,
  printLocalUrls,
  startLocalRedis,
} from "./lib/local-redis.mjs";
import { envWithWorkflowQueueUrl } from "./lib/workflow-queue-url.mjs";

const PORT = 3000;

ensureDockerRunning();
startLocalRedis();
printLocalUrls(PORT);

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(
  process.execPath,
  [nextBin, "dev", "-H", "0.0.0.0", "-p", String(PORT)],
  { stdio: "inherit", env: envWithWorkflowQueueUrl(PORT) },
);

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
