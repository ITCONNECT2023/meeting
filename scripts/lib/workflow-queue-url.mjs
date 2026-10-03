// Shared by scripts/dev.mjs and scripts/local.mjs (EPIC 9-1).
//
// The local Workflow queue delivers to WORKFLOW_LOCAL_BASE_URL with no
// credential of its own, and the server listens on 0.0.0.0. So the base
// URL carries a fresh random path segment per server start, and proxy.ts
// only accepts queue deliveries that come through it (see
// lib/auth/workflow-queue.ts). An explicitly set WORKFLOW_LOCAL_BASE_URL
// is kept as is.

import { randomBytes } from "node:crypto";

/** Env for the `next` child process, with WORKFLOW_LOCAL_BASE_URL set. */
export function envWithWorkflowQueueUrl(port) {
  if (process.env.WORKFLOW_LOCAL_BASE_URL) return process.env;
  const secret = randomBytes(32).toString("base64url");
  return {
    ...process.env,
    WORKFLOW_LOCAL_BASE_URL: `http://localhost:${port}/_workflow/${secret}`,
  };
}
