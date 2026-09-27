import { describe, it, expect } from "vitest";
import {
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
