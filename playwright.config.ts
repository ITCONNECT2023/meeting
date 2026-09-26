import { defineConfig } from "@playwright/test";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      STORE_DRIVER: "memory",
      ACCESS_PASSWORD: "test-password",
      SESSION_SECRET: "test-session-secret-at-least-32-characters-long",
      COOKIE_SECURE: "false",
      AI_PROVIDER: "fake",
      MAIL_PROVIDER: "fake",
    },
  },
  projects: [
    {
      name: "pc",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      use: { viewport: { width: 834, height: 1194 } },
    },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
