import { describe, expect, it } from "vitest";
import {
  convertLineNumbersToTimestamps,
  fillMinutesDefaults,
  validateTranscript,
} from "@/lib/ai/validate";
import type { ScriptLine } from "@/lib/minutes/types";

describe("EPIC 5: 받아쓰기 결과 검사 및 회의록 채우기 (lib/ai/validate)", () => {
  const sampleScript: ScriptLine[] = [
    { ts: "00:00", speaker: "김민수", text: "시작하겠습니다." },
    { ts: "01:15", speaker: "이지은", text: "일정 논의합니다." },
    { ts: "03:40", speaker: "화자3", text: "QA는 5일 소요됩니다." },
    { ts: "05:20", speaker: "김민수", text: "출시일 확정하죠." },
  ];

  describe("validateTranscript", () => {
    it("정상적인 순차 발언은 유효하다", () => {
      const res = validateTranscript(sampleScript, 0, 600, 600);
      expect(res.valid).toBe(true);
    });

    it("발언이 0개면 NO_SPEECH로 거절된다", () => {
      const res = validateTranscript([], 0, 600, 600);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("NO_SPEECH");
    });

    it("시각이 역행하면 거절된다", () => {
      const reversed: ScriptLine[] = [
        { ts: "02:00", speaker: "A", text: "첫 번째" },
        { ts: "01:30", speaker: "B", text: "두 번째 (역행)" },
      ];
      const res = validateTranscript(reversed, 0, 300, 300);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("TIMESTAMP_REVERSED");
    });

    it("시각이 구간(20분) 밖이면 거절된다", () => {
      const outOfBounds: ScriptLine[] = [
        { ts: "25:00", speaker: "A", text: "20분 청크 밖 발언" },
      ];
      const res = validateTranscript(outOfBounds, 0, 1200, 3600);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("OUT_OF_BOUNDS");
    });

    it("시각이 전체 녹음 길이를 초과하면 거절된다", () => {
      const exceeds: ScriptLine[] = [
        { ts: "06:00", speaker: "A", text: "전체 5분 녹음 초과" },
      ];
      const res = validateTranscript(exceeds, 0, 600, 300);
      expect(res.valid).toBe(false);
      expect(res.reason).toBe("EXCEEDS_DURATION");
    });
  });

  describe("convertLineNumbersToTimestamps", () => {
    it("유효한 줄 번호를 실제 스크립트 시각으로 올바르게 변환한다", () => {
      const decisions = [
        { text: "출시일 확정", line: 4 },
      ];
      const res = convertLineNumbersToTimestamps(decisions, sampleScript);
      expect(res.valid).toBe(true);
      expect(res.items[0]).toEqual({
        text: "출시일 확정",
        ts: "05:20",
      });
    });

    it("스크립트 범위 밖의 줄 번호는 유효하지 않음으로 표시된다", () => {
      const decisions = [
        { text: "없는 줄 번호", line: 99 },
      ];
      const res = convertLineNumbersToTimestamps(decisions, sampleScript);
      expect(res.valid).toBe(false);
    });

    it("0 또는 음수 줄 번호는 거절된다", () => {
      const decisions = [
        { text: "잘못된 줄 번호", line: 0 },
      ];
      const res = convertLineNumbersToTimestamps(decisions, sampleScript);
      expect(res.valid).toBe(false);
    });
  });

  describe("fillMinutesDefaults", () => {
    it("일시: 입력값 우선 -> 없으면 recordedAt -> 없으면 '미정'", () => {
      // 1. 입력값 있을 때
      const m1 = fillMinutesDefaults(
        { title: "테스트", summary: [], decisions: [], todos: [], script: sampleScript },
        { title: "입력제목", date: "2026-09-22 14:00", recordedAt: "2026-09-20T10:00" },
      );
      expect(m1.date).toBe("2026-09-22 14:00");

      // 2. 입력값 없고 recordedAt 있을 때
      const m2 = fillMinutesDefaults(
        { title: "테스트", summary: [], decisions: [], todos: [], script: sampleScript },
        { recordedAt: "2026-09-20T10:00" },
      );
      expect(m2.date).toBe("2026-09-20 10:00");

      // 3. 둘 다 없을 때 -> '미정'
      const m3 = fillMinutesDefaults(
        { title: "테스트", summary: [], decisions: [], todos: [], script: sampleScript },
        {},
      );
      expect(m3.date).toBe("미정");
    });

    it("참석자: 입력한 이름 먼저 -> 스크립트 화자 추가", () => {
      const m = fillMinutesDefaults(
        { title: "회의", summary: [], decisions: [], todos: [], script: sampleScript },
        { attendees: ["이지은"] },
      );
      // 이지은이 먼저 나오고, 스크립트에 등장한 김민수, 화자3이 추가됨
      expect(m.attendees[0]).toBe("이지은");
      expect(m.attendees).toContain("김민수");
      expect(m.attendees).toContain("화자3");
    });

    it("빈 항목은 '없음'으로 채운다", () => {
      const m = fillMinutesDefaults(
        { summary: [], decisions: [], todos: [], script: sampleScript },
        {},
      );
      expect(m.summary).toEqual([]);
      expect(m.decisions).toEqual([]);
      expect(m.todos).toEqual([]);
    });

    it("할 일의 미입력 담당자/기한은 '미정'을 유지한다", () => {
      const m = fillMinutesDefaults(
        {
          summary: ["요약"],
          decisions: [{ text: "결정", ts: "05:20" }],
          todos: [{ task: "할 일 1", owner: "미정", due: "미정", ts: "03:40" }],
          script: sampleScript,
        },
        {},
      );
      expect(m.todos[0].owner).toBe("미정");
      expect(m.todos[0].due).toBe("미정");
    });
  });
});
