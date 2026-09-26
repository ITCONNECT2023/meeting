import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("h1과 리드 문단이 보인다", async ({ page }) => {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "회의 녹음을 올리면, 녹음에 근거한 회의록을 만들어 팀원에게 보냅니다",
    }),
  ).toBeVisible();
});

test("방식 A/B 카드가 올바른 이름과 링크로 보인다", async ({ page }) => {
  const cardA = page.getByRole("link", { name: /검토 후 보내기로 시작/ });
  await expect(cardA).toBeVisible();
  await expect(cardA).toHaveAttribute("href", "/new?mode=a");

  const cardB = page.getByRole("link", { name: /바로 보내기로 시작/ });
  await expect(cardB).toBeVisible();
  await expect(cardB).toHaveAttribute("href", "/new?mode=b");
});

test("'회의록은 이렇게 만듭니다'에 가림 한계와 Gemini 삭제 문구가 있다", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "회의록은 이렇게 만듭니다" });
  await expect(
    section.getByText(
      "주민등록번호·전화번호·계좌번호·카드번호는 ***로 가립니다",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    section.getByText("이름, 주소, 말로 풀어 읽은 번호", { exact: false }),
  ).toBeVisible();
  await expect(
    section.getByText(
      "녹음은 Google AI(Gemini)로 처리한 뒤 바로 삭제합니다.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    section.getByText(
      "녹음은 Google AI(Gemini)로 처리한 뒤 바로 삭제합니다. 회의록도 서비스에 쌓아 두지 않습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(section.getByText("지원 형식: mp3 · m4a · wav")).toBeVisible();
});

test("처음 화면 머리글에는 방식 배지와 「처음으로」가 없다", async ({
  page,
}) => {
  const header = page.locator("header");
  await expect(header.getByText("검토 후 보내기", { exact: true })).toHaveCount(0);
  await expect(header.getByText("바로 보내기", { exact: true })).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: "처음으로" }),
  ).toHaveCount(0);
});

test("바탕색과 글꼴이 토큰대로 적용된다", async ({ page }) => {
  const background = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(background).toBe("rgb(244, 242, 236)");

  const fontFamily = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(fontFamily).toContain("IBM Plex Sans KR");
});

test("카드는 PC/태블릿에서 나란히, 모바일에서 쌓인다", async ({ page }) => {
  const cardA = page.getByRole("link", { name: /검토 후 보내기로 시작/ });
  const cardB = page.getByRole("link", { name: /바로 보내기로 시작/ });
  const boxA = await cardA.boundingBox();
  const boxB = await cardB.boundingBox();
  expect(boxA).not.toBeNull();
  expect(boxB).not.toBeNull();
  if (!boxA || !boxB) return;

  const width = page.viewportSize()?.width ?? 0;
  if (width < 600) {
    expect(boxB.y).toBeGreaterThanOrEqual(boxA.y + boxA.height - 1);
  } else {
    expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(5);
    expect(boxB.x).toBeGreaterThan(boxA.x + boxA.width / 2);
  }
});

test("가로 스크롤이 생기지 않는다", async ({ page }) => {
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});
