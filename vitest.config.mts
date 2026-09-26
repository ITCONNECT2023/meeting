import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
      // "server-only" throws unconditionally when resolved via its default
      // export condition (only Next's bundler, which sets the "react-server"
      // condition, gets the no-op build). Point it at that no-op build
      // directly so Vitest (plain Node resolution) can still import
      // lib/store, which uses "server-only" to stay out of client bundles.
      "server-only": path.join(
        process.cwd(),
        "node_modules/server-only/empty.js",
      ),
    },
  },
});
