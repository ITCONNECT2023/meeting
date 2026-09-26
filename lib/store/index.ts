import "server-only";

import { createMemoryStore } from "./memory";
import { createUpstashStore } from "./upstash";
import type { KeyValueStore } from "./types";

export type { KeyValueStore, SetOptions } from "./types";

/**
 * Driver selection, by `STORE_DRIVER`:
 * - `"memory"`  — in-memory, explicit opt-in only (tests, and Playwright's
 *                 production build, which runs with STORE_DRIVER=memory).
 * - `"upstash"` — Upstash Redis REST API (the default). Locally this is
 *                 pointed at the Docker Redis + serverless-redis-http proxy
 *                 via UPSTASH_REDIS_REST_URL/TOKEN; in production it's real
 *                 Upstash. Same code either way.
 *
 * There is deliberately no NODE_ENV check here: choosing "memory" is always
 * an explicit choice via the env var, in every environment.
 */
function resolveDriver(): "memory" | "upstash" {
  const raw = process.env.STORE_DRIVER;
  if (raw === undefined || raw === "") return "upstash";
  if (raw === "memory" || raw === "upstash") return raw;
  throw new Error(
    `Invalid STORE_DRIVER: ${JSON.stringify(raw)}. Expected "memory" or "upstash".`,
  );
}

let cachedStore: KeyValueStore | undefined;

/** Returns the process's `KeyValueStore`, created on first use. */
export function getStore(): KeyValueStore {
  if (!cachedStore) {
    cachedStore =
      resolveDriver() === "memory" ? createMemoryStore() : createUpstashStore();
  }
  return cachedStore;
}
