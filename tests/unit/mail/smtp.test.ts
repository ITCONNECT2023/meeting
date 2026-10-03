import os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Real SMTP / IMAP are never contacted from unit tests: nodemailer and
// imapflow are replaced with in-memory fakes (no real mail is ever sent).
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async (opts: { messageId?: string }) => ({ messageId: opts.messageId })),
  sentFolderIds: [] as string[],
  imapConnect: vi.fn(async () => {}),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    connect = mocks.imapConnect;
    async list() {
      return [
        { path: "INBOX" },
        { path: "[Gmail]/보낸편지함", specialUse: "\\Sent", specialUseSource: "extension" },
      ];
    }
    async getMailboxLock() {
      return { release() {} };
    }
    async search(query: { header?: Record<string, string> }) {
      const wanted = query.header?.["message-id"];
      const idx = mocks.sentFolderIds.indexOf(wanted ?? "");
      return idx >= 0 ? [idx + 1] : [];
    }
    async logout() {}
  },
}));

import {
  sendEmail,
  getFakeSentEmails,
  clearFakeSentEmails,
  createMessageId,
  wasMessageSent,
} from "@/lib/mail/smtp";

describe("lib/mail/smtp", () => {
  beforeEach(() => {
    clearFakeSentEmails();
    process.env.MAIL_PROVIDER = "fake";
    process.env.MAIL_ALLOWLIST = "";
  });

  it("sends email successfully to allowed recipients in fake mode", async () => {
    const res = await sendEmail({
      jobId: "test-job-1",
      recipients: ["user1@example.com", "user2@example.com"],
      subject: "[회의록] 프로젝트 회의 (2026-09-22)",
      text: "회의록 본문 내용",
      attachments: [
        {
          filename: "회의록_2026-09-22.md",
          content: "# 프로젝트 회의",
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.messageId).toContain("test-job-1");
    expect(res.results).toHaveLength(2);
    expect(res.results[0].status).toBe("pending");
    expect(res.results[1].status).toBe("pending");

    const sent = getFakeSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["user1@example.com", "user2@example.com"]);
    expect(sent[0].subject).toBe("[회의록] 프로젝트 회의 (2026-09-22)");
    expect(sent[0].attachments).toHaveLength(1);
    expect(sent[0].attachments![0].filename).toBe("회의록_2026-09-22.md");
  });

  it("filters recipients using MAIL_ALLOWLIST", async () => {
    process.env.MAIL_ALLOWLIST = "allowed@company.com, *@corp.com";

    const res = await sendEmail({
      jobId: "test-job-2",
      recipients: ["allowed@company.com", "other@random.com", "boss@corp.com"],
      subject: "Test Allowlist",
      text: "Body",
    });

    expect(res.ok).toBe(true);
    expect(res.results).toEqual([
      {
        email: "other@random.com",
        status: "failed",
        errorReason: "허용 목록(MAIL_ALLOWLIST)에 없는 주소입니다",
      },
      {
        email: "allowed@company.com",
        status: "pending",
        messageId: expect.any(String),
      },
      {
        email: "boss@corp.com",
        status: "pending",
        messageId: expect.any(String),
      },
    ]);

    const sent = getFakeSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["allowed@company.com", "boss@corp.com"]);
  });

  it("simulates bounce status for known failure prefixes in fake mode", async () => {
    const res = await sendEmail({
      jobId: "test-job-3",
      recipients: [
        "ok@example.com",
        "fail@example.com",
        "quota@example.com",
        "temp@example.com",
        "reject@example.com",
      ],
      subject: "Simulated Failures",
      text: "Body",
    });

    expect(res.ok).toBe(true);
    const failRcp = res.results.find((r) => r.email === "fail@example.com");
    expect(failRcp?.status).toBe("failed");
    expect(failRcp?.errorReason).toBe("주소를 찾을 수 없음");

    const quotaRcp = res.results.find((r) => r.email === "quota@example.com");
    expect(quotaRcp?.status).toBe("failed");
    expect(quotaRcp?.errorReason).toBe("메일함이 가득 참");

    const tempRcp = res.results.find((r) => r.email === "temp@example.com");
    expect(tempRcp?.status).toBe("failed");
    expect(tempRcp?.errorReason).toBe("일시적인 메일 서비스 문제");

    const rejectRcp = res.results.find((r) => r.email === "reject@example.com");
    expect(rejectRcp?.status).toBe("failed");
    expect(rejectRcp?.errorReason).toBe("받는 쪽에서 거절함");

    const okRcp = res.results.find((r) => r.email === "ok@example.com");
    expect(okRcp?.status).toBe("pending");
  });

  it("throws outright error when simulated SMTP connection fails", async () => {
    await expect(
      sendEmail({
        jobId: "test-job-4",
        recipients: ["smtp-reject@example.com"],
        subject: "Outright Reject",
        text: "Body",
      })
    ).rejects.toThrow("Gmail 접수 거절");
  });
});

describe("lib/mail/smtp — 실제 SMTP 허용 목록 (로컬은 닫힌 상태가 기본)", () => {
  beforeEach(() => {
    clearFakeSentEmails();
    mocks.sendMail.mockClear();
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("GMAIL_USER", "bot@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "not-a-real-password");
    vi.stubEnv("MAIL_ALLOWLIST", "");
    vi.stubEnv("VERCEL_ENV", "");
    // 예산 기록 파일(.local-data/gemini-budget.md)을 건드리지 않도록 빈 폴더를 봅니다.
    vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("로컬에서 허용 목록이 비어 있으면 아무에게도 보내지 않고 이유를 남긴다", async () => {
    const res = await sendEmail({
      jobId: "real-1",
      recipients: ["someone@example.com", "other@example.org"],
      subject: "s",
      text: "t",
    });

    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.messageId).toBeUndefined();
    expect(res.results).toEqual([
      { email: "someone@example.com", status: "failed", errorReason: expect.stringContaining("MAIL_ALLOWLIST") },
      { email: "other@example.org", status: "failed", errorReason: expect.stringContaining("MAIL_ALLOWLIST") },
    ]);
    expect(res.results[0].errorReason).toContain("비어");
  });

  it("미리보기(VERCEL_ENV=preview)에서도 비어 있으면 막는다", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await sendEmail({ jobId: "real-2", recipients: ["a@example.com"], subject: "s", text: "t" });
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(res.results[0].status).toBe("failed");
  });

  it("로컬에서 허용 목록에 적힌 주소에는 보낸다", async () => {
    vi.stubEnv("MAIL_ALLOWLIST", "me@example.com");
    const res = await sendEmail({
      jobId: "real-3",
      recipients: ["me@example.com", "stranger@example.com"],
      subject: "s",
      text: "t",
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail.mock.calls[0][0]).toMatchObject({ to: "me@example.com" });
    expect(res.results.find((r) => r.email === "stranger@example.com")?.status).toBe("failed");
    expect(res.results.find((r) => r.email === "me@example.com")?.status).toBe("pending");
  });

  it("운영(VERCEL_ENV=production)은 허용 목록이 없으면 제한하지 않는다", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await sendEmail({ jobId: "real-4", recipients: ["anyone@example.com"], subject: "s", text: "t" });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.results[0].status).toBe("pending");
  });

  it("가짜 메일 창구는 허용 목록이 비어 있어도 영향이 없다", async () => {
    vi.stubEnv("MAIL_PROVIDER", "fake");
    const res = await sendEmail({ jobId: "fake-1", recipients: ["anyone@example.com"], subject: "s", text: "t" });
    expect(res.ok).toBe(true);
    expect(res.results[0].status).toBe("pending");
    expect(getFakeSentEmails()).toHaveLength(1);
  });
});

describe("lib/mail/smtp — 고유 번호(Message-ID)와 보낸편지함 확인 (EPIC 7-4)", () => {
  beforeEach(() => {
    clearFakeSentEmails();
    mocks.sentFolderIds.length = 0;
    vi.stubEnv("MAIL_PROVIDER", "fake");
    vi.stubEnv("MAIL_ALLOWLIST", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("미리 정한 고유 번호를 그대로 붙여 보낸다 (다시 시도해도 같은 번호로 찾을 수 있게)", async () => {
    const id = createMessageId("job-x");
    expect(id).toMatch(/^<job-job-x-[^@>]+@[^>]+>$/);
    expect(createMessageId("job-x")).not.toBe(id);

    const res = await sendEmail({
      jobId: "job-x",
      recipients: ["a@example.com"],
      subject: "s",
      text: "t",
      messageId: id,
    });
    expect(res.messageId).toBe(id);
    expect(res.results[0].messageId).toBe(id);
    expect(getFakeSentEmails()[0].messageId).toBe(id);
  });

  it("가짜 창구: 보낸 적 있는 고유 번호만 '보냄'으로 확인한다", async () => {
    const id = createMessageId("job-y");
    await expect(wasMessageSent(id)).resolves.toBe(false);
    await sendEmail({ jobId: "job-y", recipients: ["a@example.com"], subject: "s", text: "t", messageId: id });
    await expect(wasMessageSent(id)).resolves.toBe(true);
  });

  it("실제 창구: Gmail 보낸편지함에서 같은 고유 번호를 찾는다", async () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("GMAIL_USER", "bot@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "not-a-real-password");
    mocks.sentFolderIds.push("<job-z-1@example.com>");
    await expect(wasMessageSent("<job-z-1@example.com>")).resolves.toBe(true);
    await expect(wasMessageSent("<job-z-2@example.com>")).resolves.toBe(false);
  });

  it("실제 창구: 보낸편지함을 확인하지 못하면 오류를 낸다 (모르는 채로 다시 보내지 않음)", async () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("GMAIL_USER", "bot@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "not-a-real-password");
    mocks.imapConnect.mockRejectedValueOnce(new Error("network down"));
    await expect(wasMessageSent("<job-z-1@example.com>")).rejects.toThrow();
  });
});
