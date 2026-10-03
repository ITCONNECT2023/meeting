import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";
import { proxy } from "@/proxy";

const PASSWORD = "unit-test-password";
const SECRET = "unit-test-session-secret-0123456789abcdef";
const BASE = "http://localhost:3000";
const QUEUE_SECRET = "unit-queue-secret-0123456789abcdefghijk";

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
  // Local Workflow world with the queue tunnel configured, as
  // `npm run dev` does (lib/auth/workflow-queue.ts).
  vi.stubEnv(
    "WORKFLOW_LOCAL_BASE_URL",
    `http://localhost:3000/_workflow/${QUEUE_SECRET}`,
  );
  vi.stubEnv("WORKFLOW_TARGET_WORLD", "");
  vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
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

describe("proxy: GET /api/cron/cleanup (EPIC 9-1)", () => {
  const CRON = "/api/cron/cleanup";

  it("lets exactly GET /api/cron/cleanup reach the route without a cookie", () => {
    // The route then demands the CRON_SECRET bearer (tests/unit/cron).
    expect(isPassThrough(proxy(request(CRON)))).toBe(true);
    expect(isPassThrough(proxy(request(`${CRON}?x=1`)))).toBe(true);
  });

  it("still passes it with a cookie (the route refuses without the bearer)", () => {
    expect(isPassThrough(proxy(request(CRON, { cookie: validCookie() })))).toBe(true);
  });

  it.each(["POST", "HEAD", "PUT", "DELETE", "OPTIONS"])(
    "needs the cookie for %s",
    async (method) => {
      const response = proxy(request(CRON, { method }));
      expect(response.status).toBe(401);
      if (method !== "HEAD") {
        await expect(response.json()).resolves.toEqual({ code: "AUTH_REQUIRED" });
      }
    },
  );

  it.each([
    "/api/cron",
    "/api/cron/",
    "/api/cron/cleanup/",
    "/api/cron/cleanup/x",
    "/api/cron/cleanupx",
    "/api/cron/cleanup.json",
    "/api/cron/cleanup;x",
    "/api/cron/other",
    "/API/cron/cleanup",
    "/api/CRON/cleanup",
    "/api/cron/Cleanup",
    "/api/cron%2Fcleanup",
    "/api/cron%2fcleanup",
    "/api%2Fcron%2Fcleanup",
    "/api/cron/cleanup%2F",
    "/api/cron/%63leanup",
    "/api/cron/cleanup%00",
    "/api//cron/cleanup",
    "/api/cron//cleanup",
    "/api/cron/cleanup/..%2Fjobs",
    "/api/cron/cleanup/%2e%2e/%2e%2e/jobs",
    "/api/cron/cleanup/../../jobs",
    "/api/cron/cleanup/../../auth",
  ])("does not extend the exception to %s", (path) => {
    // Denied like any other cookieless request: 401 for /api/*, a login
    // redirect for what isn't /api/* byte-for-byte (/API/..., %2F).
    const response = proxy(request(path));
    expect(isPassThrough(response)).toBe(false);
    if (response.status === 307) expectLoginRedirect(response);
    else expect(response.status).toBe(401);
  });

  it("sees the WHATWG-normalized path the router also resolves", () => {
    // `..` is resolved before the proxy runs, so this *is* the cron route
    // (and still needs the bearer there).
    expect(
      new NextRequest(new URL("/api/jobs/../cron/cleanup", BASE)).nextUrl.pathname,
    ).toBe("/api/cron/cleanup");
    expect(isPassThrough(proxy(request("/api/jobs/../cron/cleanup")))).toBe(true);
  });
});

