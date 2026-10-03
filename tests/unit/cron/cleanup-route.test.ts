import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CleanupReport } from "@/lib/cleanup";

const runCleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cleanup", () => ({ runCleanup }));

import * as route from "@/app/api/cron/cleanup/route";

const SECRET = "unit-cron-secret-0123456789abcdefghij";
const URL_ = "http://localhost:3000/api/cron/cleanup";

function request(
  init: { method?: string; authorization?: string; cookie?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (init.authorization !== undefined) {
    headers.set("authorization", init.authorization);
  }
  if (init.cookie !== undefined) headers.set("cookie", init.cookie);
  return new NextRequest(URL_, { method: init.method ?? "GET", headers });
}

function report(overrides: Partial<CleanupReport> = {}): CleanupReport {
  return {
    startedAt: "2026-09-27T00:00:00.000Z",
    dryRun: false,
    uploads: { deleted: 2, kept: 1 },
    geminiFiles: { deleted: 0, kept: 0 },
    workflowRuns: { deleted: 5, kept: 3 },
    mail: { deleted: 7, kept: 0 },
    ...overrides,
  };
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(401);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ code: "CRON_AUTH_REQUIRED" });
  expect(runCleanup).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  runCleanup.mockReset();
  runCleanup.mockResolvedValue(report());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/cleanup: refused", () => {
  it("without an Authorization header", async () => {
    await expectRefused(await route.GET(request()));
  });

  it("with a session cookie but no bearer", async () => {
    await expectRefused(
      await route.GET(request({ cookie: "meeting_session=anything" })),
    );
  });

  it.each([
    ["wrong secret, same length", `Bearer ${SECRET.replace(/.$/, "X")}`],
    ["longer secret", `Bearer ${SECRET}x`],
    ["shorter secret", `Bearer ${SECRET.slice(0, -1)}`],
    ["empty bearer", "Bearer "],
    ["no scheme", SECRET],
    ["lower-case scheme", `bearer ${SECRET}`],
    ["other scheme", `Basic ${SECRET}`],
    ["extra space", `Bearer  ${SECRET}`],
    ["trailing text", `Bearer ${SECRET} extra`],
  ])("with %s", async (_label, authorization) => {
    await expectRefused(await route.GET(request({ authorization })));
  });

  it("does not accept the secret in the query string", async () => {
    const response = await route.GET(
      new NextRequest(`${URL_}?secret=${SECRET}&token=${SECRET}`),
    );
    await expectRefused(response);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["31 characters", "a".repeat(31)],
  ])("when CRON_SECRET is %s, even the matching bearer", async (_label, value) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    if (value === undefined) vi.stubEnv("CRON_SECRET", undefined);
    else vi.stubEnv("CRON_SECRET", value);

    await expectRefused(
      await route.GET(request({ authorization: `Bearer ${value ?? ""}` })),
    );
    await expectRefused(await route.GET(request({ authorization: "Bearer " })));

    // Logs (at most once per process) name the variable, never a value.
    for (const call of errors.mock.calls) {
      const line = call.join(" ");
      expect(line).toContain("CRON_SECRET");
      if (value) expect(line).not.toContain(value);
    }
  });
});

describe("GET /api/cron/cleanup: allowed", () => {
  it("runs the cleanup once and answers 200 with the counts", async () => {
    const response = await route.GET(
      request({ authorization: `Bearer ${SECRET}` }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(runCleanup).toHaveBeenCalledTimes(1);
    expect(runCleanup.mock.calls[0]).toEqual([]);
    await expect(response.json()).resolves.toEqual(report());
  });

  it("accepts exactly 32 characters", async () => {
    const secret = "b".repeat(32);
    vi.stubEnv("CRON_SECRET", secret);
    const response = await route.GET(
      request({ authorization: `Bearer ${secret}` }),
    );
    expect(response.status).toBe(200);
  });

  it("answers 500 with the same report when a section failed", async () => {
    const failed = report({
      geminiFiles: { deleted: 0, kept: 0, error: "GEMINI_LIST_FAILED" },
    });
    runCleanup.mockResolvedValue(failed);
    const response = await route.GET(
      request({ authorization: `Bearer ${SECRET}` }),
    );
    expect(response.status).toBe(500);
    expect(runCleanup).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual(failed);
  });

  it("passes on counts only, even if the report carries more", async () => {
    runCleanup.mockResolvedValue({
      ...report(),
      extra: "meeting.m4a",
      uploads: { deleted: 1, kept: 0, files: ["meeting.m4a"] },
    });
    const response = await route.GET(
      request({ authorization: `Bearer ${SECRET}` }),
    );
    const body = await response.text();
    expect(body).not.toContain("meeting.m4a");
    expect(JSON.parse(body).uploads).toEqual({ deleted: 1, kept: 0 });
  });

  it("answers 500 CLEANUP_FAILED without the message when it throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    runCleanup.mockRejectedValue(new Error("secret-file-name.m4a"));
    const response = await route.GET(
      request({ authorization: `Bearer ${SECRET}` }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ code: "CLEANUP_FAILED" });
    for (const call of errors.mock.calls) {
      expect(call.join(" ")).not.toContain("secret-file-name");
    }
  });
});

describe("other methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const)(
    "%s → 405 without running the cleanup",
    async (method) => {
      const handler = route[method];
      const response = await handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET");
      expect(runCleanup).not.toHaveBeenCalled();
    },
  );
});
