import { NextResponse, type NextRequest } from "next/server";

import { resolveClientIp } from "@/lib/auth/client-ip";
import { readAuthConfig } from "@/lib/auth/env";
import { attemptLogin } from "@/lib/auth/lockout";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordsMatch,
} from "@/lib/auth/session";
import { getStore } from "@/lib/store";

/**
 * EPIC 1-4 (F13): POST `{ password }` → 200 + session cookie,
 * 401 `{ code: "AUTH_WRONG" }`, or 429 `{ code: "AUTH_LOCKED" }`.
 *
 * The browser only ever gets these codes (TRD §6); it maps them to the
 * FRD wording itself. Nothing here logs the password or the cookie.
 */

export const dynamic = "force-dynamic";

/** Longest password we will even compare. Longer counts as wrong. */
const MAX_PASSWORD_LENGTH = 256;
/** Request bodies past this are not read further (counts as wrong). */
const MAX_BODY_BYTES = 2048;

type ErrorCode =
  | "AUTH_WRONG"
  | "AUTH_LOCKED"
  | "AUTH_UNAVAILABLE"
  | "AUTH_FORBIDDEN"
  | "BAD_REQUEST";

function errorResponse(code: ErrorCode, status: number): NextResponse {
  return NextResponse.json(
    { code },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Reads at most `limit` bytes of the body; `null` if it is larger. */
async function readLimitedBody(
  request: NextRequest,
  limit: number,
): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Extracts the password, or `null` for anything that isn't a sane one. */
function parsePassword(body: string | null): string | null {
  if (body === null) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { password } = parsed as Record<string, unknown>;
    if (typeof password !== "string") return null;
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
      return null;
    }
    return password;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Cross-site pages must not be able to burn this network's attempts
  // (which would lock the whole office out). Browsers send
  // Sec-Fetch-Site; a JSON content type also forces a CORS preflight,
  // which proxy.ts answers with 401.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return errorResponse("AUTH_FORBIDDEN", 403);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    return errorResponse("BAD_REQUEST", 415);
  }

  const auth = readAuthConfig();
  if (!auth.ok) return errorResponse("AUTH_UNAVAILABLE", 503);
  const { accessPassword, sessionSecret, cookieSecure, trustProxyHeaders } =
    auth.config;

  const password = parsePassword(
    await readLimitedBody(request, MAX_BODY_BYTES),
  );
  const clientIp = resolveClientIp(request.headers, trustProxyHeaders);

  const result = await attemptLogin(
    getStore(),
    clientIp,
    () => password !== null && passwordsMatch(password, accessPassword),
  );

  if (result === "locked") return errorResponse("AUTH_LOCKED", 429);
  if (result === "wrong") return errorResponse("AUTH_WRONG", 401);

  const response = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: createSessionToken(
      { secret: sessionSecret, password: accessPassword },
      { now: Date.now() },
    ),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: cookieSecure,
  });
  return response;
}