describe("proxy: Workflow queue endpoints (EPIC 9-1)", () => {
  const FLOW = "/.well-known/workflow/v1/flow";
  const STEP = "/.well-known/workflow/v1/step";
  const TUNNEL = `/_workflow/${QUEUE_SECRET}`;

  function rewriteTarget(response: Response): string | null {
    return response.headers.get("x-middleware-rewrite");
  }

  function expectNotFound(response: Response) {
    expect(response.status).toBe(404);
    expect(isPassThrough(response)).toBe(false);
    expect(rewriteTarget(response)).toBeNull();
  }

  describe("local world", () => {
    it.each([
      FLOW,
      STEP,
      "/.well-known/workflow/v1/webhook/abc",
      "/.well-known/workflow/v1/manifest.json",
    ])("refuses a direct %s, with or without a cookie", (path) => {
      expectNotFound(proxy(request(path, { method: "POST" })));
      expectNotFound(proxy(request(path, { method: "POST", cookie: validCookie() })));
      expectNotFound(proxy(request(path)));
    });

    it.each([FLOW, STEP])("rewrites a delivery through the tunnel to %s", (path) => {
      const response = proxy(request(`${TUNNEL}${path}`, { method: "POST" }));
      expect(response.status).toBe(200);
      expect(rewriteTarget(response)).toBe(`${BASE}${path}`);
    });

    it("keeps the health-check query", () => {
      const response = proxy(request(`${TUNNEL}${FLOW}?__health`));
      expect(rewriteTarget(response)).toBe(`${BASE}${FLOW}?__health`);
    });

    it.each([
      `/_workflow/${QUEUE_SECRET}x${FLOW}`,
      `/_workflow/${QUEUE_SECRET.slice(0, -1)}${FLOW}`,
      `/_workflow/${QUEUE_SECRET.toUpperCase()}${FLOW}`,
      `/_workflow/wrong${FLOW}`,
      `/_workflow/${FLOW}`,
      `/_workflow${FLOW}`,
      "/_workflow/",
      TUNNEL,
      `${TUNNEL}/`,
      `${TUNNEL}${FLOW}/`,
      `${TUNNEL}${FLOW}x`,
      `${TUNNEL}/.well-known/workflow/v1/webhook/abc`,
      `${TUNNEL}/.well-known/workflow/v1/manifest.json`,
      `${TUNNEL}/api/jobs`,
      `${TUNNEL}/new`,
      `${TUNNEL}%2F.well-known%2Fworkflow%2Fv1%2Fflow`,
    ])("refuses %s", (path) => {
      expectNotFound(proxy(request(path, { method: "POST" })));
    });

    it("does not let the tunnel reach other routes through `..`", async () => {
      // Normalized to /api/jobs before the proxy sees it: plain cookie rule.
      await expectApiDenied(
        proxy(request(`${TUNNEL}/../../api/jobs`, { method: "POST" })),
      );
    });

    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["secret too short", "http://localhost:3000/_workflow/short-secret"],
      ["no secret path", "http://localhost:3000"],
      ["other prefix", `http://localhost:3000/queue/${QUEUE_SECRET}`],
      ["nested path", `http://localhost:3000/_workflow/${QUEUE_SECRET}/more`],
      ["query string", `http://localhost:3000/_workflow/${QUEUE_SECRET}?x=1`],
      ["not a URL", "not a url"],
    ])("fails closed when WORKFLOW_LOCAL_BASE_URL is %s", (_label, value) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubEnv("WORKFLOW_LOCAL_BASE_URL", value);

      expectNotFound(proxy(request(FLOW, { method: "POST" })));
      expectNotFound(proxy(request(`${TUNNEL}${FLOW}`, { method: "POST" })));

      // Logs (once per process) name the variable, never a value.
      for (const call of errors.mock.calls) {
        const line = call.join(" ");
        expect(line).toContain("WORKFLOW_LOCAL_BASE_URL");
        expect(line).not.toContain(QUEUE_SECRET);
      }
    });
  });

  describe("Vercel world", () => {
    beforeEach(() => {
      vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test");
    });

    it.each([FLOW, STEP])("passes %s (a platform-protected queue consumer)", (path) => {
      expect(isPassThrough(proxy(request(path, { method: "POST" })))).toBe(true);
    });

    it("also when WORKFLOW_TARGET_WORLD says vercel", () => {
      vi.stubEnv("VERCEL_DEPLOYMENT_ID", "");
      vi.stubEnv("WORKFLOW_TARGET_WORLD", "vercel");
      expect(isPassThrough(proxy(request(FLOW, { method: "POST" })))).toBe(true);
    });

    it.each([
      "/.well-known/workflow/v1/webhook/abc",
      "/.well-known/workflow/v1/flow/",
      "/.well-known/workflow/v2/flow",
      `${TUNNEL}${FLOW}`,
    ])("refuses %s", (path) => {
      expectNotFound(proxy(request(path, { method: "POST" })));
    });
  });

  it("an explicit local WORKFLOW_TARGET_WORLD wins over VERCEL_DEPLOYMENT_ID", () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test");
    vi.stubEnv("WORKFLOW_TARGET_WORLD", "local");
    expectNotFound(proxy(request(FLOW, { method: "POST" })));
    expect(
      rewriteTarget(proxy(request(`${TUNNEL}${FLOW}`, { method: "POST" }))),
    ).toBe(`${BASE}${FLOW}`);
  });
});
