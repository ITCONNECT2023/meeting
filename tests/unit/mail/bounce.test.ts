import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A fake INBOX so the real-IMAP branch can run without any network access.
const imap = vi.hoisted(() => ({
  inbox: [] as { source: string; internalDate: Date }[],
}));

vi.mock("imapflow", () => ({
  ImapFlow: class {
    async connect() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async *fetch() {
      for (const m of imap.inbox) {
        yield { source: Buffer.from(m.source), internalDate: m.internalDate };
      }
    }
    async logout() {}
  },
}));

import {
  checkBouncesForJob,
  mapStatusCodeToReason,
  parseBounceMessage,
} from "@/lib/mail/bounce";

describe("lib/mail/bounce", () => {
  describe("mapStatusCodeToReason", () => {
    it("maps 5.1.x to '주소를 찾을 수 없음'", () => {
      expect(mapStatusCodeToReason("5.1.1")).toBe("주소를 찾을 수 없음");
      expect(mapStatusCodeToReason("5.1.0")).toBe("주소를 찾을 수 없음");
      expect(mapStatusCodeToReason(undefined, "550 5.1.1 User not found")).toBe(
        "주소를 찾을 수 없음"
      );
    });

    it("maps 5.2.x to '메일함이 가득 참'", () => {
      expect(mapStatusCodeToReason("5.2.2")).toBe("메일함이 가득 참");
      expect(mapStatusCodeToReason(undefined, "552 5.2.2 Mailbox is full")).toBe(
        "메일함이 가득 참"
      );
    });

    it("maps 4.x.x to '일시적인 메일 서비스 문제'", () => {
      expect(mapStatusCodeToReason("4.4.1")).toBe("일시적인 메일 서비스 문제");
      expect(mapStatusCodeToReason("4.0.0")).toBe("일시적인 메일 서비스 문제");
      expect(mapStatusCodeToReason(undefined, "Temporary failure, please try again")).toBe(
        "일시적인 메일 서비스 문제"
      );
    });

    it("maps other 5.x.x to '받는 쪽에서 거절함'", () => {
      expect(mapStatusCodeToReason("5.7.1")).toBe("받는 쪽에서 거절함");
      expect(mapStatusCodeToReason("5.0.0")).toBe("받는 쪽에서 거절함");
    });
  });

  describe("parseBounceMessage", () => {
    it("returns null for standard non-bounce emails", async () => {
      const normalEmail = `From: boss@corp.com
To: worker@corp.com
Subject: Weekly Sync
Content-Type: text/plain

See you at 2 PM.`;

      const result = await parseBounceMessage(normalEmail);
      expect(result).toBeNull();
    });

    it("correctly parses a standard Gmail NDR bounce email", async () => {
      const bounceEmail = `From: "Mail Delivery Subsystem" <mailer-daemon@googlemail.com>
To: bot@meeting.local
Subject: Delivery Status Notification (Failure)
In-Reply-To: <job-abc-123@meeting.local>
Content-Type: text/plain; charset=utf-8

** Address not found **

Your message wasn't delivered to nonexistent@recipient.com because the address couldn't be found, or is unable to receive mail.

The response from the remote server was:
550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces.

Final-Recipient: rfc822; nonexistent@recipient.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.`;

      const parsed = await parseBounceMessage(bounceEmail);
      expect(parsed).not.toBeNull();
      expect(parsed?.recipient).toBe("nonexistent@recipient.com");
      expect(parsed?.statusCode).toBe("5.1.1");
      expect(parsed?.reason).toBe("주소를 찾을 수 없음");
      expect(parsed?.originalMessageId).toBe("<job-abc-123@meeting.local>");
    });

    it("correctly parses a mailbox full quota bounce email", async () => {
      const quotaBounce = `From: postmaster@mail.receiver.org
To: bot@meeting.local
Subject: Undelivered Mail Returned to Sender
Content-Type: text/plain

Final-Recipient: rfc822; fullmailbox@receiver.org
Action: failed
Status: 5.2.2
Diagnostic-Code: smtp; 552 5.2.2 Over quota`;

      const parsed = await parseBounceMessage(quotaBounce);
      expect(parsed).not.toBeNull();
      expect(parsed?.recipient).toBe("fullmailbox@receiver.org");
      expect(parsed?.statusCode).toBe("5.2.2");
      expect(parsed?.reason).toBe("메일함이 가득 참");
    });
  });
});

describe("checkBouncesForJob — 이번 발송의 반송만 본다 (FRD 3-4)", () => {
  function dsn(to: string, inReplyTo?: string): string {
    return [
      `From: "Mail Delivery Subsystem" <mailer-daemon@googlemail.com>`,
      `To: bot@example.com`,
      `Subject: Delivery Status Notification (Failure)`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Final-Recipient: rfc822; ${to}`,
      `Action: failed`,
      `Status: 4.2.2`,
    ].join("\n");
  }

  const SENT_AT = Date.parse("2026-09-27T10:00:00Z");

  beforeEach(() => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("GMAIL_USER", "bot@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "not-a-real-password");
    imap.inbox.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("같은 주소라도 앞서 보낸 다른 메일(다른 고유 번호)의 반송은 무시한다", async () => {
    // 오늘 아침 첫 발송이 일시 오류로 반송됐고, 다시 보낸 메일은 잘 도착했다.
    imap.inbox.push({
      source: dsn("x@example.com", "<job-j-old@example.com>"),
      internalDate: new Date(SENT_AT - 60 * 60 * 1000),
    });

    const map = await checkBouncesForJob({
      jobId: "j",
      recipients: ["x@example.com"],
      messageId: "<job-j-new@example.com>",
      sentAt: SENT_AT,
    });
    expect(map.size).toBe(0);
  });

  it("이번 고유 번호에 대한 반송은 잡는다", async () => {
    imap.inbox.push({
      source: dsn("x@example.com", "<job-j-new@example.com>"),
      internalDate: new Date(SENT_AT + 5_000),
    });

    const map = await checkBouncesForJob({
      jobId: "j",
      recipients: ["x@example.com"],
      messageId: "<job-j-new@example.com>",
      sentAt: SENT_AT,
    });
    expect(map.get("x@example.com")?.reason).toBe("일시적인 메일 서비스 문제");
  });

  it("고유 번호가 없는 반송은 보낸 시각 이후에 온 것만 본다", async () => {
    imap.inbox.push(
      { source: dsn("old@example.com"), internalDate: new Date(SENT_AT - 30 * 60 * 1000) },
      { source: dsn("new@example.com"), internalDate: new Date(SENT_AT + 10_000) },
    );

    const map = await checkBouncesForJob({
      jobId: "j",
      recipients: ["old@example.com", "new@example.com"],
      messageId: "<job-j-new@example.com>",
      sentAt: SENT_AT,
    });
    expect([...map.keys()]).toEqual(["new@example.com"]);
  });
});
