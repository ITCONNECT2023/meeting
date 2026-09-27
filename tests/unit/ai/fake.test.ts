import { describe, expect, it } from "vitest";

import { fakeTranscribe, fakeWriteMinutes, FAKE_EXAMPLE_SCRIPT } from "@/lib/ai/fake";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { writeMeetingMinutes } from "@/lib/ai/write-minutes";

describe("fake AI provider", () => {
  it("returns example script and duration for normal files", async () => {
    const result = await fakeTranscribe({
      filePath: "sample.mp3",
      fileName: "meeting.mp3",
    });

    expect(result.script.length).toBeGreaterThan(0);
    expect(result.durationSeconds).toBe(1545);
    expect(result.script[0]).toEqual({
      ts: "00:00",
      speaker: "김민수",
      text: "시작하겠습니다. 오늘은 출시 일정 얘기부터 하죠.",
    });
  });

  it("throws TRANSCRIBE_FAILED error if fileName contains _fail", async () => {
    await expect(
      fakeTranscribe({
        filePath: "sample.mp3",
        fileName: "meeting_fail.mp3",
      }),
    ).rejects.toThrow("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  });

  it("returns default meeting minutes when inputs are empty", async () => {
    const result = await fakeWriteMinutes({
      script: FAKE_EXAMPLE_SCRIPT,
    });

    expect(result.minutes.title).toBe("신규 기능 출시 일정 회의");
    expect(result.minutes.date).toBe("2026-09-22 14:00");
    expect(result.minutes.attendees).toContain("김민수");
    expect(result.minutes.attendees).toContain("이지은");
    expect(result.minutes.attendees).toContain("화자3");
    expect(result.minutes.decisions).toHaveLength(2);
    expect(result.minutes.todos).toHaveLength(3);
  });

  it("preserves custom title, date, and attendees when provided", async () => {
    const result = await fakeWriteMinutes({
      script: FAKE_EXAMPLE_SCRIPT,
      title: "커스텀 회의 제목",
      date: "2026-10-01 10:00",
      attendees: ["홍길동", "이순신"],
    });

    expect(result.minutes.title).toBe("커스텀 회의 제목");
    expect(result.minutes.date).toBe("2026-10-01 10:00");
    expect(result.minutes.attendees).toEqual(["홍길동", "이순신"]);
  });

  it("switches correctly through transcribeAudio and writeMeetingMinutes", async () => {
    const trans = await transcribeAudio({
      filePath: "test.mp3",
      fileName: "test.mp3",
    });
    expect(trans.script.length).toBeGreaterThan(0);

    const min = await writeMeetingMinutes({
      script: trans.script,
      title: "테스트",
    });
    expect(min.minutes.title).toBe("테스트");
  });
});
