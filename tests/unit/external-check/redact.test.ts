import { describe, expect, it } from "vitest";

import { REDACTED, collectSecrets, createRedactor } from "@/scripts/check-external/redact";

const env = {
  GMAIL_USER: "bot@gmail.com",
  GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop",
  GEMINI_API_KEY: "AIzaFakeKeyForTests_123",
  ACCESS_PASSWORD: "team-pass!",
  SESSION_SECRET: "S".repeat(40),
  UPSTASH_REDIS_REST_TOKEN: "local-dev-only-token",
};

const redact = createRedactor(collectSecrets(env));

function b64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("redaction", () => {
  it("removes the Gemini key, access password and session secret", () => {
    const out = redact(
      `url ?key=AIzaFakeKeyForTests_123 pw=team-pass! secret=${"S".repeat(40)} token=local-dev-only-token`,
    );
    expect(out).not.toContain("AIzaFakeKeyForTests_123");
    expect(out).not.toContain("team-pass!");
    expect(out).not.toContain("S".repeat(40));
    expect(out).not.toContain("local-dev-only-token");
    expect(out).toContain(REDACTED);
  });

  it("removes the app password with spaces, without spaces, encoded", () => {
    const forms = [
      "abcd efgh ijkl mnop",
      "abcdefghijklmnop",
      b64("abcdefghijklmnop"),
      b64("\u0000bot@gmail.com\u0000abcdefghijklmnop"),
    ];
    for (const form of forms) {
      expect(redact(`before ${form} after`)).toBe(`before ${REDACTED} after`);
    }
    expect(redact(encodeURIComponent("team-pass!") + "|" + encodeURIComponent("abcd efgh ijkl mnop"))).not.toMatch(
      /team-pass|abcd/,
    );
  });

  it("adds the grouped form when the password was entered without spaces", () => {
    const r = createRedactor(collectSecrets({ GMAIL_APP_PASSWORD: "abcdefghijklmnop" }));
    expect(r("abcd efgh ijkl mnop")).toBe(REDACTED);
  });

  it("leaves the recipient address and ordinary text alone", () => {
    expect(redact("받는 사람: bot@gmail.com")).toBe("받는 사람: bot@gmail.com");
  });

  it("ignores unset or empty values", () => {
    const r = createRedactor(collectSecrets({ GEMINI_API_KEY: "", ACCESS_PASSWORD: undefined }));
    expect(r("nothing to hide")).toBe("nothing to hide");
  });
});
