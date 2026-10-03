import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/upload/token/route";

beforeEach(() => {
  vi.stubEnv("ACCESS_PASSWORD", "test-password");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-characters-long");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function tokenRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/upload/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/upload/token", () => {
  it("refuses a token request without a session cookie", async () => {
    const res = await POST(
      tokenRequest({
        type: "blob.generate-client-token",
        payload: { pathname: "uploads/job_a.mp3", callbackUrl: "", clientPayload: "job" },
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "AUTH_REQUIRED" });
  });

  it("refuses a request with a forged session cookie", async () => {
    const res = await POST(
      tokenRequest(
        { type: "blob.generate-client-token", payload: { pathname: "uploads/job_a.mp3" } },
        "meeting_session=not-a-real-token",
      ),
    );
    expect(res.status).toBe(401);
  });

  it("refuses a body that is not JSON", async () => {
    const req = new NextRequest("http://localhost/api/upload/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
