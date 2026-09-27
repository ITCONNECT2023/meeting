import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  isValidTimestamp,
  parseTimestamp,
} from "@/lib/minutes/timestamp";

describe("timestamp", () => {
  describe("parseTimestamp", () => {
    it("parses [mm:ss] format", () => {
      const parsed = parseTimestamp("[12:34]");
      expect(parsed).toEqual({
        seconds: 12 * 60 + 34,
        formatted: "12:34",
        withBrackets: "[12:34]",
      });
    });

    it("parses mm:ss without brackets", () => {
      const parsed = parseTimestamp("12:34");
      expect(parsed?.seconds).toBe(754);
      expect(parsed?.formatted).toBe("12:34");
    });

    it("parses backtick wrapped `[12:34]`", () => {
      const parsed = parseTimestamp("`[12:34]`");
      expect(parsed?.seconds).toBe(754);
    });

    it("parses [h:mm:ss] format (over 1 hour)", () => {
      const parsed = parseTimestamp("[1:02:03]");
      expect(parsed).toEqual({
        seconds: 3600 + 2 * 60 + 3,
        formatted: "1:02:03",
        withBrackets: "[1:02:03]",
      });
    });

    it("parses [01:02:03] with leading zero in hours", () => {
      const parsed = parseTimestamp("[01:02:03]");
      expect(parsed?.seconds).toBe(3723);
      expect(parsed?.formatted).toBe("1:02:03");
    });

    it("parses 00:00 as 0 seconds", () => {
      const parsed = parseTimestamp("[00:00]");
      expect(parsed?.seconds).toBe(0);
      expect(parsed?.formatted).toBe("00:00");
    });

    it("rejects 99:99 because seconds (99) is >= 60", () => {
      const parsed = parseTimestamp("99:99");
      expect(parsed).toBeNull();
    });

    it("rejects 12:60 because seconds is 60", () => {
      const parsed = parseTimestamp("12:60");
      expect(parsed).toBeNull();
    });

    it("rejects 1:60:00 because minutes is 60", () => {
      const parsed = parseTimestamp("1:60:00");
      expect(parsed).toBeNull();
    });

    it("rejects malformed text or garbage", () => {
      expect(parseTimestamp("abc")).toBeNull();
      expect(parseTimestamp("12")).toBeNull();
      expect(parseTimestamp("12:34:56:78")).toBeNull();
      expect(parseTimestamp("-10:20")).toBeNull();
    });
  });

  describe("formatTimestamp", () => {
    it("formats minutes and seconds below 1 hour", () => {
      expect(formatTimestamp(754)).toBe("12:34");
      expect(formatTimestamp(754, { withBrackets: true })).toBe("[12:34]");
      expect(formatTimestamp(0)).toBe("00:00");
    });

    it("formats 1 hour and above into h:mm:ss", () => {
      expect(formatTimestamp(3723)).toBe("1:02:03");
      expect(formatTimestamp(3723, { withBrackets: true })).toBe("[1:02:03]");
      expect(formatTimestamp(7200)).toBe("2:00:00");
    });

    it("handles negative seconds as 00:00", () => {
      expect(formatTimestamp(-10)).toBe("00:00");
    });
  });

  describe("isValidTimestamp", () => {
    it("returns true for valid timestamps", () => {
      expect(isValidTimestamp("12:34")).toBe(true);
      expect(isValidTimestamp("[12:34]")).toBe(true);
      expect(isValidTimestamp("[1:02:03]")).toBe(true);
    });

    it("returns false for 99:99", () => {
      expect(isValidTimestamp("99:99")).toBe(false);
      expect(isValidTimestamp("[99:99]")).toBe(false);
    });

    it("validates against maxSeconds", () => {
      // 58 minutes 10 seconds = 3490 seconds
      expect(isValidTimestamp("58:10", 3490)).toBe(true);
      expect(isValidTimestamp("58:11", 3490)).toBe(false);
    });
  });
});
