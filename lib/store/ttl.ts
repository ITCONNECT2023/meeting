/**
 * Every write in `lib/store` requires a TTL (see docs/03_TRD.md — nothing is
 * stored permanently). This guards that at the boundary of both drivers.
 */
export function assertValidTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(
      `ttlSeconds must be a positive integer, got: ${JSON.stringify(ttlSeconds)}`,
    );
  }
}
