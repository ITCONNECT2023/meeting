import { expect, test } from "@playwright/test";

test("처음 화면에 제목이 보인다", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "회의록 자동 작성" }),
  ).toBeVisible();
});
