import { expect, test, type Page } from "@playwright/test";

// EPIC 2-4/2-5/2-6 e2e: 회의 녹음 올리기 screen. Runs across all 3
// playwright.config.ts projects (pc 1440 / tablet 834 / mobile 390); tests
// that only make sense on one width branch on `page.viewportSize()`.

/**
 * Builds a tiny, fully-valid PCM WAV buffer whose *declared* duration is
 * `durationSec` seconds, without actually containing that many audio
 * bytes. A 1Hz sample rate means 1 byte of "audio" per second, so a
 * 7201-second (2h+1s) file is only ~7.2KB — small enough to hand
 * setInputFiles in-memory, no fixture file needed. music-metadata (via
 * lib/audio/read-metadata's readAudioMetadata) computes WAV duration from
 * the data-chunk size / byte-rate, so this parses as a real >2h recording.
 */
function buildTinyWav(durationSec: number): Buffer {
  const sampleRate = 1;
  const bitsPerSample = 8;
  const channels = 1;
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const dataSize = Math.round(byteRate * durationSec);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize, 0)]);
}

function mimeTypeFor(name: string): string {
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".m4a")) return "audio/mp4";
  return "video/mp4";
}

/** Sets the FilePicker's hidden `<input type="file">` directly — works
 * regardless of whether a file is already picked, since that input is
 * always present in the DOM (FilePicker.tsx renders it unconditionally). */
async function pickFile(
  page: Page,
  name: string,
  buffer: Buffer = Buffer.from("fake audio bytes"),
) {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: mimeTypeFor(name), buffer });
}

/** Types an address into 받는 메일 주소's field and commits it with Enter
 * (등가: 쉼표 또는 「추가」 — FRD says any of the three commit it). */
async function addRecipient(page: Page, email: string) {
  const input = page.getByPlaceholder("name@company.com");
  await input.fill(email);
  await input.press("Enter");
}

function fileSection(page: Page) {
  return page.getByRole("region", { name: "녹음 파일" });
}

function recipientList(page: Page) {
  return page.getByRole("list", { name: "받는 사람" });
}

function attendeeList(page: Page) {
  return page.getByRole("list", { name: "입력한 참석자" });
}

// ---------------------------------------------------------------------------
// Kept from the placeholder version (still true of the real screen).
// ---------------------------------------------------------------------------

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
});

test("/new?mode=a 는 파란 '검토 후 보내기' 배지를 보여준다", async ({ page }) => {
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

test("가로 스크롤이 생기지 않는다", async ({ page }) => {
  await page.goto("/new?mode=a");
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});

test("가로 스크롤이 생기지 않는다 (긴 파일명 · 긴 주소 포함)", async ({ page }) => {
  await page.goto("/new?mode=b");
  await pickFile(
    page,
    "아주아주아주아주아주아주아주아주아주아주아주아주긴녹음파일이름입니다_0922_최종본_진짜최종.m4a",
  );
  await addRecipient(
    page,
    "an-extremely-long-recipient-address-for-wrapping-test@example-company-name.com",
  );
  const fits = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
});

// ---------------------------------------------------------------------------
// F14 처음으로 — now a <button> (always given onHome), not a plain <Link>.
// ---------------------------------------------------------------------------

test("「처음으로」는 PC/태블릿에서 글자가 보이고 모바일에서는 아이콘만 보인다", async ({
  page,
}) => {
  await page.goto("/new?mode=a");
  const homeButton = page.locator("header").getByRole("button", { name: "처음으로" });
  await expect(homeButton).toBeVisible();

  const width = page.viewportSize()?.width ?? 0;
  const label = homeButton.locator("span", { hasText: "처음으로" });
  if (width < 600) {
    await expect(label).toBeHidden();
  } else {
    await expect(label).toBeVisible();
  }
});

test("빈 화면에서 「처음으로」는 확인 없이 바로 처음 화면으로 간다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await page.locator("header").getByRole("button", { name: "처음으로" }).click();
  await expect(page).toHaveURL("/");
});

test("입력값이 있으면 「처음으로」가 나가기 확인 창을 연다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await page.getByLabel("제목").fill("주간 회의");
  await page.locator("header").getByRole("button", { name: "처음으로" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "처음 화면으로 갈까요?" }),
  ).toBeVisible();
  await expect(
    dialog.getByText("고른 녹음 파일과 입력한 회의 정보, 받는 주소가 모두 지워집니다."),
  ).toBeVisible();

  // 머무르기: closes, stays on /new, title untouched.
  await dialog.getByRole("button", { name: "머무르기" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/new/);
  await expect(page.getByLabel("제목")).toHaveValue("주간 회의");
});

