import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordVersion,
  passwordsMatch,
  verifySessionToken,
} from "@/lib/auth/session";

const keys = {
  secret: "unit-test-session-secret-0123456789abcdef",
  password: "correct horse battery staple",
};
const T0 = Date.UTC(2026, 8, 26, 9, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Re-signs an arbitrary payload with the real key (for shape checks). */
function signRaw(payload: unknown, secret = keys.secret): string {
  const encoded = b64urlJson(payload);
  const sig = createHmac("sha256", secret)
    .update("meeting-session.v1." + encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

function flipLastChar(value: string): string {
  const last = value.at(-1);
  return value.slice(0, -1) + (last === "A" ? "B" : "A");
}

describe("session token", () => {
  it("round-trips: a fresh token verifies", () => {
    const token = createSessionToken(keys, { now: T0 });
    const result = verifySessionToken(token, keys, { now: T0 + 1000 });
    expect(result).toEqual({
      ok: true,
      expiresAt: Math.floor(T0 / 1000) * 1000 + SESSION_MAX_AGE_SECONDS * 1000,
    });
  });

  it("never contains the password or a plain hash of it", () => {
    const token = createSessionToken(keys, { now: T0 });
    const [payload] = token.split(".");
    const decoded = Buffer.from(payload, "base64url").toString("utf8");
    expect(decoded).not.toContain(keys.password);
    const json = JSON.parse(decoded) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["exp", "iat", "pv", "v"]);
    expect(json.pv).toBe(passwordVersion(keys));
    expect(json.exp).toBe((json.iat as number) + SESSION_MAX_AGE_SECONDS);
  });

  it("rejects a missing token", () => {
    for (const token of [undefined, null, ""]) {
      expect(verifySessionToken(token, keys, { now: T0 })).toEqual({
        ok: false,
        reason: "missing",
      });
    }
  });

  it.each([
    ["no dot", "abcdef"],
    ["three parts", "a.b.c"],
    ["empty payload", ".abc"],
    ["empty signature", "abc."],
    ["non-base64url characters", "ab+c/.de=f"],
    ["whitespace", "abc .def"],
    ["far too long", `${"a".repeat(600)}.${"b".repeat(43)}`],
  ])("rejects a malformed token (%s)", (_label, token) => {
    expect(verifySessionToken(token, keys, { now: T0 })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken(keys, { now: T0 });
    const [, signature] = token.split(".");
    const forgedPayload = b64urlJson({
      v: 1,
      iat: Math.floor(T0 / 1000),
      exp: Math.floor(T0 / 1000) + 10 * SESSION_MAX_AGE_SECONDS,
      pv: passwordVersion(keys),
    });
    expect(
      verifySessionToken(`${forgedPayload}.${signature}`, keys, { now: T0 }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken(keys, { now: T0 });
    expect(verifySessionToken(flipLastChar(token), keys, { now: T0 })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
    const [payload] = token.split(".");
    expect(
      verifySessionToken(`${payload}.${"A".repeat(43)}`, keys, { now: T0 }),
    ).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = createSessionToken(
      { ...keys, secret: "another-secret-that-is-also-32-chars-long!" },
      { now: T0 },
    );
    expect(verifySessionToken(token, keys, { now: T0 })).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("rejects the token after ACCESS_PASSWORD changes", () => {
    const token = createSessionToken(keys, { now: T0 });
    expect(
      verifySessionToken(
        token,
        { ...keys, password: "new team password" },
        { now: T0 },
      ),
    ).toEqual({ ok: false, reason: "wrong-version" });
  });

  it("expires exactly 30 days after issue", () => {
    const token = createSessionToken(keys, { now: T0 });
    expect(
      verifySessionToken(token, keys, { now: T0 + 30 * DAY_MS - 1000 }).ok,
    ).toBe(true);
    expect(verifySessionToken(token, keys, { now: T0 + 30 * DAY_MS })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(
      verifySessionToken(token, keys, { now: T0 + 400 * DAY_MS }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects correctly signed payloads with a bad shape", () => {
    const iat = Math.floor(T0 / 1000);
    const pv = passwordVersion(keys);
    const cases: unknown[] = [
      null,
      "string",
      [1, 2],
      { v: 2, iat, exp: iat + 60, pv },
      { v: 1, iat: "x", exp: iat + 60, pv },
      { v: 1, iat, exp: iat + 60.5, pv },
      { v: 1, iat, exp: iat + 60 },
      // exp before iat, lifetime over 30 days, iat in the future
      { v: 1, iat, exp: iat - 1, pv },
      { v: 1, iat, exp: iat + SESSION_MAX_AGE_SECONDS + 1, pv },
      { v: 1, iat: iat + 3600, exp: iat + 7200, pv },
    ];
    for (const payload of cases) {
      expect(
        verifySessionToken(signRaw(payload), keys, { now: T0 }),
      ).toEqual({ ok: false, reason: "malformed" });
    }
    // Signed garbage that isn't JSON at all.
    const garbage = Buffer.from("not json").toString("base64url");
    const sig = createHmac("sha256", keys.secret)
      .update("meeting-session.v1." + garbage)
      .digest("base64url");
    expect(verifySessionToken(`${garbage}.${sig}`, keys, { now: T0 })).toEqual(
      { ok: false, reason: "malformed" },
    );
  });

  it("password version depends on both password and secret", () => {
    const base = passwordVersion(keys);
    expect(passwordVersion({ ...keys, password: "other" })).not.toBe(base);
    expect(
      passwordVersion({ ...keys, secret: "different-secret-xxxxxxxxxxxxxxxx" }),
    ).not.toBe(base);
    expect(passwordVersion(keys)).toBe(base);
  });
});

describe("passwordsMatch", () => {
  it("matches only the exact password", () => {
    expect(passwordsMatch("test-password", "test-password")).toBe(true);
    expect(passwordsMatch("test-passwor", "test-password")).toBe(false);
    expect(passwordsMatch("test-password ", "test-password")).toBe(false);
    expect(passwordsMatch("", "test-password")).toBe(false);
    expect(passwordsMatch("x".repeat(10_000), "test-password")).toBe(false);
  });
});
