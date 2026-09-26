import { describe, expect, it } from "vitest";

import { createMemoryStore } from "@/lib/store/memory";

function uniqueKey(label: string): string {
  return `test:${label}:${Math.random().toString(36).slice(2)}`;
}

/**
 * A manually-advanced clock, injected into `createMemoryStore` so TTL
 * expiry can be tested by moving time forward explicitly instead of
 * sleeping (or faking global timers).
 */
function createFakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    advance(ms: number): void {
      current += ms;
    },
  };
}

describe("memory store", () => {
  it("round-trips a set value through get", async () => {
    const store = createMemoryStore();
    const key = uniqueKey("roundtrip");
    await store.set(key, { hello: "world" }, { ttlSeconds: 60 });
    await expect(store.get(key)).resolves.toEqual({ hello: "world" });
  });

  it("returns null for a key that was never set", async () => {
    const store = createMemoryStore();
    await expect(store.get(uniqueKey("missing"))).resolves.toBeNull();
  });

  it("expires a value once its TTL has elapsed", async () => {
    const clock = createFakeClock();
    const store = createMemoryStore({ now: clock.now });
    const key = uniqueKey("expiry");
    await store.set(key, "value", { ttlSeconds: 10 });
    await expect(store.get(key)).resolves.toBe("value");

    clock.advance(10_000);
    await expect(store.get(key)).resolves.toBeNull();
  });

  it("does not expire a value before its TTL is up", async () => {
    const clock = createFakeClock();
    const store = createMemoryStore({ now: clock.now });
    const key = uniqueKey("not-yet-expired");
    await store.set(key, "value", { ttlSeconds: 10 });

    clock.advance(9_000);
    await expect(store.get(key)).resolves.toBe("value");
  });

  it("deletes a key", async () => {
    const store = createMemoryStore();
    const key = uniqueKey("del");
    await store.set(key, "value", { ttlSeconds: 60 });
    await store.del(key);
    await expect(store.get(key)).resolves.toBeNull();
  });

  it("del on a key that was never set is a no-op", async () => {
    const store = createMemoryStore();
    await expect(
      store.del(uniqueKey("missing-del")),
    ).resolves.toBeUndefined();
  });

  describe("incr", () => {
    it("counts up from 1 and returns the new count each time", async () => {
      const store = createMemoryStore();
      const key = uniqueKey("incr");
      await expect(store.incr(key, { ttlSeconds: 600 })).resolves.toBe(1);
      await expect(store.incr(key, { ttlSeconds: 600 })).resolves.toBe(2);
      await expect(store.incr(key, { ttlSeconds: 600 })).resolves.toBe(3);
    });

    it("fixes the expiry window at the first hit; later hits don't extend it", async () => {
      const clock = createFakeClock();
      const store = createMemoryStore({ now: clock.now });
      const key = uniqueKey("incr-window");

      await store.incr(key, { ttlSeconds: 10 }); // t=0s: creates the window
      clock.advance(6_000);
      await store.incr(key, { ttlSeconds: 10 }); // t=6s: must NOT push expiry to t=16s
      clock.advance(5_000); // t=11s: past the original 10s window

      await expect(store.get(key)).resolves.toBeNull();

      // A hit after expiry starts a brand-new window, back at count 1.
      await expect(store.incr(key, { ttlSeconds: 10 })).resolves.toBe(1);
    });

    it("this is exactly the password-lockout shape: 5th hit trips, and retrying doesn't push the unlock time out", async () => {
      const clock = createFakeClock();
      const store = createMemoryStore({ now: clock.now });
      const key = uniqueKey("lockout");
      const LOCK_TTL_SECONDS = 10 * 60;
      const LOCK_THRESHOLD = 5;

      let count = 0;
      for (let attempt = 1; attempt <= LOCK_THRESHOLD; attempt++) {
        count = await store.incr(key, { ttlSeconds: LOCK_TTL_SECONDS });
      }
      expect(count).toBe(LOCK_THRESHOLD);

      // A wrong attempt 9 minutes into the lockout must not extend it.
      clock.advance(9 * 60 * 1000);
      await store.incr(key, { ttlSeconds: LOCK_TTL_SECONDS });

      // 10 minutes after the FIRST attempt, the window is over regardless.
      clock.advance(60 * 1000 + 1000);
      await expect(store.get(key)).resolves.toBeNull();
    });
  });

  describe("setIfAbsent", () => {
    it("succeeds once, then reports the key is already taken", async () => {
      const store = createMemoryStore();
      const key = uniqueKey("if-absent");

      await expect(
        store.setIfAbsent(key, "first", { ttlSeconds: 10 }),
      ).resolves.toBe(true);
      await expect(
        store.setIfAbsent(key, "second", { ttlSeconds: 10 }),
      ).resolves.toBe(false);
      // The original value wins; the second write never happened.
      await expect(store.get(key)).resolves.toBe("first");
    });

    it("succeeds again once the key has expired", async () => {
      const clock = createFakeClock();
      const store = createMemoryStore({ now: clock.now });
      const key = uniqueKey("if-absent-expiry");

      await store.setIfAbsent(key, "first", { ttlSeconds: 10 });
      clock.advance(10_000);

      await expect(
        store.setIfAbsent(key, "second", { ttlSeconds: 10 }),
      ).resolves.toBe(true);
      await expect(store.get(key)).resolves.toBe("second");
    });
  });

  describe("ttl validation", () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects ttlSeconds=%s on set",
      async (ttlSeconds) => {
        const store = createMemoryStore();
        await expect(
          store.set(uniqueKey("bad-ttl-set"), "v", { ttlSeconds }),
        ).rejects.toThrow();
      },
    );

    it.each([0, -1, 1.5])(
      "rejects ttlSeconds=%s on incr",
      async (ttlSeconds) => {
        const store = createMemoryStore();
        await expect(
          store.incr(uniqueKey("bad-ttl-incr"), { ttlSeconds }),
        ).rejects.toThrow();
      },
    );

    it.each([0, -1, 1.5])(
      "rejects ttlSeconds=%s on setIfAbsent",
      async (ttlSeconds) => {
        const store = createMemoryStore();
        await expect(
          store.setIfAbsent(uniqueKey("bad-ttl-absent"), "v", { ttlSeconds }),
        ).rejects.toThrow();
      },
    );

    it("accepts a positive integer ttl", async () => {
      const store = createMemoryStore();
      await expect(
        store.set(uniqueKey("good-ttl"), "v", { ttlSeconds: 1 }),
      ).resolves.toBeUndefined();
    });
  });

  it("is a process-wide singleton: a second instance sees the first's writes", async () => {
    const first = createMemoryStore();
    const second = createMemoryStore();
    const key = uniqueKey("singleton");

    await first.set(key, "written-by-first", { ttlSeconds: 60 });
    await expect(second.get(key)).resolves.toBe("written-by-first");
  });
});