test("나가기 확인 창의 「처음으로」를 누르면 처음 화면으로 간다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await page.getByLabel("제목").fill("주간 회의");
  await page.locator("header").getByRole("button", { name: "처음으로" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "처음으로" }).click();
  await expect(page).toHaveURL("/");
});

// ---------------------------------------------------------------------------
// 화면에서 확인할 행동 1-2: 파일 형식.
// ---------------------------------------------------------------------------

test("mp4를 고르면 FRD 형식 오류 문구가 그대로 보인다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "화면녹화_0922.mp4");
  await expect(
    fileSection(page).getByText(
      "지원하지 않는 형식입니다(.mp4). mp3, m4a, wav 파일을 올려 주세요.",
    ),
  ).toBeVisible();
});

test("m4a를 고르면 파일명과 'm4a 파일 · 아직 올리지 않았습니다'가 보이고 PC 패널에도 파일명이 나온다", async ({
  page,
}) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "주간회의_0922.m4a");

  await expect(fileSection(page).getByText("주간회의_0922.m4a")).toBeVisible();
  await expect(
    fileSection(page).getByText("m4a 파일 · 아직 올리지 않았습니다"),
  ).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) >= 1200) {
    await expect(
      page.getByRole("complementary", { name: "보내기 전 확인" }).getByText("주간회의_0922.m4a"),
    ).toBeVisible();
  }
});

test("파일 빼기(×)를 누르면 다시 파일 고르는 화면으로 돌아간다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "주간회의_0922.m4a");
  await page.getByRole("button", { name: "고른 파일 빼기" }).click();

  const width = page.viewportSize()?.width ?? 0;
  if (width < 600) {
    await expect(page.getByText("눌러서 녹음 파일 고르기")).toBeVisible();
  } else {
    await expect(
      page.getByText("녹음 파일을 여기로 끌어다 놓거나 눌러서 고르세요"),
    ).toBeVisible();
  }
});

test("모바일에서는 끌어다 놓기 문구도, 「다른 파일」 버튼도 없다", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 600, "모바일 전용 검사");
  await page.goto("/new?mode=a");
  await expect(page.getByText("눌러서 녹음 파일 고르기")).toBeVisible();
  await expect(
    page.getByText("녹음 파일을 여기로 끌어다 놓거나 눌러서 고르세요"),
  ).toBeHidden();

  await pickFile(page, "주간회의_0922.m4a");
  await expect(page.getByRole("button", { name: "다른 파일" })).toBeHidden();
});

test("2시간을 넘는 녹음은 거절된다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "긴녹음.wav", buildTinyWav(7201));
  await expect(
    fileSection(page).getByText("녹음이 2시간을 넘습니다. 2시간 이하로 나눠서 올려 주세요."),
  ).toBeVisible();
});

