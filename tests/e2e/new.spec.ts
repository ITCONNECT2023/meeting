import { expect, test } from "@playwright/test";

test("/new?mode=b 는 주황 '바로 보내기' 배지를 보여준다", async ({ page }) => {
  await page.goto("/new?mode=b");

  const header = page.locator("header");
  const badge = header.getByText("바로 보내기", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveCSS("background-color", "rgb(251, 237, 227)");
  await expect(badge).toHaveCSS("color", "rgb(143, 60, 16)");

  await expect(
    page.getByRole("heading", { level: 1, name: "회의 녹음 올리기" }),
  ).toBeVisible();
  await expect(
    page.getByText("올리기 화면은 다음 단계에서 만듭니다."),
  ).toBeVisible();
});

test("/new?mode=a 는 파란 '검토 후 보내기' 배지를 보여준다", async ({
  page,
}) => {
  await page.goto("/new?mode=a");

  const header = page.locator("header");
  const badge = header.getByText("검토 후 보내기", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveCSS("background-color", "rgb(232, 237, 248)");
  await expect(badge).toHaveCSS("color", "rgb(30, 58, 126)");
});

test("모드가 없으면 기본값 A로 보인다", async ({ page }) => {
  await page.goto("/new");
  const header = page.locator("header");
  await expect(header.getByText("검토 후 보내기", { exact: true })).toBeVisible();
});

test("「처음으로」는 PC/태블릿에서 글자 버튼, 모바일에서 아이콘만 보이고 처음으로 이동한다", async ({
  page,
}) => {
  await page.goto("/new?mode=a");

  const homeLink = page.locator("header").getByRole("link", {
    name: "처음으로",
  });
  await expect(homeLink).toBeVisible();

  const width = page.viewportSize()?.width ?? 0;
  const label = homeLink.locator("span", { hasText: "처음으로" });
  if (width < 600) {
    await expect(label).toBeHidden();
  } else {
    await expect(label).toBeVisible();
  }

  await homeLink.click();
  await expect(page).toHaveURL("/");
});

test("가로 스크롤이 생기지 않는다", async ({ page }) => {
  await page.goto("/new?mode=a");
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});
