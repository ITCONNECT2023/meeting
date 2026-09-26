import http from "node:http";

import { expect, test, type Page } from "@playwright/test";

import {
  LOCKED_MESSAGE,
  LOGGED_OUT,
  TEST_PASSWORD,
  WRONG_MESSAGE,
  uniqueClientIp,
} from "./helpers";

// F13 접속 암호. Browser flows run at all three widths; pure HTTP checks
// run once (pc project).

/** The form's error line (Next also renders an empty route announcer alert). */
function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}

async function submitPassword(page: Page, password: string) {
  const input = page.getByLabel("접속 암호");
  await input.fill(password);
  const responded = page.waitForResponse(
    (r) => r.url().endsWith("/api/auth") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "들어가기" }).click();
  await responded;
}

test.describe("로그인하지 않은 기기", () => {
  test.use({ storageState: LOGGED_OUT });

  test.beforeEach(async ({ page }) => {
    // Own lockout counter per test (server trusts x-forwarded-for in e2e).
    await page.setExtraHTTPHeaders({ "x-forwarded-for": uniqueClientIp() });
  });

  test("암호 없이 / 를 열면 접속 암호 화면이 나온다", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");

    await expect(
      page.getByRole("heading", { level: 1, name: "회의록 자동 작성" }),
    ).toBeVisible();
    await expect(
      page.getByText("팀 공용 암호를 입력하세요. 이 기기에서는 30일 동안 다시 묻지 않습니다."),
    ).toBeVisible();

    const input = page.getByLabel("접속 암호");
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).toHaveAttribute("autocomplete", "current-password");
    await expect(input).toBeFocused();

    // Common header, brand only.
    const header = page.locator("header");
    await expect(header.getByText("회의록 자동 작성")).toBeVisible();
    await expect(header.getByText("검토 후 보내기", { exact: true })).toHaveCount(0);
    await expect(header.getByText("바로 보내기", { exact: true })).toHaveCount(0);
    await expect(header.getByRole("link", { name: "처음으로" })).toHaveCount(0);

    // Touch targets and no horizontal scroll at every width.
    const button = page.getByRole("button", { name: "들어가기" });
    for (const box of [await input.boundingBox(), await button.boundingBox()]) {
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  });

  test("/new?mode=a 도 쿠키 없이는 접속 암호 화면으로 간다", async ({ page }) => {
    await page.goto("/new?mode=a");
    await expect(page).toHaveURL("/login");
    await expect(page.getByLabel("접속 암호")).toBeVisible();
  });

  test("틀린 암호에 '암호가 맞지 않습니다.'가 빨간 글씨로 나온다", async ({
    page,
  }) => {
    await page.goto("/login");
    await submitPassword(page, "wrong-password");

    const alert = formAlert(page);
    await expect(alert).toHaveText(WRONG_MESSAGE);
    await expect(alert).toHaveCSS("color", "rgb(179, 38, 30)");
    await expect(alert.locator("svg")).toHaveCount(1);

    const input = page.getByLabel("접속 암호");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveCSS("border-top-color", "rgb(179, 38, 30)");
    await expect(page).toHaveURL("/login");
  });

  test("5번 틀리면 잠기고, 잠긴 동안에는 맞는 암호도 거절된다", async ({
    page,
  }) => {
    await page.goto("/login");
    for (let i = 1; i <= 4; i++) {
      await submitPassword(page, `wrong-${i}`);
      await expect(formAlert(page)).toHaveText(WRONG_MESSAGE);
    }
    await submitPassword(page, "wrong-5");
    await expect(formAlert(page)).toHaveText(LOCKED_MESSAGE);

    await submitPassword(page, TEST_PASSWORD);
    await expect(formAlert(page)).toHaveText(LOCKED_MESSAGE);
    await expect(page).toHaveURL("/login");

    // Still locked after a reload, too.
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  test("맞는 암호를 넣으면 처음 화면이 열리고, 다시 열어도 묻지 않는다", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
    await submitPassword(page, TEST_PASSWORD);

    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("link", { name: /검토 후 보내기로 시작/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /바로 보내기로 시작/ }),
    ).toBeVisible();

    // A brand-new tab in the same browser profile: no password asked.
    const again = await context.newPage();
    await again.goto("/");
    await expect(again).toHaveURL("/");
    await expect(
      again.getByRole("link", { name: /검토 후 보내기로 시작/ }),
    ).toBeVisible();

    // Visiting /login while logged in goes home.
    await again.goto("/login");
    await expect(again).toHaveURL("/");
  });
});

test.describe("로그인한 기기", () => {
  test("/login 을 열면 처음 화면으로 돌아간다", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL("/");
  });
});

