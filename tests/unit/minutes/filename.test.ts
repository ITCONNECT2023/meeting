import { describe, expect, it } from "vitest";
import {
  extractMeetingDate,
  formatMinutesFilename,
  formatMailSubject,
} from "@/lib/minutes/filename";

describe("filename and subject utilities", () => {
  describe("extractMeetingDate", () => {
    it("extracts YYYY-MM-DD from full datetime string", () => {
      expect(extractMeetingDate("2026-09-22 14:00")).toBe("2026-09-22");
      expect(extractMeetingDate("2026-09-22T14:00")).toBe("2026-09-22");
      expect(extractMeetingDate("2026-09-22")).toBe("2026-09-22");
    });

    it("falls back to createdAt or current date when date is '미정' or empty", () => {
      const fixedCreatedAt = new Date("2026-10-05T09:00:00Z").getTime();
      expect(extractMeetingDate("미정", fixedCreatedAt)).toBe("2026-10-05");
      expect(extractMeetingDate("", fixedCreatedAt)).toBe("2026-10-05");
      expect(extractMeetingDate(undefined, fixedCreatedAt)).toBe("2026-10-05");
    });
  });

  describe("formatMinutesFilename", () => {
    it("creates 회의록_YYYY-MM-DD.md with meeting date", () => {
      expect(formatMinutesFilename("2026-09-22 14:00")).toBe("회의록_2026-09-22.md");
    });

    it("uses upload date if meeting date is '미정'", () => {
      const fixedCreatedAt = new Date("2026-09-23T10:00:00Z").getTime();
      expect(formatMinutesFilename("미정", fixedCreatedAt)).toBe("회의록_2026-09-23.md");
    });

    it("handles long meetings (> 1 hour) without altering filename format", () => {
      expect(formatMinutesFilename("2026-11-30 10:00")).toBe("회의록_2026-11-30.md");
    });
  });

  describe("formatMailSubject", () => {
    it("formats [회의록] {제목} ({YYYY-MM-DD}) with date", () => {
      expect(
        formatMailSubject("신규 기능 출시 일정 회의", "2026-09-22 14:00")
      ).toBe("[회의록] 신규 기능 출시 일정 회의 (2026-09-22)");
    });

    it("uses (미정) if meeting date is missing or '미정'", () => {
      expect(
        formatMailSubject("신규 기능 출시 일정 회의", "미정")
      ).toBe("[회의록] 신규 기능 출시 일정 회의 (미정)");
      expect(
        formatMailSubject("신규 기능 출시 일정 회의", "")
      ).toBe("[회의록] 신규 기능 출시 일정 회의 (미정)");
      expect(
        formatMailSubject("신규 기능 출시 일정 회의", undefined)
      ).toBe("[회의록] 신규 기능 출시 일정 회의 (미정)");
    });
  });
});
