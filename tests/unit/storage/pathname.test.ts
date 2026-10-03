import { describe, expect, it } from "vitest";

import {
  audioPathnameFor,
  isAudioPathnameFor,
  sanitizeFileName,
} from "@/lib/storage/pathname";

const JOB = "3f2a9c1e-0000-4000-8000-000000000001";

describe("audioPathnameFor", () => {
  it("puts the job id and a safe file name under uploads/", () => {
    // Each Korean character and each space becomes one "_": 4 Hangul + 2 spaces.
    expect(audioPathnameFor(JOB, "회의 녹음 final.m4a")).toBe(
      `uploads/${JOB}_${"_".repeat(6)}final.m4a`,
    );
  });

  it("keeps the same sanitising rule as the local folder", () => {
    expect(sanitizeFileName("a b(1).mp3")).toBe("a_b_1_.mp3");
  });
});

describe("isAudioPathnameFor", () => {
  it("accepts this job's own audio name", () => {
    expect(isAudioPathnameFor(audioPathnameFor(JOB, "meeting.mp3"), JOB)).toBe(true);
    expect(isAudioPathnameFor(`uploads/${JOB}_x.WAV`, JOB)).toBe(true);
  });

  it("refuses another job's pathname", () => {
    expect(isAudioPathnameFor(`uploads/other-job_meeting.mp3`, JOB)).toBe(false);
  });

  it("refuses a pathname outside uploads/", () => {
    expect(isAudioPathnameFor(`${JOB}_meeting.mp3`, JOB)).toBe(false);
    expect(isAudioPathnameFor(`../uploads/${JOB}_meeting.mp3`, JOB)).toBe(false);
  });

  it("refuses a disallowed extension", () => {
    expect(isAudioPathnameFor(`uploads/${JOB}_video.mp4`, JOB)).toBe(false);
    expect(isAudioPathnameFor(`uploads/${JOB}_noextension`, JOB)).toBe(false);
  });

  it("refuses an empty job id", () => {
    expect(isAudioPathnameFor(`uploads/_meeting.mp3`, "")).toBe(false);
  });
});
