// `npm run test:store-local`: starts the local Redis stack (Docker) and
// runs the integration check in tests/integration/ that proves the upstash
// driver in lib/store really talks to it over the Upstash REST protocol.
//
// Deliberately separate from `npm run test:unit` / `npm run check`, which
// must never require Docker — see vitest.integration.config.mts.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { ensureDockerRunning, startLocalRedis } from "./lib/local-redis.mjs";

ensureDockerRunning();
startLocalRedis();

const require = createRequire(import.meta.url);
// vitest's package.json doesn't declare "./vitest.mjs" in its "exports"
// map (only "./package.json" and the documented subpaths), so resolving it
// directly would throw ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the package
// root via the one subpath that *is* exported, then join the "bin" file
// next to it — same file `npx vitest` would run.
const vitestPkgPath = require.resolve("vitest/package.json");
const vitestPkg = require(vitestPkgPath);
const vitestBin = path.join(path.dirname(vitestPkgPath), vitestPkg.bin.vitest);

const result = spawnSync(
  process.execPath,
  [vitestBin, "run", "--config", "vitest.integration.config.mts"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // Match docker-compose.yml's serverless-redis-http defaults, unless
      // the caller already set these (e.g. a customized SRH_TOKEN).
      UPSTASH_REDIS_REST_URL:
        process.env.UPSTASH_REDIS_REST_URL ?? "http://127.0.0.1:8079",
      UPSTASH_REDIS_REST_TOKEN:
        process.env.UPSTASH_REDIS_REST_TOKEN ?? "local-dev-only-token",
    },
  },
);

process.exit(result.status ?? 1);