test("메타데이터를 읽는 중 올리기를 눌러도 2시간 제한이 적용된다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await addRecipient(page, "a@x.com");
  await pickFile(page, "긴녹음2.wav", buildTinyWav(7201));
  // Click immediately — exercises submit() awaiting the in-flight duration
  // read rather than trusting whatever the UI has rendered so far.
  await page.getByRole("button", { name: "회의록 만들기" }).click();

  await expect(
    fileSection(page).getByText("녹음이 2시간을 넘습니다. 2시간 이하로 나눠서 올려 주세요."),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 화면에서 확인할 행동 3: 참석자 한글 이름 + Enter.
// ---------------------------------------------------------------------------

test("한글 참석자 이름 + Enter는 잘리지 않은 칩 하나가 된다 (일반 입력)", async ({ page }) => {
  await page.goto("/new?mode=a");
  const input = page.getByPlaceholder("이름을 쓰고 Enter");
  await input.fill("김민수");
  await input.press("Enter");

  const list = attendeeList(page);
  await expect(list.getByText("김민수", { exact: true })).toBeVisible();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(input).toHaveValue("");
});

test("한글 조합 중 Enter는 무시되고, 조합이 끝나면 칩 하나가 된다 (CDP IME)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Input.imeSetComposition is Chromium-only");
  await page.goto("/new?mode=a");
  const input = page.getByPlaceholder("이름을 쓰고 Enter");
  await input.click();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", {
    text: "김민수",
    selectionStart: 3,
    selectionEnd: 3,
  });
  // Enter while still composing must not commit a chip yet.
  await page.keyboard.press("Enter");
  // Commit the composition (equivalent to the IME's own final commit).
  await cdp.send("Input.insertText", { text: "김민수" });

  const list = attendeeList(page);
  await expect(list.getByText("김민수", { exact: true })).toBeVisible();
  await expect(list.locator("li")).toHaveCount(1);
  await expect(input).toHaveValue("");
});

// ---------------------------------------------------------------------------
// F3 받는 메일 주소.
// ---------------------------------------------------------------------------

test("주소 3개를 넣으면 '받는 사람 3명'이 보인다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await addRecipient(page, "a@x.com");
  await addRecipient(page, "b@x.com");
  await addRecipient(page, "c@x.com");
  await expect(recipientList(page).locator("li")).toHaveCount(3);

  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1200) {
    await expect(
      page.getByRole("complementary", { name: "보내기 전 확인" }).getByText("받는 사람 3명"),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("group", { name: "받는 사람" }).getByText("3명", { exact: true }),
    ).toBeVisible();
  }
});

test("주소 3개 뒤 형식이 틀린 주소를 추가하면 칩은 3개인 채 오류가 보인다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await addRecipient(page, "a@x.com");
  await addRecipient(page, "b@x.com");
  await addRecipient(page, "c@x.com");

  const input = page.getByPlaceholder("name@company.com");
  await input.fill("abc@example");
  await input.press("Enter");

  await expect(recipientList(page).locator("li")).toHaveCount(3);
  await expect(page.getByText("메일 주소 형식이 아닙니다. 예: name@company.com")).toBeVisible();
  await expect(input).toHaveValue("abc@example");
  await expect(input).toHaveCSS("border-color", "rgb(179, 38, 30)");
});

test("같은 주소를 또 추가하면 중복 오류가 보인다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await addRecipient(page, "dup@example.com");
  await addRecipient(page, "dup@example.com");

  await expect(page.getByText("이미 추가한 주소입니다.")).toBeVisible();
  await expect(recipientList(page).locator("li")).toHaveCount(1);
});

test("21번째 주소는 추가되지 않고 안내 문구가 보인다", async ({ page }) => {
  await page.goto("/new?mode=a");
  const input = page.getByPlaceholder("name@company.com");
  for (let i = 1; i <= 20; i++) {
    await input.fill(`user${i}@example.com`);
    await input.press("Enter");
  }
  await expect(recipientList(page).locator("li")).toHaveCount(20);

  await input.fill("user21@example.com");
  await input.press("Enter");
  await expect(page.getByText("받는 사람은 20명까지 넣을 수 있습니다.")).toBeVisible();
  await expect(recipientList(page).locator("li")).toHaveCount(20);
});

