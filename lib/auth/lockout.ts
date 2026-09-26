import type { KeyValueStore } from "@/lib/store/types";

/**
 * EPIC 1-4 (F13): per-IP lockout. 5 wrong passwords in a row lock that
 * address out for 10 minutes, counted from the 5th failure.
 *
 * Two keys per address, both with TTLs (TRD §4: 암호 틀린 횟수 10분):
 * - `auth:attempts:<ip>` counter, window fixed from the first attempt
 *   (`incr` never extends its TTL).
 * - `auth:lock:<ip>`, written at the 5th failure with a fresh 10-minute TTL.
 *
 * The counter is incremented *before* the password is compared: each
 * request reserves an attempt slot first. That way a burst of parallel
 * requests can't get more than 5 comparisons in before the lock lands —
 * the 6th and later slots are refused without looking at the password.
 * A correct password deletes the counter, so only consecutive failures
 * count.
 *
 * While locked, the password is not compared at all, so a locked response
 * reveals nothing about whether the submitted password was right.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_SECONDS = 10 * 60;
export const ATTEMPT_WINDOW_SECONDS = 10 * 60;

export type AttemptResult = "ok" | "wrong" | "locked";

function attemptsKey(clientKey: string): string {
  return `auth:attempts:${clientKey}`;
}

function lockKey(clientKey: string): string {
  return `auth:lock:${clientKey}`;
}

export async function isLocked(
  store: KeyValueStore,
  clientKey: string,
): Promise<boolean> {
  return (await store.get<number>(lockKey(clientKey))) !== null;
}

/**
 * Runs one login attempt for `clientKey` (a normalized client IP).
 * `checkPassword` is only called when the address is not locked.
 */
export async function attemptLogin(
  store: KeyValueStore,
  clientKey: string,
  checkPassword: () => boolean,
): Promise<AttemptResult> {
  if (await isLocked(store, clientKey)) return "locked";

  const attempt = await store.incr(attemptsKey(clientKey), {
    ttlSeconds: ATTEMPT_WINDOW_SECONDS,
  });
  if (attempt > MAX_FAILED_ATTEMPTS) {
    // Only reachable when parallel requests raced past the lock check.
    // Make sure the lock exists without extending one that already does.
    await store.setIfAbsent(lockKey(clientKey), 1, { ttlSeconds: LOCK_SECONDS });
    return "locked";
  }

  if (checkPassword()) {
    await store.del(attemptsKey(clientKey));
    return "ok";
  }

  if (attempt === MAX_FAILED_ATTEMPTS) {
    await store.set(lockKey(clientKey), 1, { ttlSeconds: LOCK_SECONDS });
    return "locked";
  }
  return "wrong";
}
