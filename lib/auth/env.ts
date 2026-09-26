import "server-only";

import { MIN_SESSION_SECRET_LENGTH } from "./session";

/**
 * EPIC 1-4: the auth-related env vars, read on every call (cheap) so a
 * redeploy with new values takes effect without any cache to invalidate.
 *
 * Fails closed: if ACCESS_PASSWORD or SESSION_SECRET is missing (or the
 * secret is too short) callers get `{ ok: false }` and must deny access.
 * The server log names the offending variable, never its value.
 */

export interface AuthConfig {
  accessPassword: string;
  sessionSecret: string;
  /** `Secure` cookie attribute. Only when COOKIE_SECURE is exactly "true". */
  cookieSecure: boolean;
  /**
   * Trust `x-real-ip` / `x-forwarded-for` sent by the client connection.
   * Only turn on behind a proxy that overwrites them (e.g. Vercel). Off:
   * the proxy strips them and Next fills in the socket address.
   */
  trustProxyHeaders: boolean;
}

export type AuthConfigResult =
  | { ok: true; config: AuthConfig }
  | { ok: false; problems: string[] };

type Env = Record<string, string | undefined>;

const loggedProblems = new Set<string>();

function logOnce(problem: string): void {
  if (loggedProblems.has(problem)) return;
  loggedProblems.add(problem);
  console.error(`[auth] ${problem} All requests are denied until it is fixed.`);
}

export function readAuthConfig(env: Env = process.env): AuthConfigResult {
  const problems: string[] = [];

  const accessPassword = env.ACCESS_PASSWORD ?? "";
  if (accessPassword === "") {
    problems.push("ACCESS_PASSWORD is not set.");
  }

  const sessionSecret = env.SESSION_SECRET ?? "";
  if (sessionSecret === "") {
    problems.push("SESSION_SECRET is not set.");
  } else if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    problems.push(
      `SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters.`,
    );
  }

  if (problems.length > 0) {
    problems.forEach(logOnce);
    return { ok: false, problems };
  }

  return {
    ok: true,
    config: {
      accessPassword,
      sessionSecret,
      cookieSecure: env.COOKIE_SECURE === "true",
      trustProxyHeaders: env.TRUST_PROXY_HEADERS === "true",
    },
  };
}