test.describe("HTTP 수준 검사", () => {
  test.use({ storageState: LOGGED_OUT });

  test.beforeEach(() => {
    test.skip(test.info().project.name !== "pc", "HTTP checks run once");
  });

  test("쿠키 없이 API를 부르면 401 AUTH_REQUIRED (리다이렉트 없음)", async ({
    request,
  }) => {
    for (const method of ["GET", "POST", "DELETE"] as const) {
      const response = await request.fetch("/api/jobs", {
        method,
        maxRedirects: 0,
      });
      expect(response.status()).toBe(401);
      expect(response.headers()["location"]).toBeUndefined();
      expect(await response.json()).toEqual({ code: "AUTH_REQUIRED" });
    }
    const getAuth = await request.get("/api/auth", { maxRedirects: 0 });
    expect(getAuth.status()).toBe(401);
  });

  test("가짜·망가진 쿠키로는 API가 열리지 않는다", async ({ request }) => {
    const forged = [
      "garbage",
      "eyJ2IjoxLCJpYXQiOjAsImV4cCI6OTk5OTk5OTk5OSwicHYiOiJ4In0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "a.b",
      "",
    ];
    for (const value of forged) {
      const response = await request.get("/api/jobs", {
        headers: { cookie: `meeting_session=${value}` },
        maxRedirects: 0,
      });
      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ code: "AUTH_REQUIRED" });

      const page = await request.get("/", {
        headers: { cookie: `meeting_session=${value}` },
        maxRedirects: 0,
      });
      expect(page.status()).toBe(307);
      expect(page.headers()["location"]).toBe("/login");
    }
  });

  test("발급 쿠키는 HttpOnly·SameSite=Lax·30일이고 Secure가 없다 (COOKIE_SECURE=false)", async ({
    request,
  }) => {
    const response = await request.post("/api/auth", {
      data: { password: TEST_PASSWORD },
      headers: { "x-forwarded-for": uniqueClientIp() },
    });
    expect(response.status()).toBe(200);
    const setCookie = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);
    expect(setCookie).toHaveLength(1);
    const cookie = setCookie[0];
    expect(cookie).toMatch(/^meeting_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*Max-Age=2592000/i);
    expect(cookie).not.toMatch(/;\s*Secure/i);
    expect(cookie).not.toContain(TEST_PASSWORD);

    // And that cookie opens the API gate (404: the route doesn't exist yet).
    const value = cookie.split(";")[0];
    const gated = await request.get("/api/jobs", {
      headers: { cookie: value },
      maxRedirects: 0,
    });
    expect(gated.status()).toBe(404);
  });

  test("/api/auth 는 오류 코드만 돌려준다", async ({ request }) => {
    const ip = uniqueClientIp();
    const wrong = await request.post("/api/auth", {
      data: { password: "nope" },
      headers: { "x-forwarded-for": ip },
    });
    expect(wrong.status()).toBe(401);
    expect(await wrong.json()).toEqual({ code: "AUTH_WRONG" });
    expect(wrong.headers()["set-cookie"]).toBeUndefined();

    const tooLong = await request.post("/api/auth", {
      data: { password: "x".repeat(300) },
      headers: { "x-forwarded-for": uniqueClientIp() },
    });
    expect(await tooLong.json()).toEqual({ code: "AUTH_WRONG" });

    const badShape = await request.post("/api/auth", {
      data: { password: 12345 },
      headers: { "x-forwarded-for": uniqueClientIp() },
    });
    expect(await badShape.json()).toEqual({ code: "AUTH_WRONG" });

    const huge = await request.post("/api/auth", {
      data: { password: TEST_PASSWORD, pad: "x".repeat(10_000) },
      headers: { "x-forwarded-for": uniqueClientIp() },
    });
    expect(huge.status()).toBe(401);

    // Not JSON / cross-site: refused without counting as an attempt.
    const form = await request.post("/api/auth", {
      form: { password: TEST_PASSWORD },
      headers: { "x-forwarded-for": uniqueClientIp() },
    });
    expect(form.status()).toBe(415);
    const crossSite = await request.post("/api/auth", {
      data: { password: TEST_PASSWORD },
      headers: {
        "x-forwarded-for": uniqueClientIp(),
        "sec-fetch-site": "cross-site",
      },
    });
    expect(crossSite.status()).toBe(403);
  });

  test("경로 꼼수로 문을 우회할 수 없다", async ({ request, baseURL }) => {
    // Next internals and alternate request shapes for a protected page.
    const cases: { path: string; headers?: Record<string, string> }[] = [
      { path: "/", headers: { RSC: "1" } },
      { path: "/new", headers: { RSC: "1", "Next-Router-Prefetch": "1" } },
      { path: "/?_rsc=abc" },
      { path: "/new?mode=a&_rsc=1" },
      { path: "/%6Eew" },
      { path: "/_next/image?url=%2F&w=64&q=75" },
    ];
    for (const { path, headers } of cases) {
      const response = await request.get(path, { headers, maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      expect(response.headers()["location"], path).toBe("/login");
    }

    // Pages-router data URLs are normalized to the page path before the
    // proxy runs; Next answers the redirect in its data-route form.
    const data = await request.get("/_next/data/build/index.json", {
      maxRedirects: 0,
    });
    expect(data.status()).toBe(307);
    expect(data.headers()["x-nextjs-redirect"]).toMatch(/login\.json$/);

    // Trailing slash: Next's own 308 first, which then lands on the gate.
    const slash = await request.get("/new/", { maxRedirects: 0 });
    expect(slash.status()).toBe(308);
    const followed = await request.get("/new/");
    expect(new URL(followed.url()).pathname).toBe("/login");

    // Server action POST to a page.
    const action = await request.post("/", {
      headers: { "Next-Action": "abc" },
      maxRedirects: 0,
    });
    expect(action.status()).toBe(307);

    // Raw, un-normalized paths (Playwright/fetch would normalize them).
    const origin = new URL(baseURL!);
    const raw = (path: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          { host: origin.hostname, port: origin.port, path, method: "GET" },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on("error", reject);
        req.end();
      });
    for (const path of [
      "/_next/static/../../new",
      "/_next/static/..%2F..%2Fnew",
      "/login/../new",
      "/login%2F..%2Fnew",
      "/new/../login",
      "/new/%2e%2e/login",
    ]) {
      const { status, body } = await raw(path);
      expect(body, path).not.toContain("회의 녹음 올리기");
      expect(body, path).not.toContain("검토 후 보내기로 시작");
      expect([200, 307, 308, 400, 404], path).toContain(status);
    }
  });
});
