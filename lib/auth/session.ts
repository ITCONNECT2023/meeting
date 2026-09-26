import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * EPIC 1-4 (F13): signed access cookie.
 *
 * Everything here is a pure function of its inputs (secret, password,
 * current time) so it can be unit-tested without env vars or a clock.
 * Reading the env lives in `./env.ts`.
 *
 * Token format (the cookie value):
 *
 *     <payload>.<signature>
 *
 *   payload   = base64url(JSON {"v":1,"iat":<sec>,"exp":<sec>,"pv":"<pw version>"})
 *   signature = base64url(HMAC-SHA256(SESSION_SECRET, "meeting-session.v1." + payload))
 *
 * `pv` ("password version") = base64url(HMAC-SHA256(SESSION_SECRET,
 * "pw-version:" + ACCESS_PASSWORD)) truncated to 16 bytes. It changes
 * whenever ACCESS_PASSWORD changes, so every cookie issued under the old
 * password stops verifying (FRD F13: "팀에서 암호를 바꾸면 모든 기기에서
 * 다시 묻습니다"). It is keyed by the secret, so the cookie never carries
 * the password or anything that can be brute-forced offline without
 * SESSION_SECRET.
 *
 * The payload is signed, not encrypted: it holds nothing secret.
 */

export const SESSION_COOKIE_NAME = "meeting_session";

/** 30 days (FRD F13: "이 기기에서는 30일 동안 다시 묻지 않습니다"). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** SESSION_SECRET shorter than this is treated as missing (fail closed). */
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Cookie values longer than this are rejected before any parsing. */
const MAX_TOKEN_LENGTH = 512;

/** Allowed clock skew for an `iat` slightly in the future. */
const CLOCK_SKEW_SECONDS = 60;

const TOKEN_VERSION = 1;
const SIGNATURE_CONTEXT = "meeting-session.v1.";
const PASSWORD_VERSION_CONTEXT = "pw-version:";
const PASSWORD_VERSION_BYTES = 16;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface SessionKeys {
  /** SESSION_SECRET. */
  secret: string;
  /** ACCESS_PASSWORD (only ever used as HMAC input, never stored). */
  password: string;
}

export interface SessionClock {
  /** Current time in milliseconds since the epoch. */
  now: number;
}

export type SessionRejectReason =
  | "missing"
  | "malformed"
  | "bad-signature"
  | "expired"
  | "wrong-version";

export type SessionVerifyResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: SessionRejectReason };

interface SessionPayload {
  v: number;
  iat: number;
  exp: number;
  pv: string;
}

function hmac(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message, "utf8").digest();
}

/** Constant-time string equality (length is not secret here). */
function safeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Derives the password version stored in the cookie. Keyed by the secret,
 * so it is neither the password nor a plain (offline-guessable) hash of it.
 */
export function passwordVersion({ secret, password }: SessionKeys): string {
  return hmac(secret, PASSWORD_VERSION_CONTEXT + password)
    .subarray(0, PASSWORD_VERSION_BYTES)
    .toString("base64url");
}

function sign(secret: string, encodedPayload: string): string {
  return hmac(secret, SIGNATURE_CONTEXT + encodedPayload).toString("base64url");
}

/** Issues a new cookie value valid for `SESSION_MAX_AGE_SECONDS`. */
export function createSessionToken(keys: SessionKeys, { now }: SessionClock): string {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = {
    v: TOKEN_VERSION,
    iat,
    exp: iat + SESSION_MAX_AGE_SECONDS,
    pv: passwordVersion(keys),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${sign(keys.secret, encoded)}`;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parsePayload(encoded: string): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { v, iat, exp, pv } = parsed as Record<string, unknown>;
    if (v !== TOKEN_VERSION) return null;
    if (!isInteger(iat) || !isInteger(exp)) return null;
    if (typeof pv !== "string") return null;
    return { v, iat, exp, pv };
  } catch {
    return null;
  }
}

/**
 * Verifies a cookie value. Rejects: missing, malformed, bad signature,
 * expired, and tokens issued under a different ACCESS_PASSWORD. The
 * signature (and the password version) are compared in constant time, and
 * the payload is only parsed after the signature checks out.
 */
export function verifySessionToken(
  token: string | undefined | null,
  keys: SessionKeys,
  { now }: SessionClock,
): SessionVerifyResult {
  if (token === undefined || token === null || token === "") {
    return { ok: false, reason: "missing" };
  }
  if (token.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(token)) {
    return { ok: false, reason: "malformed" };
  }

  const dot = token.indexOf(".");
  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  if (!safeEqualStrings(signature, sign(keys.secret, encodedPayload))) {
    return { ok: false, reason: "bad-signature" };
  }

  const payload = parsePayload(encodedPayload);
  if (!payload) return { ok: false, reason: "malformed" };

  const nowSeconds = now / 1000;
  if (
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > SESSION_MAX_AGE_SECONDS ||
    payload.iat > nowSeconds + CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (nowSeconds >= payload.exp) {
    return { ok: false, reason: "expired" };
  }

  if (!safeEqualStrings(payload.pv, passwordVersion(keys))) {
    return { ok: false, reason: "wrong-version" };
  }

  return { ok: true, expiresAt: payload.exp * 1000 };
}

/**
 * Compares a submitted password with ACCESS_PASSWORD in constant time.
 * Both sides are hashed first so the comparison length never depends on
 * either input (timingSafeEqual requires equal lengths).
 */
export function passwordsMatch(submitted: string, expected: string): boolean {
  const a = createHash("sha256").update(submitted, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
