import { describe, expect, it } from "vitest";

import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAIL_FROM_NAME,
  normalizeAppPassword,
  readGeminiConfig,
  readGmailConfig,
} from "@/scripts/check-external/config";

const APP_PASSWORD = "abcd efgh ijkl mnop";

describe("normalizeAppPassword", () => {
  it("removes the spaces Google shows between the 4-letter groups", () => {
    expect(normalizeAppPassword("abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
    expect(normalizeAppPassword("  abcd\tefgh ijkl mnop \n")).toBe("abcdefghijklmnop");
    expect(normalizeAppPassword("abcdefghijklmnop")).toBe("abcdefghijklmnop");
  });
});

describe("readGmailConfig", () => {
  it("defaults the sender name and the recipient (the account itself)", () => {
    const result = readGmailConfig({
      GMAIL_USER: " bot@gmail.com ",
      GMAIL_APP_PASSWORD: APP_PASSWORD,
    });
    expect(result).toEqual({
      ok: true,
      config: {
        user: "bot@gmail.com",
        appPassword: "abcdefghijklmnop",
        fromName: DEFAULT_MAIL_FROM_NAME,
        to: "bot@gmail.com",
      },
    });
    expect(DEFAULT_MAIL_FROM_NAME).toBe("회의록 봇");
  });

  it("uses MAIL_FROM_NAME and EXTERNAL_CHECK_TO when set", () => {
    const result = readGmailConfig({
      GMAIL_USER: "bot@gmail.com",
      GMAIL_APP_PASSWORD: APP_PASSWORD,
      MAIL_FROM_NAME: "시험 봇",
      EXTERNAL_CHECK_TO: "me@example.com",
    });
    expect(result.ok && result.config).toMatchObject({ fromName: "시험 봇", to: "me@example.com" });
  });

  it("names every missing variable and never includes a value", () => {
    const result = readGmailConfig({ GMAIL_USER: "", GMAIL_APP_PASSWORD: "   " });
    expect(result.ok).toBe(false);
    const text = !result.ok ? result.problems.join("\n") : "";
    expect(text).toContain("GMAIL_USER");
    expect(text).toContain("GMAIL_APP_PASSWORD");

    const onlyPassword = readGmailConfig({ GMAIL_USER: "bot@gmail.com" });
    const text2 = !onlyPassword.ok ? onlyPassword.problems.join("\n") : "";
    expect(text2).toContain("GMAIL_APP_PASSWORD");
    expect(text2).not.toContain("bot@gmail.com");

    const onlyUser = readGmailConfig({ GMAIL_APP_PASSWORD: APP_PASSWORD });
    const text3 = !onlyUser.ok ? onlyUser.problems.join("\n") : "";
    expect(text3).toContain("GMAIL_USER");
    expect(text3).not.toContain("abcd");
  });

  it("rejects a password that is not 16 characters, without echoing it", () => {
    const secret = "my-normal-login-password";
    const result = readGmailConfig({ GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: secret });
    expect(result.ok).toBe(false);
    const text = !result.ok ? result.problems.join("\n") : "";
    expect(text).toContain("GMAIL_APP_PASSWORD");
    expect(text).toContain("16");
    expect(text).not.toContain(secret);
  });

  it("rejects addresses that are not e-mail shaped", () => {
    const bad = readGmailConfig({ GMAIL_USER: "bot", GMAIL_APP_PASSWORD: APP_PASSWORD });
    expect(!bad.ok && bad.problems.join()).toContain("GMAIL_USER");
    const badTo = readGmailConfig({
      GMAIL_USER: "bot@gmail.com",
      GMAIL_APP_PASSWORD: APP_PASSWORD,
      EXTERNAL_CHECK_TO: "nope",
    });
    expect(!badTo.ok && badTo.problems.join()).toContain("EXTERNAL_CHECK_TO");
  });
});

describe("readGeminiConfig", () => {
  it("defaults the model to gemini-3.8-flash", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(readGeminiConfig({ GEMINI_API_KEY: "k" })).toEqual({
      ok: true,
      config: { apiKey: "k", model: "gemini-3.8-flash" },
    });
    expect(
      readGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: " gemini-x " }),
    ).toMatchObject({ config: { model: "gemini-x" } });
  });

  it("names GEMINI_API_KEY when missing", () => {
    const result = readGeminiConfig({ GEMINI_MODEL: "gemini-x" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join()).toContain("GEMINI_API_KEY");
  });
});
