import { afterEach, describe, expect, it, vi } from "vitest";

import { readAuthConfig } from "@/lib/auth/env";

const good = {
  ACCESS_PASSWORD: "pw",
  SESSION_SECRET: "s".repeat(32),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readAuthConfig", () => {
  it("accepts a password and a 32+ character secret", () => {
    const result = readAuthConfig(good);
    expect(result.ok).toBe(true);
  });

  it("reads COOKIE_SECURE / TRUST_PROXY_HEADERS only when exactly 'true'", () => {
    const off = readAuthConfig({ ...good, COOKIE_SECURE: "1", TRUST_PROXY_HEADERS: "yes" });
    const on = readAuthConfig({ ...good, COOKIE_SECURE: "true", TRUST_PROXY_HEADERS: "true" });
    expect(off.ok && off.config).toMatchObject({ cookieSecure: false, trustProxyHeaders: false });
    expect(on.ok && on.config).toMatchObject({ cookieSecure: true, trustProxyHeaders: true });
  });

  it("fails closed and names the variable without its value", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "x".repeat(31);
    const result = readAuthConfig({ ACCESS_PASSWORD: "", SESSION_SECRET: secret });
    expect(result).toEqual({
      ok: false,
      problems: [
        "ACCESS_PASSWORD is not set.",
        "SESSION_SECRET is shorter than 32 characters.",
      ],
    });
    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).not.toContain(secret);
  });
});
