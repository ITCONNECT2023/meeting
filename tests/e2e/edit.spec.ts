import { expect, test, type Page } from "@playwright/test";

function mimeTypeFor(name: string): string {
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

async function uploadAndReachReview(page: Page) {
  await page.goto("/new?mode=a");
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: "주간회의_0922.mp3",
      mimeType: mimeTypeFor("주간회의_0922.mp3"),
      buffer: Buffer.from("fake audio for edit test"),
    });

  const rcpInput = page.getByPlaceholder("name@company.com");
  await rcpInput.fill("edit-tester@company.com");
  await rcpInput.press("Enter");

  await page.getByRole("button", { name: "회의록 만들기" }).click();
  await expect(
    page.getByRole("heading", { name: "회의록을 확인하고, 필요하면 고친 뒤 보내세요" }),
  ).toBeVisible({ timeout: 15000 });
}

test.describe("EPIC 6: 검토 중 편집", () => {
  test("Action 1 & 2: 할 일 편집 (기한 수정 -> (수정됨), 담당자 비우기 -> '미정' 점선 상자, .md 파일 반영)", async ({
    page,
    isMobile,
  }) => {
    await uploadAndReachReview(page);
    // Section 4 (Todos) Edit
    const todoSection = page.locator("section[aria-labelledby='sec-todos']");
    await todoSection.getByRole("button", { name: "고치기" }).click();

    // Check header changed to "할 일 고치는 중"
    await expect(page.getByText("할 일 고치는 중")).toBeVisible();

    // Action 1: Change due of first todo to "10월 10일"
    const firstDueInput = page.getByLabel("할 일 1 기한");
    await firstDueInput.fill("10월 10일");

    // Action 2: Empty owner of second todo
    const secondOwnerInput = page.getByLabel("할 일 2 담당자");
    await secondOwnerInput.fill("");

    // Click Apply
    await page.getByRole("button", { name: "적용" }).click();

    // Verify UI updated
    await expect(page.getByText("할 일 고치는 중")).not.toBeVisible();

    if (isMobile) {
      await expect(
        page.locator("ul[class*='todoCards']").getByText("10월 10일 (수정됨)"),
      ).toBeVisible();
      const ownerDashed = page
        .locator("ul[class*='todoCards']")
        .locator("span[class*='dashedBadge']")
        .filter({ hasText: "미정" });
      await expect(ownerDashed.first()).toBeVisible();
    } else {
      await expect(
        page.locator("div[class*='todoTable']").getByText("10월 10일 (수정됨)").first(),
      ).toBeVisible();
      const ownerDashed = page
        .locator("div[class*='todoTable']")
        .locator("span[class*='dashedBadge']")
        .filter({ hasText: "미정" });
      await expect(ownerDashed.first()).toBeVisible();
    }

    // Verify .md download reflects the edits and disclaimer
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: ".md 내려받기" }).first().click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const mdContent = Buffer.concat(chunks).toString("utf-8");

    expect(mdContent).toContain("10월 10일 (수정됨)");
    expect(mdContent).toContain("`(수정됨)` 표시는 검토자가 고친 부분입니다.");
  });

  test("Action 3: 결정사항을 모두 지우고 적용하면 '없음'으로 표시된다", async ({ page }) => {
    await uploadAndReachReview(page);

    const decSection = page.locator("section[aria-labelledby='sec-decisions']");
    await decSection.getByRole("button", { name: "고치기" }).click();

    await expect(page.getByText("결정사항 고치는 중")).toBeVisible();

    // Delete all decision rows
    const deleteButtons = page.getByLabel("결정사항 지우기");
    while ((await deleteButtons.count()) > 0) {
      await deleteButtons.first().click();
    }

    await page.getByRole("button", { name: "적용" }).click();

    await expect(page.getByText("결정사항 고치는 중")).not.toBeVisible();
    const noneBadge = decSection.locator("span[class*='dashedBadge']").filter({ hasText: "없음" });
    await expect(noneBadge).toBeVisible();
  });

  test("Action 4: 근거에 99:99를 넣으면 오류 안내가 나오고 적용되지 않는다", async ({ page }) => {
    await uploadAndReachReview(page);

    const decSection = page.locator("section[aria-labelledby='sec-decisions']");
    await decSection.getByRole("button", { name: "고치기" }).click();

    // Enter 99:99 in citation input
    const firstTsInput = page.getByLabel("결정사항 1 근거");
    await firstTsInput.fill("99:99");

    await page.getByRole("button", { name: "적용" }).click();

    // Error message should be shown
    await expect(page.getByText("근거는 12:34 또는 1:02:03처럼 적어 주세요.")).toBeVisible();
    // Edit mode should remain open
    await expect(page.getByText("결정사항 고치는 중")).toBeVisible();
  });

  test("Action 5: 기본 정보 일시를 '2026-09-30 10:00'으로 고치면 파일명 미리보기가 바뀐다", async ({
    page,
  }) => {
    await uploadAndReachReview(page);

    // Meta Section Edit
    const metaSection = page.locator("div[class*='section']").first();
    await metaSection.getByRole("button", { name: "고치기" }).click();

    await expect(page.getByText("제목 · 일시 · 참석자 고치는 중")).toBeVisible();

    const dateInput = page.locator("#ed-date");
    await dateInput.fill("2026-09-30 10:00");

    // Check preview filename updated below date input
    await expect(page.getByText("회의록_2026-09-30.md")).toBeVisible();

    // Apply
    await page.getByRole("button", { name: "적용" }).click();
    await expect(page.getByText("제목 · 일시 · 참석자 고치는 중")).not.toBeVisible();

    // Top filename in article bar should now be updated to 2026-09-30
    await expect(page.getByRole("article").getByText("회의록_2026-09-30.md")).toBeVisible();
  });

  test("Action 6 & 제약: 전체 스크립트에는 고치기가 없고, 편집 중에는 한 구역만 가능하며 메일 보내기가 비활성화된다", async ({
    page,
  }) => {
    await uploadAndReachReview(page);

    // 1. Full script has no '고치기' button
    const scriptSection = page.locator("section[aria-labelledby='sec-script']");
    await expect(scriptSection.getByRole("button", { name: "고치기" })).toHaveCount(0);
    await expect(scriptSection.getByText("고칠 수 없음")).toBeVisible();

    // 2. Open summary edit
    const sumSection = page.locator("section[aria-labelledby='sec-summary']");
    await sumSection.getByRole("button", { name: "고치기" }).click();
    await expect(page.getByText("요약 고치는 중")).toBeVisible();

    // Other '고치기' buttons should disappear (only one section at a time)
    await expect(page.getByRole("button", { name: "고치기" })).toHaveCount(0);

    // 3. Mail send button is disabled and warning notice appears
    const sendButtons = page.getByRole("button", { name: "메일 보내기" });
    for (const btn of await sendButtons.all()) {
      await expect(btn).toBeDisabled();
    }
    const warning = page.locator("p[class*='Warning']:visible");
    await expect(warning).toHaveText("고치는 중인 항목을 먼저 적용하거나 취소하세요.");

    // 4. Cancel reverts edit state and restores '고치기' buttons and send button
    await page.getByRole("button", { name: "취소" }).click();
    await expect(page.getByText("요약 고치는 중")).not.toBeVisible();

    // Send button should be enabled again
    for (const btn of await sendButtons.all()) {
      await expect(btn).toBeEnabled();
    }
    await expect(page.locator("p[class*='Warning']:visible")).toHaveCount(0);
  });
});
