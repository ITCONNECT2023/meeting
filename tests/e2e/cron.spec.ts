import { expect, test } from "@playwright/test";

import { CRON_TEST_SECRET, WORKFLOW_TEST_QUEUE_SECRET } from "./helpers";

// EPIC 9-1: GET /api/cron/cleanup answers only to
// `Authorization: Bearer <CRON_SECRET>`, never to the session cookie; and
// the Workflow queue endpoints can't be called directly. Pure HTTP checks,
// run once (pc project). The pc project is logged in (storageState), so
// `request` carries a valid session cookie.

const CLEANUP = "/api/cron/cleanup";

test.describe("청소 API 권한", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "pc", "HTTP checks run once");
  });

  test("Authorization 없이 부르면 로그인 쿠키가 있어도 401", async ({
    request,
  }) => {
    const state = await request.storageState();
    expect(state.cookies.some((c) => c.name === "meeting_session")).toBe(true);

    const response = await request.get(CLEANUP, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ code: "CRON_AUTH_REQUIRED" });
  });

  test("쿠키도 Authorization도 없으면 401", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      const response = await anonymous.get(CLEANUP, { maxRedirects: 0 });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ code: "CRON_AUTH_REQUIRED" });
    } finally {
      await anonymous.dispose();
    }
  });

  test("틀린 비밀값·다른 형식이면 401", async ({ request }) => {
    for (const authorization of [
      "Bearer wrong-secret",
      `Bearer ${CRON_TEST_SECRET}x`,
      `bearer ${CRON_TEST_SECRET}`,
      CRON_TEST_SECRET,
      `Basic ${CRON_TEST_SECRET}`,
    ]) {
      const response = await request.get(CLEANUP, {
        headers: { authorization },
        maxRedirects: 0,
      });
      expect(response.status(), authorization).toBe(401);
      expect(await response.json()).toEqual({ code: "CRON_AUTH_REQUIRED" });
    }
  });

  test("비밀값을 주소(query)로 보내도 401", async ({ request }) => {
    const response = await request.get(
      `${CLEANUP}?secret=${CRON_TEST_SECRET}&token=${CRON_TEST_SECRET}`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(401);
  });

  test("맞는 Bearer면 200과 4개 구역의 개수만 돌려준다", async ({
    playwright,
    baseURL,
  }) => {
    // No cookie: the bearer alone is enough (that's what Vercel Cron sends).
    const cron = await playwright.request.newContext({ baseURL });
    try {
      const response = await cron.get(CLEANUP, {
        headers: { authorization: `Bearer ${CRON_TEST_SECRET}` },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const report = await response.json();
      expect(report.dryRun).toBe(false);
      for (const key of ["uploads", "geminiFiles", "workflowRuns", "mail"]) {
        expect(report[key], key).toEqual({
          deleted: expect.any(Number),
          kept: expect.any(Number),
        });
      }
    } finally {
      await cron.dispose();
    }
  });

  test("GET이 아닌 방식은 받지 않는다", async ({ request }) => {
    const response = await request.post(CLEANUP, {
      headers: { authorization: `Bearer ${CRON_TEST_SECRET}` },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(405);
  });
});

test.describe("Workflow 내부 주소", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "pc", "HTTP checks run once");
  });

  // A forged "start this run" delivery. It must never reach the runtime.
  const forgedDelivery = {
    headers: {
      "content-type": "application/json",
      "x-vqs-queue-name": "__wkf_workflow_forged",
      "x-vqs-message-id": "msg_01J00000000000000000000000",
      "x-vqs-message-attempt": "1",
    },
    data: { runId: "wrun_01J00000000000000000000000" },
    maxRedirects: 0,
  };

  test("직접 부르면 로그인 쿠키가 있어도 404", async ({ request }) => {
    for (const path of [
      "/.well-known/workflow/v1/flow",
      "/.well-known/workflow/v1/step",
      "/.well-known/workflow/v1/webhook/anything",
    ]) {
      const response = await request.post(path, forgedDelivery);
      expect(response.status(), path).toBe(404);
    }
  });

  test("틀린 비밀 경로로 부르면 404", async ({ request }) => {
    for (const path of [
      `/_workflow/${WORKFLOW_TEST_QUEUE_SECRET}x/.well-known/workflow/v1/flow`,
      `/_workflow/wrong/.well-known/workflow/v1/flow`,
      `/_workflow/${WORKFLOW_TEST_QUEUE_SECRET}/.well-known/workflow/v1/webhook/x`,
    ]) {
      const response = await request.post(path, forgedDelivery);
      expect(response.status(), path).toBe(404);
    }
  });
});
