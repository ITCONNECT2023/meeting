import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "STORE_DRIVER",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

describe("store driver selection", () => {
  it("defaults to the upstash driver when STORE_DRIVER is unset", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

    const { getStore } = await import("@/lib/store");
    expect(() => getStore()).not.toThrow();
  });

  it("throws naming the missing URL variable when upstash env is entirely absent", async () => {
    process.env.STORE_DRIVER = "upstash";

    const { getStore } = await import("@/lib/store");
    expect(() => getStore()).toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it("throws naming the missing token variable when only the URL is set", async () => {
    process.env.STORE_DRIVER = "upstash";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";

    const { getStore } = await import("@/lib/store");
    expect(() => getStore()).toThrow(/UPSTASH_REDIS_REST_TOKEN/);
  });

  it("accepts the KV_REST_API_* fallback names Vercel's integration injects", async () => {
    process.env.STORE_DRIVER = "upstash";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "test-token";

    const { getStore } = await import("@/lib/store");
    expect(() => getStore()).not.toThrow();
  });

  it("uses the memory driver when STORE_DRIVER=memory, with no upstash env needed", async () => {
    process.env.STORE_DRIVER = "memory";

    const { getStore } = await import("@/lib/store");
    const store = getStore();
    const key = `test:driver-memory:${Math.random().toString(36).slice(2)}`;
    await store.set(key, "value", { ttlSeconds: 60 });
    await expect(store.get(key)).resolves.toBe("value");
  });

  it("rejects an unrecognized STORE_DRIVER value", async () => {
    process.env.STORE_DRIVER = "something-else";

    const { getStore } = await import("@/lib/store");
    expect(() => getStore()).toThrow(/something-else/);
  });
});
