import { randomInt } from "node:crypto";

/** Written by auth.setup.ts; holds a signed session cookie (gitignored). */
export const AUTH_STATE_PATH = "playwright/.auth/state.json";

/** Must match ACCESS_PASSWORD in playwright.config.ts's webServer env. */
export const TEST_PASSWORD = "test-password";

/** `test.use({ storageState: LOGGED_OUT })` for tests that need no cookie. */
export const LOGGED_OUT = { cookies: [], origins: [] };

export const WRONG_MESSAGE = "암호가 맞지 않습니다.";
export const LOCKED_MESSAGE = "여러 번 틀려 10분 동안 입력할 수 없습니다.";

/**
 * A made-up client address for one test. The e2e server runs with
 * TRUST_PROXY_HEADERS=true, so sending this as x-forwarded-for gives the
 * test its own lockout counter (all tests really connect from 127.0.0.1
 * and run in parallel). 16M possibilities; collisions are negligible.
 */
export function uniqueClientIp(): string {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** CRON_SECRET of the e2e server (playwright.config.ts). 32+ chars. */
export const CRON_TEST_SECRET = "e2e-cron-secret-0123456789abcdefghijklmnop";

/**
 * Secret path segment of the e2e server's WORKFLOW_LOCAL_BASE_URL
 * (playwright.config.ts); the local Workflow queue delivers through
 * `/_workflow/<this>/...`. 32+ chars of [A-Za-z0-9_-].
 */
export const WORKFLOW_TEST_QUEUE_SECRET = "e2e-workflow-queue-secret-0123456789abcdef";
