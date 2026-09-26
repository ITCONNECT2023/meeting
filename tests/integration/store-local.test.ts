import { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";

import { createUpstashStore } from "@/lib/store/upstash";

/**
 * Integration check for the upstash driver (lib/store/upstash.ts) against
 * the real local stack: Docker Redis + serverless-redis-http, started by
 * docker-compose.yml. Proves the driver actually speaks the Upstash REST
 * protocol correctly, not just that it type-checks against the SDK.
 *
 * Deliberately NOT under tests/unit/ — vitest.config.mts only looks there,
 * so this never runs as part of `npm run test:unit` / `npm run check`. Run
 * it with `npm run test:store-local`, which starts Docker for you first.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run this via \`npm run test:store-local\`, which ` +
        "starts the local Redis stack and sets it for you.",
    );
  }
  return value;
}

function store() {
  requireEnv("UPSTASH_REDIS_REST_URL");
  requireEnv("UPSTASH_REDIS_REST_TOKEN");
  return createUpstashStore();
}

/** Direct client, only for inspecting what the driver wrote (e.g. TTLs). */
function rawRedis(): Redis {
  return new Redis({
    url: requireEnv("UPSTASH_REDIS_REST_URL"),
    token: requireEnv("UPSTASH_REDIS_REST_TOKEN"),
  });
}

function uniqueKey(label: string): string {
  return `test:store-local:${label}:${Math.random().toString(36).slice(2)}`;
}

describe("upstash driver against local serverless-redis-http", () => {
  it("round-trips set/get with a TTL", async () => {
    const s = store();
    const key = uniqueKey("roundtrip");
    await s.set(key, { hello: "local-redis" }, { ttlSeconds: 30 });
    await expect(s.get(key)).resolves.toEqual({ hello: "local-redis" });
  });

  it("deletes a key", async () => {
    const s = store();
    const key = uniqueKey("del");
    await s.set(key, "value", { ttlSeconds: 30 });
    await s.del(key);
    await expect(s.get(key)).resolves.toBeNull();
  });

  it("incr counts up, starting at 1", async () => {
    const s = store();
    const key = uniqueKey("incr");
    await expect(s.incr(key, { ttlSeconds: 30 })).resolves.toBe(1);
    await expect(s.incr(key, { ttlSeconds: 30 })).resolves.toBe(2);
    await expect(s.incr(key, { ttlSeconds: 30 })).resolves.toBe(3);
  });

  it("incr gives the counter a TTL on creation, and later incr doesn't extend it", async () => {
    const s = store();
    const r = rawRedis();
    const key = uniqueKey("incr-ttl");
    await s.incr(key, { ttlSeconds: 30 });
    const first = await r.ttl(key);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(30);

    // A much larger TTL on a later call must not replace the original one.
    await s.incr(key, { ttlSeconds: 3_000 });
    const second = await r.ttl(key);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThanOrEqual(30);
  });

  it("incr repairs a counter that somehow has no TTL", async () => {
    const s = store();
    const r = rawRedis();
    const key = uniqueKey("incr-no-ttl");
    await r.set(key, 4);
    expect(await r.ttl(key)).toBe(-1);
    try {
      await expect(s.incr(key, { ttlSeconds: 30 })).resolves.toBe(5);
      const ttl = await r.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    } finally {
      await r.del(key);
    }
  });

  it("set and setIfAbsent write keys with a TTL", async () => {
    const s = store();
    const r = rawRedis();
    const setKey = uniqueKey("set-ttl");
    const nxKey = uniqueKey("nx-ttl");
    await s.set(setKey, "value", { ttlSeconds: 30 });
    await s.setIfAbsent(nxKey, "value", { ttlSeconds: 30 });
    for (const key of [setKey, nxKey]) {
      const ttl = await r.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    }
  });

  it("setIfAbsent succeeds once, then reports the key is taken", async () => {
    const s = store();
    const key = uniqueKey("if-absent");
    await expect(s.setIfAbsent(key, "first", { ttlSeconds: 30 })).resolves.toBe(
      true,
    );
    await expect(
      s.setIfAbsent(key, "second", { ttlSeconds: 30 }),
    ).resolves.toBe(false);
    await expect(s.get(key)).resolves.toBe("first");
  });

  it(
    "actually expires a key after its TTL (real wait, short TTL)",
    async () => {
      const s = store();
      const key = uniqueKey("expiry");
      await s.set(key, "value", { ttlSeconds: 2 });
      await expect(s.get(key)).resolves.toBe("value");

      await new Promise((resolve) => setTimeout(resolve, 2_500));

      await expect(s.get(key)).resolves.toBeNull();
    },
    10_000,
  );
});
