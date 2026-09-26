import { describe, expect, it, vi } from "vitest";

import type { GmailConfig } from "@/scripts/check-external/config";
import { runGeminiCheck } from "@/scripts/check-external/gemini";
import type { GenerateFn } from "@/scripts/check-external/gemini";
import { TEST_SUBJECT, buildTestMessage, runGmailCheck } from "@/scripts/check-external/gmail";
import type { MailTransport } from "@/scripts/check-external/gmail";
import { runChecks } from "@/scripts/check-external/run";

const gmailConfig: GmailConfig = {
  user: "bot@gmail.com",
  appPassword: "abcdefghijklmnop",
  fromName: "회의록 봇",
  to: "bot@gmail.com",
};

function collect(): { print: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { print: (line) => lines.push(line), lines };
}

describe("runChecks", () => {
  it("keeps going after the first check fails and exits non-zero", async () => {
    const second = vi.fn(async () => ({ ok: true as const, lines: ["둘째 성공"] }));
    const { print, lines } = collect();
    const code = await runChecks(
      [
        { title: "첫째", run: async () => ({ ok: false, cause: "첫째 실패", next: ["고치기"] }) },
        { title: "둘째", run: second },
      ],
      print,
    );
    expect(second).toHaveBeenCalledOnce();
    expect(code).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("원인: 첫째 실패");
    expect(text).toContain("할 일: 고치기");
    expect(text).toContain("둘째 성공");
  });

  it("a check that throws is a failure, and its error is not printed", async () => {
    const { print, lines } = collect();
    const code = await runChecks(
      [
        {
          title: "던짐",
          run: async () => {
            throw new Error("secret-in-error");
          },
        },
        { title: "다음", run: async () => ({ ok: true, lines: [] }) },
      ],
      print,
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).not.toContain("secret-in-error");
    expect(lines.join("\n")).toContain("[2/2] 다음");
  });

  it("exits 0 only when every check succeeds", async () => {
    const ok = { title: "t", run: async () => ({ ok: true as const, lines: [] }) };
    expect(await runChecks([ok, ok], collect().print)).toBe(0);
  });
});

describe("runGmailCheck", () => {
  function fakeTransport(overrides: Partial<MailTransport> = {}): MailTransport {
    return {
      verify: vi.fn(async () => true),
      sendMail: vi.fn(async () => ({ messageId: "<id@gmail.com>", accepted: ["bot@gmail.com"], rejected: [] })),
      close: vi.fn(),
      ...overrides,
    };
  }

  it("verifies, sends one mail with the exact subject, and reports the id", async () => {
    const transport = fakeTransport();
    const outcome = await runGmailCheck({ ok: true, config: gmailConfig }, () => transport);
    expect(transport.verify).toHaveBeenCalledOnce();
    expect(transport.sendMail).toHaveBeenCalledOnce();
    const message = vi.mocked(transport.sendMail).mock.calls[0]![0];
    expect(message.subject).toBe("[연결 점검] 회의록 봇");
    expect(message.from).toEqual({ name: "회의록 봇", address: "bot@gmail.com" });
    expect(message.to).toBe("bot@gmail.com");
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.lines.join("\n")).toContain("<id@gmail.com>");
    expect(transport.close).toHaveBeenCalled();
  });

  it("does not send when verify fails, and classifies the error", async () => {
    const err = Object.assign(new Error("Invalid login"), {
      code: "EAUTH",
      responseCode: 535,
      response: "535-5.7.8 Username and Password not accepted.",
    });
    const transport = fakeTransport({ verify: vi.fn(async () => Promise.reject(err)) });
    const outcome = await runGmailCheck({ ok: true, config: gmailConfig }, () => transport);
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.cause).toContain("앱 비밀번호");
  });

  it("missing config fails without creating a transport", async () => {
    const factory = vi.fn();
    const outcome = await runGmailCheck({ ok: false, problems: ["GMAIL_USER 비어 있음"] }, factory);
    expect(factory).not.toHaveBeenCalled();
    expect(!outcome.ok && outcome.cause).toContain("GMAIL_USER");
  });

  it("body is short Korean plain text with the send time", () => {
    const message = buildTestMessage(gmailConfig, new Date("2026-09-26T08:30:00Z"));
    expect(message.subject).toBe(TEST_SUBJECT);
    expect(message.text).toContain("이 메일은 연결 점검용입니다.");
    expect(message.text).toContain("2026");
    expect(message.text).toContain("오후 5:30");
  });
});

describe("runGeminiCheck", () => {
  it("sends one request and shows model, trimmed reply and token usage", async () => {
    const generate = vi.fn<GenerateFn>(async () => ({
      text: `  OK\n${"긴 응답".repeat(30)}`,
      usage: { promptTokenCount: 12, candidatesTokenCount: 1, totalTokenCount: 13 },
    }));
    const outcome = await runGeminiCheck(
      { ok: true, config: { apiKey: "k", model: "gemini-3.8-flash" } },
      generate,
    );
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]![0]).toMatchObject({ model: "gemini-3.8-flash", timeoutMs: 30_000 });
    expect(outcome.ok).toBe(true);
    const text = outcome.ok ? outcome.lines.join("\n") : "";
    expect(text).toContain("모델: gemini-3.8-flash");
    expect(text).toMatch(/응답: OK 긴 응답.*…/);
    expect(text).toContain("입력 12, 출력 1, 합계 13");
    const reply = outcome.ok ? outcome.lines[1]! : "";
    expect(reply.length).toBeLessThanOrEqual("응답: ".length + 51);
  });

  it("classifies a thrown API error", async () => {
    const err = Object.assign(
      new Error(JSON.stringify({ error: { code: 404, status: "NOT_FOUND", message: "not found" } })),
      { status: 404 },
    );
    const outcome = await runGeminiCheck(
      { ok: true, config: { apiKey: "k", model: "gemini-nope" } },
      async () => Promise.reject(err),
    );
    expect(!outcome.ok && outcome.cause).toContain("gemini-nope");
  });

  it("missing key fails without calling the API", async () => {
    const generate = vi.fn();
    const outcome = await runGeminiCheck({ ok: false, problems: ["GEMINI_API_KEY 비어 있음"] }, generate);
    expect(generate).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
  });
});
