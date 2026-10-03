import "server-only";

import { passwordsMatch } from "./session";

/**
 * EPIC 9-1: who may call `GET /api/cron/cleanup`.
 *
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` (the value of
 * the project's CRON_SECRET env var). Nothing else is accepted: no query
 * string secret, no session cookie (a logged-in browser must not be able
 * to trigger a cleanup by visiting the URL).
 *
 * Fails closed: a missing or short CRON_SECRET refuses every call, so a
 * deployment that forgot the variable can't be triggered by anyone. The
 * server log names the variable once, never its value.
 */

/** Same floor as SESSION_SECRET: long enough that guessing is hopeless. */
export const MIN_CRON_SECRET_LENGTH = 32;

export type CronAuthResult = "ok" | "denied" | "unavailable";

type Env = Record<string, string | undefined>;

let loggedMisconfig = false;

function logMisconfigOnce(): void {
  if (loggedMisconfig) return;
  loggedMisconfig = true;
  console.error(
    `[cron] CRON_SECRET is not set or shorter than ${MIN_CRON_SECRET_LENGTH} characters. Cleanup requests are refused until it is fixed.`,
  );
}

/**
 * `authorization` is the raw header value (`null` when absent). The whole
 * header is compared to `Bearer <secret>` via `passwordsMatch` (SHA-256 of
 * both sides, then `timingSafeEqual`), so neither the secret nor its
 * length leaks through timing.
 */
export function checkCronAuthorization(
  authorization: string | null,
  env: Env = process.env,
): CronAuthResult {
  const secret = env.CRON_SECRET ?? "";
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    logMisconfigOnce();
    return "unavailable";
  }
  return passwordsMatch(authorization ?? "", `Bearer ${secret}`)
    ? "ok"
    : "denied";
}
