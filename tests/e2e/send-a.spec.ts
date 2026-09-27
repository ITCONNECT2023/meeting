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

test.describe("EPIC 7: 메일 보내기 (검토 후 보내기 A)", () => {
  test("발송 확인 창 렌더링 및 취소 동작", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "user1@example.com");
    await addRecipient(page, "user2@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Click '메일 보내기'
    await page.getByRole("button", { name: "메일 보내기" }).first().click();

    // Verify confirm modal
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "이 내용으로 메일을 보낼까요?" })).toBeVisible();
    await expect(dialog.getByText("검토 후 보내기")).toBeVisible();
    await expect(dialog.getByText("user1@example.com")).toBeVisible();
    await expect(dialog.getByText("user2@example.com")).toBeVisible();
    await expect(
      dialog.getByText("화면에서 고친 내용이 메일 본문과 첨부 파일에 그대로 들어갑니다."),
    ).toBeVisible();

    // Cancel modal
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible();
  });

  test("발송 성공 및 주소별 '확인 중' -> '보냄' 상태 전이, 메일을 보냈습니다 화면 확인", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "colleague@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Open confirm dialog and send
    await page.getByRole("button", { name: "메일 보내기" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "보내기" }).click();

    // Immediately transitions to Done screen
    await expect(
      page.getByRole("heading", { name: "메일을 보냈습니다" }),
    ).toBeVisible({ timeout: 10000 });

    // Recipient address listed
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("colleague@example.com"),
    ).toBeVisible();

    // Eventually status resolves to "보냄"
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("보냄"),
    ).toBeVisible({ timeout: 10000 });

    // Done actions visible
    await expect(
      page.locator("aside:visible, div[class*='bottomFixedBar']:visible").getByRole("button", { name: ".md 내려받기" }),
    ).toBeVisible();
    await expect(
      page.locator("aside:visible, div[class*='bottomFixedBar']:visible").getByRole("button", { name: /새 회의록( 만들기)?/ }),
    ).toBeVisible();

    // Verify 2-minute notice
    await expect(
      page
        .locator("aside:visible, div[class*='topMailBox']:visible")
        .getByText("보낸 뒤 2분이 지나 반송되면 표시되지 않을 수 있습니다."),
    ).toBeVisible();
  });

  test("부분 실패 주소 표시 및 '실패한 주소에 다시 보내기'", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "valid@example.com");
    await addRecipient(page, "fail@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Send
    await page.getByRole("button", { name: "메일 보내기" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "보내기" }).click();

    // Result screen should show failure banner once resolved
    await expect(
      page.getByRole("heading", { name: "2명 중 1명에게 보내지 못했습니다" }),
    ).toBeVisible({ timeout: 10000 });

    // Verify failure reason is displayed in visible container
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("보내지 못함 (주소를 찾을 수 없음)"),
    ).toBeVisible();

    // Verify retry button is shown
    const retryBtn = page
      .locator("aside:visible, div[class*='bottomFixedBar']:visible")
      .getByRole("button", { name: "실패한 주소에 다시 보내기" });
    await expect(retryBtn).toBeVisible();

    // Click retry button
    await retryBtn.dispatchEvent("click");
    // Valid email should remain visible
    await expect(
      page.locator("aside:visible, div[class*='topMailBox']:visible").getByText("valid@example.com"),
    ).toBeVisible();
  });

  test("결과 화면에서 뒤로 가기 방지 및 나가기 확인 창", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "test@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Send
    await page.getByRole("button", { name: "메일 보내기" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "보내기" }).click();

    await expect(
      page.getByRole("heading", { name: "메일을 보냈습니다" }),
    ).toBeVisible({ timeout: 10000 });

    // Attempt browser back - review screen must NOT be shown
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "메일을 보냈습니다" }),
    ).toBeVisible();

    // Click "새 회의록 만들기" / "새 회의록"
    await page
      .locator("aside:visible, div[class*='bottomFixedBar']:visible")
      .getByRole("button", { name: /새 회의록( 만들기)?/ })
      .click();

    // Leave dialog opens with Done screen message
    const leaveDialog = page.getByRole("dialog");
    await expect(leaveDialog).toBeVisible();
    await expect(
      leaveDialog.getByText("회의록은 서비스에 보관되지 않습니다. 나간 뒤에는 보낸 메일과 내려받은 파일로만 볼 수 있습니다."),
    ).toBeVisible();

    // Click "머무르기"
    await leaveDialog.getByRole("button", { name: "머무르기" }).click();
    await expect(leaveDialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "메일을 보냈습니다" }),
    ).toBeVisible();

    // Open leave dialog again and click "처음으로"
    await page
      .locator("aside:visible, div[class*='bottomFixedBar']:visible")
      .getByRole("button", { name: /새 회의록( 만들기)?/ })
      .click();
    await leaveDialog.getByRole("button", { name: "처음으로" }).click();

    // Navigated to home screen
    await expect(page).toHaveURL("/");
  });
});
