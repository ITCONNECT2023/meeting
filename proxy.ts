import { NextResponse, type NextRequest } from "next/server";

import { FORWARDING_HEADERS } from "@/lib/auth/client-ip";
import { isValidSessionCookie } from "@/lib/auth/check";
import { readAuthConfig } from "@/lib/auth/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { decideWorkflowRoute } from "@/lib/auth/workflow-queue";

/**
 * EPIC 1-4 (F13): every page and API goes through here first. (TRD calls
 * this `middleware.ts`; Next 16 renamed that convention to `proxy.ts`.)
 *
 * There is deliberately no `config.matcher`: a matcher that forgets a path
 * silently removes protection, so this runs on every request and the
 * (tiny) allow-list below is the only thing that lets a request through
 * without a valid cookie. Anything not on it needs the cookie:
 *
 * - `/login`             GET/HEAD only (the page itself redirects to `/`
 *                        when the cookie is already valid)
 * - `POST /api/auth`     the login endpoint
 * - `GET /api/cron/cleanup`  exact path, GET only (EPIC 9-1). The route
 *                        itself demands `Authorization: Bearer
 *                        <CRON_SECRET>`, cookie or not.
 * - `POST /api/upload/token` exact path, POST only (EPIC 10-3). Blob's
 *                        completion callback arrives without a cookie, so
 *                        the route checks the cookie itself for token
 *                        requests and verifies the callback's signature.
 * - `/_next/static/...`  build assets (JS/CSS/next/font files)
 * - `/favicon.ico`, `/robots.txt`
 * - Workflow queue deliveries, which carry their own credential instead
 *   of a cookie (lib/auth/workflow-queue.ts): on Vercel the platform-
 *   protected `/.well-known/workflow/v1/{flow,step}`; locally only via
 *   `/_workflow/<secret>/...` from WORKFLOW_LOCAL_BASE_URL. Any other
 *   `/.well-known/workflow/*` or `/_workflow/*` request gets 404, even
 *   with a cookie.
 *
 * `/_next/image` is NOT allowed: nothing on the login page uses it, and
 * the image optimizer fetches arbitrary local URLs.
 *
 * Without a valid cookie: pages → 307 to `/login`; `/api/*` → 401
 * `{ code: "AUTH_REQUIRED" }` (no redirect). Missing/short
 * ACCESS_PASSWORD or SESSION_SECRET means no cookie can verify, so
 * everything is denied (fail closed; `readAuthConfig` logs the var name).
 */

const LOGIN_PATH = "/login";
const AUTH_API_PATH = "/api/auth";
/**
 * Compared with `===` against `nextUrl.pathname`, which is already
 * WHATWG-normalized (`..`/`.` segments resolved, `%2e%2e` too) — the
 * same path the router resolves. Anything that isn't byte-for-byte this
 * string (trailing slash, other case, `%2F`/`%63` encodings, a suffix)
 * falls through to the cookie check, i.e. fails closed.
 */
const CRON_CLEANUP_PATH = "/api/cron/cleanup";
/** EPIC 10-3: see the note in the header; the route does its own check. */
const UPLOAD_TOKEN_PATH = "/api/upload/token";

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * For `POST /api/auth`: unless proxies are trusted, drop client-supplied
 * forwarding headers so the route handler sees the socket address Next
 * fills in (see lib/auth/client-ip.ts).
 */
function passLoginRequest(request: NextRequest, trustProxyHeaders: boolean) {
  if (trustProxyHeaders) return NextResponse.next();
  const headers = new Headers(request.headers);
  for (const name of FORWARDING_HEADERS) headers.delete(name);
  return NextResponse.next({ request: { headers } });
}

function deny(request: NextRequest): NextResponse {
  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json(
      { code: "AUTH_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const response = NextResponse.redirect(new URL(LOGIN_PATH, request.url), 307);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const method = request.method;

  if (isStaticAsset(pathname)) return NextResponse.next();

  const workflow = decideWorkflowRoute(pathname);
  if (workflow.kind === "pass") return NextResponse.next();
  if (workflow.kind === "deny") return notFound();
  if (workflow.kind === "rewrite") {
    // Same origin, same method/headers/body; only the path changes.
    const url = request.nextUrl.clone();
    url.pathname = workflow.pathname;
    return NextResponse.rewrite(url);
  }

  if (pathname === CRON_CLEANUP_PATH && method === "GET") {
    return NextResponse.next();
  }

  if (pathname === UPLOAD_TOKEN_PATH && method === "POST") {
    return NextResponse.next();
  }

  if (pathname === LOGIN_PATH && (method === "GET" || method === "HEAD")) {
    return NextResponse.next();
  }

  if (pathname === AUTH_API_PATH && method === "POST") {
    // The route handler answers AUTH_UNAVAILABLE itself when misconfigured.
    const auth = readAuthConfig();
    return passLoginRequest(request, auth.ok && auth.config.trustProxyHeaders);
  }

  if (!isValidSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value)) {
    return deny(request);
  }

  return NextResponse.next();
}
