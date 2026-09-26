import { expect, test as setup } from "@playwright/test";

import { AUTH_STATE_PATH, TEST_PASSWORD, uniqueClientIp } from "./helpers";

// Logs in once through the real endpoint and saves the cookie, so the
// pc/tablet/mobile specs start authenticated (see playwright.config.ts).
setup("log in and save the session cookie", async ({ request }) => {
  const response = await request.post("/api/auth", {
    data: { password: TEST_PASSWORD },
    headers: { "x-forwarded-for": uniqueClientIp() },
  });
  expect(response.status()).toBe(200);
  await request.storageState({ path: AUTH_STATE_PATH });
});
