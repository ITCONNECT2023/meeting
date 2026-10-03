/**
 * Storage port for the app's short-lived data (job progress, generated
 * minutes, password-lockout counters, ...). See docs/03_TRD.md for the
 * retention rules this exists to enforce (minutes: 24h, password lockout:
 * 10 min) — every write requires a TTL so nothing is ever stored forever.
 */

export interface SetOptions {
  /** Seconds until the key expires. Required, and must be a positive integer. */
  ttlSeconds: number;
}

export interface KeyValueStore {
  /** Reads `key`. Returns `null` if it does not exist or has expired. */
  get<T>(key: string): Promise<T | null>;

  /** Writes `key` = `value`, expiring after `options.ttlSeconds`. */
  set<T>(key: string, value: T, options: SetOptions): Promise<void>;

  /** Deletes `key`. A no-op if it does not exist. */
  del(key: string): Promise<void>;

  /**
   * Atomically increments the integer counter at `key` by 1 and returns the
   * new value (starting at 1 if the key did not exist or had expired).
   *
   * The TTL is applied only when this call creates the key. A later `incr`
   * that hits an existing, live counter does NOT extend or restart its
   * expiry — the counting window is fixed from the first hit. This is what
   * lets a "5 wrong attempts locks you out for 10 minutes" counter mean
   * exactly that, instead of resetting every time someone retries.
   */
  incr(key: string, options: SetOptions): Promise<number>;

  /**
   * Writes `key` = `value` only if it does not already exist (or has
   * expired), expiring after `options.ttlSeconds`. Returns `true` if the
   * write happened, `false` if the key was already present. Intended for
   * "start only once" locks (e.g. don't kick off the same job twice).
   */
  setIfAbsent<T>(key: string, value: T, options: SetOptions): Promise<boolean>;

  /**
   * Atomically deletes `key` only if it (still) holds `value`. Returns
   * `true` if it was deleted. Releases a `setIfAbsent` lock without
   * touching a newer holder's lock after ours expired.
   */
  deleteIfValue(key: string, value: string): Promise<boolean>;
}
