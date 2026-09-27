import { describe, expect, it } from "vitest";
import {
  maskString,
  maskScript,
  maskMinutes,
} from "@/lib/privacy/mask";
import type { MeetingMinutes, ScriptLine } from "@/lib/minutes/types";

describe("privacy masking (mask.ts)", () => {
  describe("maskString - sensitive items that MUST be masked", () => {
    it("masks resident registration numbers (주민등록번호)", () => {
      const res = maskString("주민번호는 900101-1234567 입니다.");
      expect(res.masked).toBe("주민번호는 *** 입니다.");
      expect(res.count).toBe(1);
    });

    it("masks mobile phone numbers", () => {
      const res = maskString("연락처는 010-1234-5678 입니다.");
      expect(res.masked).toBe("연락처는 *** 입니다.");
      expect(res.count).toBe(1);
    });

    it("masks landline phone numbers (Seoul 02, regional 031)", () => {
      const res1 = maskString("서울 사무실 번호는 02-1234-5678 입니다.");
      expect(res1.masked).toBe("서울 사무실 번호는 *** 입니다.");
      expect(res1.count).toBe(1);

      const res2 = maskString("지사 번호는 031-123-4567 입니다.");
      expect(res2.masked).toBe("지사 번호는 *** 입니다.");
      expect(res2.count).toBe(1);
    });

    it("masks bank account numbers", () => {
      const res1 = maskString("신한 계좌 110-123-456789 로 입금하세요.");
      expect(res1.masked).toBe("신한 계좌 *** 로 입금하세요.");
      expect(res1.count).toBe(1);

      const res2 = maskString("농협 302-1234-5678-01 계좌입니다.");
      expect(res2.masked).toBe("농협 *** 계좌입니다.");
      expect(res2.count).toBe(1);
    });

    it("masks credit/debit card numbers", () => {
      const res = maskString("법인카드는 1234-5678-9012-3456 입니다.");
      expect(res.masked).toBe("법인카드는 *** 입니다.");
      expect(res.count).toBe(1);
    });

    it("masks multiple sensitive items in a single text", () => {
      const res = maskString("전화번호 010-9999-8888, 계좌번호 110-123-456789 입니다.");
      expect(res.masked).toBe("전화번호 ***, 계좌번호 *** 입니다.");
      expect(res.count).toBe(2);
    });
  });

  describe("maskString - items that MUST NOT be masked", () => {
    it("does NOT mask dates (YYYY-MM-DD, Korean dates)", () => {
      const texts = [
        "회의 일시는 2026-09-22 14:00 입니다.",
        "일정: 2026.09.22 및 2026/09/22",
        "출시일은 10월 15일로 확정한다.",
        "QA 기간은 5일로 한다.",
        "기한은 10월 8일까지 부탁드려요.",
      ];

      for (const text of texts) {
        const res = maskString(text);
        expect(res.masked).toBe(text);
        expect(res.count).toBe(0);
      }
    });

    it("does NOT mask times or timestamps", () => {
      const texts = [
        "오후 14:00 시작",
        "[12:34] 근거",
        "[1:02:03] 1시간 초과 근거",
      ];

      for (const text of texts) {
        const res = maskString(text);
        expect(res.masked).toBe(text);
        expect(res.count).toBe(0);
      }
    });

    it("does NOT mask amounts", () => {
      const texts = [
        "총 예산은 100,000원 입니다.",
        "사업비 50,000,000 책정",
        "비용 1,000 달러",
        "지원금 5만원",
      ];

      for (const text of texts) {
        const res = maskString(text);
        expect(res.masked).toBe(text);
        expect(res.count).toBe(0);
      }
    });

    it("does NOT mask single numbers, versions or unit expressions", () => {
      const texts = [
        "Next.js 16.3.6 적용",
        "최대 200MB, 2시간 이하",
        "참석자 3명, 할 일 5개",
      ];

      for (const text of texts) {
        const res = maskString(text);
        expect(res.masked).toBe(text);
        expect(res.count).toBe(0);
      }
    });
  });

  describe("maskScript", () => {
    it("masks sensitive information inside script lines and preserves speaker and timestamp", () => {
      const script: ScriptLine[] = [
        { ts: "00:00", speaker: "김민수", text: "시작하겠습니다." },
        { ts: "25:38", speaker: "김민수", text: "문의사항은 010-1234-5678로 연락 주세요." },
      ];

      const { script: maskedScript, count } = maskScript(script);
      expect(count).toBe(1);
      expect(maskedScript[0].text).toBe("시작하겠습니다.");
      expect(maskedScript[1].text).toBe("문의사항은 ***로 연락 주세요.");
      expect(maskedScript[1].ts).toBe("25:38");
      expect(maskedScript[1].speaker).toBe("김민수");
    });
  });

  describe("maskMinutes", () => {
    it("masks across all sections (summary, decisions, todos, script)", () => {
      const minutes: MeetingMinutes = {
        title: "보안 점검 회의",
        date: "2026-09-22 14:00",
        attendees: ["김민수", "이지은"],
        summary: ["대표 번호 02-1234-5678로 접수된 문의를 검토했다."],
        decisions: [{ text: "법인 계좌 110-123-456789 사용을 확정한다.", ts: "12:34" }],
        todos: [{ task: "010-8888-9999로 확인 문자 발송", owner: "이지은", due: "10월 8일", ts: "21:45" }],
        script: [
          { ts: "25:38", speaker: "김민수", text: "문의사항은 010-1234-5678로 연락 주세요." },
        ],
      };

      const { minutes: maskedMinutes, count } = maskMinutes(minutes);
      expect(count).toBe(4);
      expect(maskedMinutes.summary[0]).toBe("대표 번호 ***로 접수된 문의를 검토했다.");
      expect(maskedMinutes.decisions[0].text).toBe("법인 계좌 *** 사용을 확정한다.");
      expect(maskedMinutes.todos[0].task).toBe("***로 확인 문자 발송");
      expect(maskedMinutes.script[0].text).toBe("문의사항은 ***로 연락 주세요.");

      // Dates and timestamps must remain intact
      expect(maskedMinutes.date).toBe("2026-09-22 14:00");
      expect(maskedMinutes.decisions[0].ts).toBe("12:34");
      expect(maskedMinutes.todos[0].due).toBe("10월 8일");
      expect(maskedMinutes.todos[0].ts).toBe("21:45");
    });
  });
});
