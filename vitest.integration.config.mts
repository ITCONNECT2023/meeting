import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Separate on purpose from vitest.config.mts: tests under tests/integration/
 * talk to the real local Docker Redis + serverless-redis-http stack over
 * HTTP, so they must never be picked up by `npm run test:unit` / `npm run
 * check` (which must not require Docker). Run via `npm run test:store-local`,
 * which also starts the stack first.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // These make real HTTP calls and include a real (short) TTL wait;
    // default timeouts are tighter than that.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": process.cwd(),
      // See vitest.config.mts for why this alias exists.
      "server-only": path.join(
        process.cwd(),
        "node_modules/server-only/empty.js",
      ),
    },
  },
});
