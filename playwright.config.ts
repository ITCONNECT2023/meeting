import { defineConfig } from "@playwright/test";

import {
  AUTH_STATE_PATH,
  CRON_TEST_SECRET,
  WORKFLOW_TEST_QUEUE_SECRET,
} from "./tests/e2e/helpers";

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

const loggedIn = { storageState: AUTH_STATE_PATH };

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
      // Every e2e test that submits a password sends its own
      // x-forwarded-for (tests/e2e/helpers.ts), so parallel tests — all
      // really from 127.0.0.1 — get separate lockout counters and the
      // 5-wrong-attempts test can't lock the others out. This is the same
      // setting a deployment behind Vercel's proxy uses; nothing here is a
      // test-only code path.
      TRUST_PROXY_HEADERS: "true",
      // EPIC 9-1: GET /api/cron/cleanup only runs with this bearer.
      CRON_SECRET: CRON_TEST_SECRET,
      // EPIC 9-1: the local Workflow queue delivers through this secret
      // path; proxy.ts refuses direct /.well-known/workflow/* requests
      // (lib/auth/workflow-queue.ts). `npm run dev`/`local` generate one.
      WORKFLOW_LOCAL_BASE_URL: `${baseURL}/_workflow/${WORKFLOW_TEST_QUEUE_SECRET}`,
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "pc",
      dependencies: ["setup"],
      use: { ...loggedIn, viewport: { width: 1440, height: 900 } },
    },
    {
      name: "tablet",
      dependencies: ["setup"],
      use: { ...loggedIn, viewport: { width: 834, height: 1194 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      use: {
        ...loggedIn,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
