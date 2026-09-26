import "server-only";

import { assertValidTtl } from "./ttl";
import type { KeyValueStore, SetOptions } from "./types";

/**
 * In-memory `KeyValueStore`, used for tests and for `STORE_DRIVER=memory`
 * (explicitly opted into — see `./index.ts`).
 *
 * The backing map lives on `globalThis` rather than in a module-level
 * variable so it survives Next.js dev-mode module reloads (Fast Refresh /
 * route-handler re-evaluation would otherwise wipe a module-scoped Map,
 * silently "forgetting" everything on the next request).
 *
 * Expiry is lazy: an entry is only actually dropped when something reads or
 * writes that key and notices `expiresAt` has passed. There is no
 * background sweep. That's fine here — this driver only ever backs local
 * dev/test runs, not production — but it does mean a key nobody touches
 * again stays in memory until the process exits.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const GLOBAL_KEY = "__meeting_memoryStoreState__";

type GlobalWithStoreState = typeof globalThis & {
  [GLOBAL_KEY]?: Map<string, Entry>;
};

function getState(): Map<string, Entry> {
  const g = globalThis as GlobalWithStoreState;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, Entry>();
  }
  return g[GLOBAL_KEY];
}

export interface MemoryStoreOptions {
  /**
   * Clock used to compute and check `expiresAt`. Defaults to `Date.now`.
   *
   * Tests inject a fake, manually-advanced clock here instead of faking
   * global timers, so TTL expiry can be exercised without sleeping and
   * without reaching into `Date`/`setTimeout` globally.
   */
  now?: () => number;
}

/** Reads `key`, dropping and ignoring it if it has expired. */
function readLive(
  state: Map<string, Entry>,
  key: string,
  now: () => number,
): Entry | undefined {
  const entry = state.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now()) {
    state.delete(key);
    return undefined;
  }
  return entry;
}

export function createMemoryStore(
  options: MemoryStoreOptions = {},
): KeyValueStore {
  const state = getState();
  const now = options.now ?? Date.now;

  function expiresAtFor(ttlSeconds: number): number {
    return now() + ttlSeconds * 1000;
  }

  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = readLive(state, key, now);
      return entry === undefined ? null : (entry.value as T);
    },

    async set<T>(
      key: string,
      value: T,
      { ttlSeconds }: SetOptions,
    ): Promise<void> {
      assertValidTtl(ttlSeconds);
      state.set(key, { value, expiresAt: expiresAtFor(ttlSeconds) });
    },

    async del(key: string): Promise<void> {
      state.delete(key);
    },

    async incr(key: string, { ttlSeconds }: SetOptions): Promise<number> {
      assertValidTtl(ttlSeconds);
      const existing = readLive(state, key, now);
      if (existing === undefined) {
        state.set(key, { value: 1, expiresAt: expiresAtFor(ttlSeconds) });
        return 1;
      }
      const next = (existing.value as number) + 1;
      // Deliberately not touching `expiresAt`: the window is fixed from the
      // first hit that created this key.
      existing.value = next;
      return next;
    },

    async setIfAbsent<T>(
      key: string,
      value: T,
      { ttlSeconds }: SetOptions,
    ): Promise<boolean> {
      assertValidTtl(ttlSeconds);
      if (readLive(state, key, now) !== undefined) {
        return false;
      }
      state.set(key, { value, expiresAt: expiresAtFor(ttlSeconds) });
      return true;
    },
  };
}
