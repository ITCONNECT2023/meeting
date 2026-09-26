/**
 * EPIC 1-4: which address the password lockout counts against.
 *
 * Two modes, picked by TRUST_PROXY_HEADERS (see `.env.example`):
 *
 * - Off (default; `next start`/`next dev` on the LAN): a client can put
 *   anything in `x-forwarded-for`, so `proxy.ts` deletes the forwarding
 *   headers from the `/api/auth` request before it reaches the route
 *   handler. Next's server then fills `x-forwarded-for` from the TCP
 *   socket's remote address (it only sets it when absent), so what the
 *   route handler reads is the real peer address.
 * - On (behind a proxy that overwrites these headers — Vercel does): use
 *   `x-real-ip`, else the first `x-forwarded-for` entry. Turning this on
 *   without such a proxy lets clients pick their own lockout bucket.
 */

/** Headers `proxy.ts` removes from `/api/auth` when proxies aren't trusted. */
export const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
] as const;

/** Bucket used when no usable address is available (shared, fails safe). */
export const UNKNOWN_CLIENT = "unknown";

const IP_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  // IPv4 clients on a dual-stack socket show up as ::ffff:a.b.c.d.
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(ip)) ip = ip.slice(7);
  if (!IP_PATTERN.test(ip)) return null;
  return ip.toLowerCase();
}

function firstForwardedFor(headers: Headers): string | null {
  const value = headers.get("x-forwarded-for");
  if (!value) return null;
  return value.split(",")[0] ?? null;
}

export function resolveClientIp(
  headers: Headers,
  trustProxyHeaders: boolean,
): string {
  const candidate = trustProxyHeaders
    ? (normalizeIp(headers.get("x-real-ip")) ??
      normalizeIp(firstForwardedFor(headers)))
    : // Forwarding headers were stripped by proxy.ts; this is the value
      // Next's server set from the socket.
      normalizeIp(firstForwardedFor(headers));
  return candidate ?? UNKNOWN_CLIENT;
}
