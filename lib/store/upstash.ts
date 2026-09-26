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
      const next = await redis.incr(key);
      // EXPIRE ... NX only sets a TTL if the key doesn't already have one,
      // so this is a no-op on every call after the first — the counting
      // window stays fixed from the hit that created the key, and we never
      // need to distinguish "did I just create this?" ourselves.
      await redis.expire(key, ttlSeconds, "NX");
      return next;
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
  };
}
