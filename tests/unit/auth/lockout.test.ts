import { describe, expect, it } from "vitest";

import {
  LOCK_SECONDS,
  MAX_FAILED_ATTEMPTS,
  attemptLogin,
  isLocked,
} from "@/lib/auth/lockout";
import { createMemoryStore } from "@/lib/store/memory";

const MINUTE = 60 * 1000;

function createFakeClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance(ms: number): void {
      current += ms;
    },
  };
}

/** The memory store's map is process-global: keep every test's IP unique. */
function uniqueIp(): string {
  return `test-${Math.random().toString(36).slice(2)}`;
}

function setup() {
  const clock = createFakeClock();
  const store = createMemoryStore({ now: clock.now });
  const ip = uniqueIp();
  const wrong = () => attemptLogin(store, ip, () => false);
  const right = () => attemptLogin(store, ip, () => true);
  return { clock, store, ip, wrong, right };
}

describe("login lockout", () => {
  it("allows 4 wrong attempts, locks on the 5th", async () => {
    const { wrong } = setup();
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      await expect(wrong()).resolves.toBe("wrong");
    }
    await expect(wrong()).resolves.toBe("locked");
  });

  it("4 wrong then the right password still gets in", async () => {
    const { wrong, right } = setup();
    for (let i = 0; i < 4; i++) await wrong();
    await expect(right()).resolves.toBe("ok");
  });

  it("refuses the correct password while locked, without checking it", async () => {
    const { store, ip, wrong } = setup();
    for (let i = 0; i < 5; i++) await wrong();

    let checked = false;
    const result = await attemptLogin(store, ip, () => {
      checked = true;
      return true;
    });
    expect(result).toBe("locked");
    expect(checked).toBe(false);
    await expect(isLocked(store, ip)).resolves.toBe(true);
  });

  it("unlocks exactly 10 minutes after the 5th failure, not before", async () => {
    const { clock, wrong, right } = setup();
    // Spread the failures so "from the 1st" and "from the 5th" differ.
    for (let i = 0; i < 4; i++) {
      await wrong();
      clock.advance(1 * MINUTE);
    }
    await expect(wrong()).resolves.toBe("locked"); // 5th, at t0 + 4 min

    clock.advance(10 * MINUTE - 1);
    await expect(right()).resolves.toBe("locked");

    clock.advance(1);
    await expect(right()).resolves.toBe("ok");
  });

  it("measures the lock from the 5th failure, not the 1st", async () => {
    const { clock, wrong, right } = setup();
    await wrong(); // t0
    clock.advance(9 * MINUTE);
    for (let i = 0; i < 4; i++) await wrong(); // 5th at t0 + 9 min
    // 10 min after the 1st failure: still locked (lock runs to t0 + 19 min).
    clock.advance(1 * MINUTE + 1);
    await expect(right()).resolves.toBe("locked");
    clock.advance(LOCK_SECONDS * 1000 - 1 * MINUTE - 1);
    await expect(right()).resolves.toBe("ok");
  });

  it("a successful login resets the counter", async () => {
    const { wrong, right } = setup();
    for (let i = 0; i < 4; i++) await wrong();
    await expect(right()).resolves.toBe("ok");
    for (let i = 0; i < 4; i++) {
      await expect(wrong()).resolves.toBe("wrong");
    }
    await expect(wrong()).resolves.toBe("locked");
  });

  it("forgets failures after the 10-minute counting window", async () => {
    const { clock, wrong } = setup();
    for (let i = 0; i < 4; i++) await wrong();
    clock.advance(10 * MINUTE);
    // Window expired: this is failure #1 of a new window.
    for (let i = 0; i < 4; i++) {
      await expect(wrong()).resolves.toBe("wrong");
    }
    await expect(wrong()).resolves.toBe("locked");
  });

  it("does not forget failures inside the window", async () => {
    const { clock, wrong } = setup();
    for (let i = 0; i < 4; i++) await wrong();
    clock.advance(10 * MINUTE - 1);
    await expect(wrong()).resolves.toBe("locked");
  });

  it("counts each address separately", async () => {
    const clock = createFakeClock();
    const store = createMemoryStore({ now: clock.now });
    const a = uniqueIp();
    const b = uniqueIp();
    for (let i = 0; i < 5; i++) await attemptLogin(store, a, () => false);
    await expect(attemptLogin(store, a, () => true)).resolves.toBe("locked");
    await expect(attemptLogin(store, b, () => true)).resolves.toBe("ok");
  });

  it("parallel attempts get at most 5 password checks", async () => {
    const { store, ip } = setup();
    let checks = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        attemptLogin(store, ip, () => {
          checks += 1;
          return false;
        }),
      ),
    );
    expect(checks).toBeLessThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(results.filter((r) => r === "wrong")).toHaveLength(4);
    await expect(isLocked(store, ip)).resolves.toBe(true);
  });
});
