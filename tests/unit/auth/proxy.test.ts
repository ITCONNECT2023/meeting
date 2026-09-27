import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";
import { proxy } from "@/proxy";

const PASSWORD = "unit-test-password";
const SECRET = "unit-test-session-secret-0123456789abcdef";
const BASE = "http://localhost:3000";

function request(
  path: string,
  init: { method?: string; cookie?: string; headers?: Record<string, string> } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (init.cookie !== undefined) {
    headers.set("cookie", `${SESSION_COOKIE_NAME}=${init.cookie}`);
  }
  return new NextRequest(new URL(path, BASE), {
    method: init.method ?? "GET",
    headers,
  });
}

function validCookie(): string {
  return createSessionToken(
    { secret: SECRET, password: PASSWORD },
    { now: Date.now() },
  );
}

function isPassThrough(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

async function expectApiDenied(response: Response) {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ code: "AUTH_REQUIRED" });
}

function expectLoginRedirect(response: Response) {
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(`${BASE}/login`);
}

beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", PASSWORD);
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("TRUST_PROXY_HEADERS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("proxy: without a cookie", () => {
  it.each(["/", "/new", "/new?mode=a", "/?_rsc=abc", "/_next/image?url=%2F&w=64&q=75", "/login/extra", "/LOGIN"])(
    "redirects page %s to /login",
    (path) => {
      expectLoginRedirect(proxy(request(path)));
    },
  );

  it("redirects RSC / prefetch / server-action requests too", () => {
    expectLoginRedirect(proxy(request("/", { headers: { RSC: "1" } })));
    expectLoginRedirect(
      proxy(request("/new", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } })),
    );
    expectLoginRedirect(
      proxy(request("/", { method: "POST", headers: { "Next-Action": "x" } })),
    );
    expectLoginRedirect(proxy(request("/login", { method: "POST" })));
  });

  it.each(["/api/jobs", "/api", "/api/auth/", "/api/auth/extra"])(
    "answers 401 JSON for API %s",
    async (path) => {
      await expectApiDenied(proxy(request(path)));
    },
  );

  it("only lets POST reach /api/auth", async () => {
    await expectApiDenied(proxy(request("/api/auth")));
    await expectApiDenied(proxy(request("/api/auth", { method: "OPTIONS" })));
    expect(isPassThrough(proxy(request("/api/auth", { method: "POST" })))).toBe(
      true,
    );
  });

  it("passes through workflow internal endpoints without a cookie", () => {
    expect(isPassThrough(proxy(request("/.well-known/workflow/v1/flow", { method: "POST" })))).toBe(
      true,
    );
  });

  it.each([
    "/login",
    "/_next/static/chunks/app.js",
    "/_next/static/media/font.woff2",
    "/favicon.ico",
    "/robots.txt",
  ])("lets %s through", (path) => {
    expect(isPassThrough(proxy(request(path)))).toBe(true);
  });

  it("does not treat look-alike paths as static", () => {
    expectLoginRedirect(proxy(request("/_next/staticx")));
    expectLoginRedirect(proxy(request("/_next/static")));
    expectLoginRedirect(proxy(request("/favicon.ico.html")));
    expectLoginRedirect(proxy(request("/_next/static/../../new")));
  });
});

describe("proxy: with a cookie", () => {
  it("lets a valid cookie through to pages and APIs", () => {
    const cookie = validCookie();
    expect(isPassThrough(proxy(request("/", { cookie })))).toBe(true);
    expect(isPassThrough(proxy(request("/api/jobs", { cookie })))).toBe(true);
  });

  it("rejects garbage, tampered and wrong-password cookies", async () => {
    const good = validCookie();
    const forged = [
      "garbage",
      `${good}x`,
      good.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
      createSessionToken(
        { secret: SECRET, password: "old-password" },
        { now: Date.now() },
      ),
    ];
    for (const cookie of forged) {
      expectLoginRedirect(proxy(request("/", { cookie })));
      await expectApiDenied(proxy(request("/api/jobs", { cookie })));
    }
  });
});

describe("proxy: fails closed on bad config", () => {
  it.each([
    ["ACCESS_PASSWORD missing", { ACCESS_PASSWORD: "" }],
    ["SESSION_SECRET missing", { SESSION_SECRET: "" }],
    ["SESSION_SECRET too short", { SESSION_SECRET: "short-secret" }],
  ])("%s → deny even a cookie that used to be valid", async (_label, env) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const cookie = validCookie();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    expectLoginRedirect(proxy(request("/", { cookie })));
    await expectApiDenied(proxy(request("/api/jobs", { cookie })));
    // The login page itself still loads (it shows a generic error).
    expect(isPassThrough(proxy(request("/login")))).toBe(true);

    // Logs name the variable, never a value.
    for (const call of errors.mock.calls) {
      const line = call.join(" ");
      expect(line).not.toContain(PASSWORD);
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("short-secret");
    }
  });
});

describe("proxy: client address for /api/auth", () => {
  function forwardedHeaderOverrides(response: Response): string[] {
    return (response.headers.get("x-middleware-override-headers") ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
  }

  it("strips client-supplied forwarding headers when proxies are not trusted", () => {
    const response = proxy(
      request("/api/auth", {
        method: "POST",
        headers: {
          "x-forwarded-for": "6.6.6.6",
          "x-real-ip": "6.6.6.6",
          forwarded: "for=6.6.6.6",
          "content-type": "application/json",
        },
      }),
    );
    const kept = forwardedHeaderOverrides(response);
    expect(kept).toContain("content-type");
    expect(kept).not.toContain("x-forwarded-for");
    expect(kept).not.toContain("x-real-ip");
    expect(kept).not.toContain("forwarded");
  });

  it("leaves them alone when TRUST_PROXY_HEADERS=true", () => {
    vi.stubEnv("TRUST_PROXY_HEADERS", "true");
    const response = proxy(
      request("/api/auth", {
        method: "POST",
        headers: { "x-forwarded-for": "6.6.6.6" },
      }),
    );
    expect(isPassThrough(response)).toBe(true);
    expect(response.headers.get("x-middleware-override-headers")).toBeNull();
  });
});
