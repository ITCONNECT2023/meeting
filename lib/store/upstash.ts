import "server-only";

import { Redis } from "@upstash/redis";

import { assertValidTtl } from "./ttl";
import type { KeyValueStore, SetOptions } from "./types";

/**
 * `KeyValueStore` backed by Upstash Redis's REST API.
 *
 * In production this talks to real Upstash. Locally (EPIC 1-9), it talks to
 * the same REST API shape served by `serverless-redis-http` in front of a
 * Docker Redis (see docker-compose.yml) — the code path is identical, only
 * the URL/token differ. Deploying later is only an env var change.
 */

/**
 * INCR, then set the TTL only if the key has none (TTL == -1). Runs as one
 * Lua script, so Redis applies both or neither. The TTL is only ever set on
 * the call that created the key (or on a legacy key that somehow lacks
 * one); later calls leave it alone, so the counting window stays fixed from
 * the first hit — same meaning as `EXPIRE key ttl NX`.
 */
const INCR_WITH_TTL_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return n
`;

/**
 * DEL the key only if it still holds ARGV[1], as one Lua script so no other
 * client can take the key between the compare and the delete.
 */
const DELETE_IF_VALUE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

function readRequiredEnv(primaryName: string, fallbackName: string): string {
  const value = process.env[primaryName] ?? process.env[fallbackName];
  if (!value) {
    // Name the missing variable(s); never include a value (there is none to
    // leak here, but keep this true even if the fallback check changes).
    throw new Error(
      `Missing environment variable: ${primaryName} (or ${fallbackName}). ` +
        "Set it to your Upstash Redis REST URL/token, or run with STORE_DRIVER=memory for local dev/tests.",
    );
  }
  return value;
}

function createClient(): Redis {
  const url = readRequiredEnv("UPSTASH_REDIS_REST_URL", "KV_REST_API_URL");
  const token = readRequiredEnv(
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_TOKEN",
  );
  return new Redis({ url, token });
}

export function createUpstashStore(): KeyValueStore {
  const redis = createClient();

  return {
    async get<T>(key: string): Promise<T | null> {
      const value = await redis.get<T>(key);
      return value ?? null;
    },

    async set<T>(
      key: string,
      value: T,
      { ttlSeconds }: SetOptions,
    ): Promise<void> {
      assertValidTtl(ttlSeconds);
      await redis.set(key, value, { ex: ttlSeconds });
    },

    async del(key: string): Promise<void> {
      await redis.del(key);
    },

    async incr(key: string, { ttlSeconds }: SetOptions): Promise<number> {
      assertValidTtl(ttlSeconds);
      // One EVAL, so INCR and the TTL land together: a separate EXPIRE call
      // could fail after INCR succeeded and leave a counter that never
      // expires (a login lockout bucket stuck forever).
      const next = await redis.eval<[number], number>(
        INCR_WITH_TTL_SCRIPT,
        [key],
        [ttlSeconds],
      );
      return Number(next);
    },

    async setIfAbsent<T>(
      key: string,
      value: T,
      { ttlSeconds }: SetOptions,
    ): Promise<boolean> {
      assertValidTtl(ttlSeconds);
      const result = await redis.set(key, value, {
        ex: ttlSeconds,
        nx: true,
      });
      return result === "OK";
    },

    async deleteIfValue(key: string, value: string): Promise<boolean> {
      // A string value is stored as-is by @upstash/redis (no JSON quoting),
      // so it compares equal to the same string passed as ARGV.
      const deleted = await redis.eval<[string], number>(
        DELETE_IF_VALUE_SCRIPT,
        [key],
        [value],
      );
      return Number(deleted) === 1;
    },
  };
}
