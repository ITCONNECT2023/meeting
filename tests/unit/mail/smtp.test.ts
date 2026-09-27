import { describe, it, expect, beforeEach } from "vitest";
import {
  sendEmail,
  getFakeSentEmails,
  clearFakeSentEmails,
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
