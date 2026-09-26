import "server-only";

import { readAuthConfig } from "./env";
import { verifySessionToken } from "./session";

/**
 * True when `cookieValue` is a valid, unexpired session cookie for the
 * current ACCESS_PASSWORD. False whenever the auth env is unusable
 * (fail closed).
 */
export function isValidSessionCookie(cookieValue: string | undefined): boolean {
  const auth = readAuthConfig();
  if (!auth.ok) return false;
  return verifySessionToken(
    cookieValue,
    { secret: auth.config.sessionSecret, password: auth.config.accessPassword },
    { now: Date.now() },
  ).ok;
}
