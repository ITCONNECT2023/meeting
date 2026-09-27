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

test.describe("EPIC 8: 바로 보내기 (B)", () => {
  test("주소 확인 창 렌더링, '주소 고치기' 시 입력값 보존 및 업로드 미진행", async ({ page }) => {
    await page.goto("/new?mode=b");

    await pickFile(page, "주간회의_0927.mp3");
    await page.locator("#in-title").fill("전략 기획 회의");
    await addRecipient(page, "colleague@example.com");

    // Click '올리고 바로 보내기'
    await page.getByRole("button", { name: "올리고 바로 보내기" }).click();

    // Verify confirmB modal
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "올리기 전에 받는 주소를 확인하세요" })).toBeVisible();
    await expect(dialog.getByText("바로 보내기 · 검토 없이 발송")).toBeVisible();
    await expect(dialog.getByText("colleague@example.com")).toBeVisible();
    await expect(dialog.getByText("주간회의_0927.mp3")).toBeVisible();

    // Click '주소 고치기'
    await dialog.getByRole("button", { name: "주소 고치기" }).click();

    // Modal closes, form screen remains, inputs intact
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("button", { name: "올리고 바로 보내기" })).toBeVisible();
    await expect(page.getByText("주간회의_0927.mp3").first()).toBeVisible();
    await expect(page.locator("#in-title")).toHaveValue("전략 기획 회의");
    await expect(page.getByText("colleague@example.com").first()).toBeVisible();
  });

  test("B 전체 흐름: 4단계 처리 화면 -> 자동 발송 -> 검토 없이 바로 보냈습니다 결과 화면", async ({ page }) => {
    await page.goto("/new?mode=b");

    await pickFile(page, "마케팅_주간회의.mp3");
    await addRecipient(page, "team_b@example.com");

    // Submit opens confirm modal
    await page.getByRole("button", { name: "올리고 바로 보내기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Click '이 주소로 올리고 보내기'
    const confirmBtn = dialog.getByRole("button", { name: "이 주소로 올리고 보내기" });
    await confirmBtn.click();

    // Processing screen with 4 steps
    await expect(page.getByText("회의록을 만든 뒤 바로 보냅니다")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("녹음 파일 올리기")).toBeVisible();
    await expect(page.getByText("스크립트 만들기")).toBeVisible();
    await expect(page.getByText("회의록 만들기")).toBeVisible();
    await expect(page.getByText("메일 보내기")).toBeVisible();
    await expect(
      page.getByText("올리기가 끝나면 창을 닫아도 메일이 나갑니다."),
    ).toBeVisible();

    // Done screen automatically appears without human review
    await expect(
      page.getByRole("heading", { name: "검토 없이 바로 보냈습니다" }),
    ).toBeVisible({ timeout: 15000 });

    await expect(
      page.getByText("회의록을 받는 사람 1명에게 검토 없이 바로 보냈습니다."),
    ).toBeVisible();

    // Recipient list displayed and resolves to "보냄"
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("team_b@example.com"),
    ).toBeVisible();
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("보냄"),
    ).toBeVisible({ timeout: 10000 });

    // Done actions visible
    await expect(
      page.locator("aside:visible, div[class*='bottomFixedBar']:visible").getByRole("button", { name: ".md 내려받기" }),
    ).toBeVisible();
    await expect(
      page.locator("aside:visible, div[class*='bottomFixedBar']:visible").getByRole("button", { name: /새 회의록/ }),
    ).toBeVisible();

    // Review edit controls must NOT be present
    await expect(page.getByRole("button", { name: "고치기" })).toHaveCount(0);
  });

  test("가짜 AI에서 _fail 파일이면 처리 실패 표시 및 메일 0통", async ({ page }) => {
    await page.goto("/new?mode=b");

    await pickFile(page, "meeting_fail.mp3");
    await addRecipient(page, "fail_test@example.com");

    await page.getByRole("button", { name: "올리고 바로 보내기" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "이 주소로 올리고 보내기" }).click();

    // Processing screen with failure
    await expect(page.getByText("회의록을 만든 뒤 바로 보냅니다")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("실패").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("main").getByRole("button", { name: "다시 시도" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("main").getByRole("button", { name: "처음으로" })).toBeVisible({ timeout: 15000 });

    // Never navigates to Done screen
    await expect(page.getByRole("heading", { name: "검토 없이 바로 보냈습니다" })).not.toBeVisible();
  });
});
