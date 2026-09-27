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

test.describe("EPIC 4: 회의록 화면과 .md 내려받기", () => {
  test("확인 화면 렌더링: 파일명, 미정 점선 상자, 자물쇠, 가림 안내, AI 작성 안내", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    // Wait until review screen appears
    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // 1. Top filename
    await expect(page.getByRole("article").getByText(/회의록_.*\.md/)).toBeVisible();

    // 2. Dashed badges for '미정'
    const dashedBadges = page.getByRole("article").locator("span[class*='dashedBadge']:visible");
    await expect(dashedBadges.first()).toBeVisible();

    // 3. Script lock badge and masked count badge
    await expect(page.getByText("고칠 수 없음")).toBeVisible();
    await expect(page.getByText("개인정보 번호 1건을 가렸습니다")).toBeVisible();

    // 4. Verify fake AI's phone number was masked with ***
    await expect(page.getByText("***로 연락 주세요.")).toBeVisible();
    await expect(page.getByText("010-1234-5678")).toHaveCount(0);

    // 5. AI disclaimer at the bottom
    await expect(
      page.getByText("이 회의록은 녹음을 바탕으로 AI가 작성했습니다."),
    ).toBeVisible();
  });

  test(".md 내려받기: 파일 저장, 파일 내용 검증, 알림 토스트 표시 및 닫기", async ({ page }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    // Wait for download event
    const downloadPromise = page.waitForEvent("download");
    // Click visible .md 내려받기 button
    await page.locator("button:visible").filter({ hasText: ".md 내려받기" }).first().click();
    const download = await downloadPromise;

    // Verify downloaded filename
    expect(download.suggestedFilename()).toBe("회의록_2026-09-22.md");

    // Verify file content has markdown structure and masked phone number
    const readStream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const content = Buffer.concat(chunks).toString("utf-8");
    expect(content).toContain("# 신규 기능 출시 일정 회의");
    expect(content).toContain("## 전체 스크립트");
    expect(content).toContain("***로 연락 주세요.");
    expect(content).toContain("이 회의록은 녹음을 바탕으로 AI가 작성했습니다.");

    // Toast notification visible
    const toast = page.getByRole("status");
    await expect(toast).toBeVisible();
    await expect(toast.getByText("회의록_2026-09-22.md 내려받기")).toBeVisible();
    await expect(toast.getByText("전체 스크립트까지 담긴 파일입니다.")).toBeVisible();

    // Close toast with close button (×)
    await toast.getByRole("button", { name: "알림 닫기" }).click();
    await expect(toast).not.toBeVisible();
  });

  test("PC vs 모바일 할 일 및 메일 정보 배치 전환", async ({ page, isMobile }) => {
    await page.goto("/new?mode=a");

    await pickFile(page, "주간회의_0922.mp3");
    await addRecipient(page, "user@example.com");

    await page.getByRole("button", { name: "회의록 만들기" }).click();

    await expect(
      page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
    ).toBeVisible({ timeout: 15000 });

    if (isMobile) {
      // Mobile: Todo cards are visible, bottom fixed bar has actions
      await expect(page.locator("ul[class*='todoCards']")).toBeVisible();
      await expect(page.locator("div[class*='bottomFixedBar']")).toBeVisible();
    } else {
      // PC/Tablet: Todo table head is visible, aside has mail info (on PC)
      await expect(page.locator("div[class*='todoTableHead']")).toBeVisible();
    }
  });

  test("만료된 작업 다운로드 시 410 EXPIRED 안내", async ({ page, request }) => {
    await page.goto("/new?mode=a");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const res = await request.get("/api/jobs/expired-test-id/download", {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(410);
    const body = await res.json();
    expect(body.code).toBe("EXPIRED");
    expect(body.message).toBe("보관 시간(24시간)이 지나 회의록이 삭제되었습니다. 녹음을 다시 올려 주세요.");
  });
});
