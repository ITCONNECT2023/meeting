import { expect, test, type Page } from "@playwright/test";

function mimeTypeFor(name: string): string {
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

async function pickFile(
  page: Page,
  name: string,
  buffer: Buffer = Buffer.from("fake audio content for test"),
) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: mimeTypeFor(name), buffer });
}

async function addRecipient(page: Page, address: string) {
  const input = page.getByPlaceholder("name@company.com");
  await input.fill(address);
  await input.press("Enter");
}

test.describe("EPIC 3: 올리기부터 처리까지 흐름", () => {
  test("A 전체 흐름: 올리기 -> 처리 중 화면 -> 확인 화면으로 자동 전환", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    // Verification: Processing screen appears with title or step list
    await expect(
      page.getByRole("heading", { name: "회의록을 만들고 있습니다" }),
    ).toBeVisible({ timeout: 5000 });

    await expect(page.getByText("주간회의_0922.mp3")).toBeVisible();
    await expect(page.getByText("녹음 파일 올리기")).toBeVisible();
    await expect(page.getByText("스크립트 만들기")).toBeVisible();
    await expect(page.getByText("회의록 만들기")).toBeVisible();

    // Automatically transitions to review screen
    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Minutes content rendered
    await expect(page.getByRole("article").getByText("신규 기능 출시 일정 회의", { exact: true })).toBeVisible();
    await expect(page.getByRole("article").getByText("김민수", { exact: false }).first()).toBeVisible();
  });

  test("_fail 파일: 스크립트 만들기 실패 표시, 에러 문구 및 다시 시도 동작", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "회의_fail.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    // Wait for failure
    await expect(page.getByText("실패")).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요."),
    ).toBeVisible();

    // Verify retry button is visible
    const retryBtn = page.getByRole("main").getByRole("button", { name: "다시 시도" });
    const homeBtn = page.getByRole("main").getByRole("button", { name: "처음으로" });
    await expect(retryBtn).toBeVisible();
    await expect(homeBtn).toBeVisible();

    // Clicking home returns to /
    await homeBtn.click();
    await expect(page).toHaveURL("/");
  });

  test("인증 쿠키 없는 /api/jobs 요청은 거절된다", async ({ playwright }) => {
    const unauthed = await playwright.request.newContext({ storageState: undefined });
    const res = await unauthed.post("/api/jobs", {
      data: {
        mode: "a",
        audio: { name: "test.mp3", size: 1000 },
        meetingInfo: {},
        recipients: ["user@example.com"],
      },
    });
    expect(res.status()).toBe(401);
  });

  test("존재하지 않는 작업 번호 조회 시 410 만료 안내 응답", async ({ page, request }) => {
    // Navigate with browser to establish session cookie
    await page.goto("/new?mode=a");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await request.get("/api/jobs/nonexistent-uuid-12345", {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.code).toBe("EXPIRED");
  });

  test("처리 중 새로고침 시 초기 올리기 화면으로 복귀", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "회의_fail.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();
    await expect(page.getByRole("heading", { name: "회의록을 만들고 있습니다" })).toBeVisible();

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.reload();
    await expect(page.getByRole("heading", { name: "회의 녹음 올리기" })).toBeVisible();
  });
});