test("파일 없이 올리기를 누르면 파일 구역에 오류가 나오고 진행되지 않는다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await addRecipient(page, "a@x.com");
  await page.getByRole("button", { name: "회의록 만들기" }).click();

  await expect(fileSection(page).getByText("녹음 파일을 올려 주세요.")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// F4 방식 탭.
// ---------------------------------------------------------------------------

test("탭을 바꿔도 입력값이 남고, B 경고·배지·버튼 이름으로 바뀐다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "주간회의_0922.m4a");
  await page.getByLabel("제목").fill("주간 회의");
  const attInput = page.getByPlaceholder("이름을 쓰고 Enter");
  await attInput.fill("김민수");
  await attInput.press("Enter");

  const tabs = page.getByRole("group", { name: "보내는 방식" });
  await tabs.getByRole("button", { name: /바로 보내기/ }).click();

  await expect(page).toHaveURL(/mode=b/);
  await expect(
    page.locator("header").getByText("바로 보내기", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "바로 보내기에서는 회의록이 만들어지면 이 주소로 검토 없이 곧바로 보냅니다.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "올리고 바로 보내기" })).toBeVisible();

  // Inputs kept.
  await expect(fileSection(page).getByText("주간회의_0922.m4a")).toBeVisible();
  await expect(page.getByLabel("제목")).toHaveValue("주간 회의");
  await expect(attendeeList(page).getByText("김민수")).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2-6 B 주소 확인 창.
// ---------------------------------------------------------------------------

test("B 모드에서 올리기를 누르면 주소 확인 창이 열리고, 「주소 고치기」는 입력값을 남긴다", async ({
  page,
}) => {
  await page.goto("/new?mode=b");
  await pickFile(page, "주간회의_0922.m4a");
  await addRecipient(page, "a@x.com");
  await addRecipient(page, "b@x.com");

  await page.getByRole("button", { name: "올리고 바로 보내기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "올리기 전에 받는 주소를 확인하세요" }),
  ).toBeVisible();
  await expect(dialog.getByText("받는 사람 2명")).toBeVisible();
  await expect(dialog.getByText("a@x.com")).toBeVisible();
  await expect(dialog.getByText("b@x.com")).toBeVisible();

  await dialog.getByRole("button", { name: "주소 고치기" }).click();
  await expect(dialog).toBeHidden();
  await expect(recipientList(page).locator("li")).toHaveCount(2);
});

test("B 확인 창에서 「이 주소로 올리고 보내기」를 누르면 창이 닫히고 알림이 뜬다", async ({
  page,
}) => {
  await page.goto("/new?mode=b");
  await pickFile(page, "주간회의_0922.m4a");
  await addRecipient(page, "a@x.com");

  await page.getByRole("button", { name: "올리고 바로 보내기" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "이 주소로 올리고 보내기" }).click();
  await expect(dialog).toBeHidden();

  const toast = page.getByRole("status");
  await expect(toast.getByText("입력 확인을 마쳤습니다")).toBeVisible();
  await expect(
    toast.getByText("실제 올리기와 발송은 다음 단계에서 연결합니다."),
  ).toBeVisible();
});

test("입력칸에만 쓴 주소도 올리기를 누르면 자동으로 추가된다", async ({ page }) => {
  await page.goto("/new?mode=b");
  await pickFile(page, "주간회의_0922.m4a");
  await addRecipient(page, "a@x.com");
  await page.getByPlaceholder("name@company.com").fill("b@x.com");

  await page.getByRole("button", { name: "올리고 바로 보내기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("받는 사람 2명")).toBeVisible();
  await expect(dialog.getByText("b@x.com")).toBeVisible();
  await expect(recipientList(page).locator("li")).toHaveCount(2);
  await expect(page.getByPlaceholder("name@company.com")).toHaveValue("");
});

test("A 모드에서 올리기를 누르면 알림이 뜬다", async ({ page }) => {
  await page.goto("/new?mode=a");
  await pickFile(page, "주간회의_0922.m4a");
  await addRecipient(page, "a@x.com");

  await page.getByRole("button", { name: "회의록 만들기" }).click();
  const toast = page.getByRole("status");
  await expect(toast.getByText("입력 확인을 마쳤습니다")).toBeVisible();
  await expect(
    toast.getByText("실제 올리기는 다음 단계(EPIC 3)에서 연결합니다."),
  ).toBeVisible();
});
