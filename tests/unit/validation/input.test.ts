import { describe, expect, it } from "vitest";

import {
  AudioFileMetaSchema,
  MAX_DURATION_SEC,
  MAX_FILE_BYTES,
  MAX_RECIPIENTS,
  RecipientsSchema,
  VALIDATION_MESSAGES,
  checkDurationSec,
  checkNewAttendee,
  checkNewRecipient,
  checkPickedFile,
  isValidDatetimeLocal,
} from "@/lib/validation/input";

describe("checkPickedFile", () => {
  it("rejects mp4 with the FRD format message naming the extension", () => {
    const result = checkPickedFile({ name: "회의.mp4", size: 1000 });
    expect(result).toEqual({
      ok: false,
      kind: "format",
      message:
        "지원하지 않는 형식입니다(.mp4). mp3, m4a, wav 파일을 올려 주세요.",
    });
  });

  it("accepts mp3/m4a/wav", () => {
    expect(checkPickedFile({ name: "a.mp3", size: 10 })).toEqual({
      ok: true,
      ext: "mp3",
    });
    expect(checkPickedFile({ name: "a.m4a", size: 10 })).toEqual({
      ok: true,
      ext: "m4a",
    });
    expect(checkPickedFile({ name: "a.wav", size: 10 })).toEqual({
      ok: true,
      ext: "wav",
    });
  });

  it("accepts an uppercase extension, normalized to lowercase", () => {
    expect(checkPickedFile({ name: "회의.M4A", size: 10 })).toEqual({
      ok: true,
      ext: "m4a",
    });
  });

  it("uses the no-extension message (no parens) for a name with none", () => {
    const result = checkPickedFile({ name: "회의녹음", size: 10 });
    expect(result).toEqual({
      ok: false,
      kind: "format",
      message: "지원하지 않는 형식입니다. mp3, m4a, wav 파일을 올려 주세요.",
    });
  });

  it("accepts exactly 200MB and rejects 200MB + 1 byte", () => {
    expect(checkPickedFile({ name: "a.mp3", size: MAX_FILE_BYTES })).toEqual({
      ok: true,
      ext: "mp3",
    });
    expect(
      checkPickedFile({ name: "a.mp3", size: MAX_FILE_BYTES + 1 }),
    ).toEqual({
      ok: false,
      kind: "size",
      message: VALIDATION_MESSAGES.fileTooLarge,
    });
  });

  it("reports format before size when both are wrong", () => {
    const result = checkPickedFile({
      name: "a.mp4",
      size: MAX_FILE_BYTES + 1,
    });
    expect(result).toMatchObject({ ok: false, kind: "format" });
  });
});

describe("checkDurationSec", () => {
  it("treats null/undefined/NaN as unknown (ok; checked later)", () => {
    expect(checkDurationSec(null)).toEqual({ ok: true });
    expect(checkDurationSec(undefined)).toEqual({ ok: true });
    expect(checkDurationSec(NaN)).toEqual({ ok: true });
  });

  it("accepts exactly 2 hours and rejects 2 hours + 1 second", () => {
    expect(checkDurationSec(MAX_DURATION_SEC)).toEqual({ ok: true });
    expect(checkDurationSec(MAX_DURATION_SEC + 1)).toEqual({
      ok: false,
      kind: "duration",
      message: VALIDATION_MESSAGES.fileTooLong,
    });
  });

  it("ignores a sub-second overshoot from mp3 encoder padding", () => {
    // Real file: ffprobe 7200.000s, music-metadata 7200.144s.
    expect(checkDurationSec(7200.144)).toEqual({ ok: true });
    expect(checkDurationSec(7201.152).ok).toBe(false);
  });
});

describe("checkNewRecipient", () => {
  it("rejects a bad format (no TLD)", () => {
    expect(checkNewRecipient("jieun.lee@example", [])).toEqual({
      kind: "invalid",
      message: VALIDATION_MESSAGES.emailFormat,
    });
  });

  it("accepts a normal address", () => {
    expect(checkNewRecipient("jieun.lee@example.com", [])).toEqual({
      kind: "ok",
      value: "jieun.lee@example.com",
    });
  });

  it("strips a trailing comma and surrounding whitespace", () => {
    expect(checkNewRecipient(" a@b.com, ", [])).toEqual({
      kind: "ok",
      value: "a@b.com",
    });
  });

  it("treats an empty/whitespace-only draft as nothing to add", () => {
    expect(checkNewRecipient("   ", [])).toEqual({ kind: "empty" });
    expect(checkNewRecipient(",", [])).toEqual({ kind: "empty" });
  });

  it("rejects a duplicate, case-insensitively", () => {
    expect(checkNewRecipient("A@B.COM", ["a@b.com"])).toEqual({
      kind: "duplicate",
      message: VALIDATION_MESSAGES.emailDuplicate,
    });
  });

  it("rejects the 21st address", () => {
    const existing = Array.from(
      { length: MAX_RECIPIENTS },
      (_, i) => `user${i}@example.com`,
    );
    expect(checkNewRecipient("user20@example.com", existing)).toEqual({
      kind: "limit",
      message: VALIDATION_MESSAGES.recipientsLimit,
    });
  });

  it("accepts the 20th address (list not yet full)", () => {
    const existing = Array.from(
      { length: MAX_RECIPIENTS - 1 },
      (_, i) => `user${i}@example.com`,
    );
    expect(checkNewRecipient("user19@example.com", existing)).toEqual({
      kind: "ok",
      value: "user19@example.com",
    });
  });
});

describe("checkNewAttendee", () => {
  it("treats an empty draft as nothing to add", () => {
    expect(checkNewAttendee("  ", [])).toEqual({ kind: "empty" });
  });

  it("strips a trailing comma", () => {
    expect(checkNewAttendee("김민수,", [])).toEqual({
      kind: "ok",
      value: "김민수",
    });
  });

  it("is silent on an exact duplicate (no message field)", () => {
    const result = checkNewAttendee("김민수", ["김민수"]);
    expect(result).toEqual({ kind: "duplicate" });
    expect(result).not.toHaveProperty("message");
  });
});

describe("isValidDatetimeLocal", () => {
  it("accepts a real datetime-local value", () => {
    expect(isValidDatetimeLocal("2026-09-22T14:00")).toBe(true);
  });

  it("rejects a non-existent calendar date", () => {
    expect(isValidDatetimeLocal("2026-02-30T10:00")).toBe(false);
  });

  it("rejects a malformed string", () => {
    expect(isValidDatetimeLocal("2026-09-22 14:00")).toBe(false);
    expect(isValidDatetimeLocal("")).toBe(false);
  });
});

describe("server schemas mirror the same messages", () => {
  it("AudioFileMetaSchema rejects mp4 with the same format message", () => {
    const result = AudioFileMetaSchema.safeParse({
      name: "회의.mp4",
      size: 1000,
      durationSec: 10,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "지원하지 않는 형식입니다(.mp4). mp3, m4a, wav 파일을 올려 주세요.",
    );
  });

  it("AudioFileMetaSchema rejects 200MB + 1 byte and accepts exactly 200MB", () => {
    const tooBig = AudioFileMetaSchema.safeParse({
      name: "a.mp3",
      size: MAX_FILE_BYTES + 1,
      durationSec: 10,
    });
    expect(tooBig.success).toBe(false);
    expect(tooBig.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.fileTooLarge,
    );

    const exact = AudioFileMetaSchema.safeParse({
      name: "a.mp3",
      size: MAX_FILE_BYTES,
      durationSec: 10,
    });
    expect(exact.success).toBe(true);
  });

  it("AudioFileMetaSchema rejects 2h + 1s and accepts exactly 2h", () => {
    const tooLong = AudioFileMetaSchema.safeParse({
      name: "a.mp3",
      size: 10,
      durationSec: MAX_DURATION_SEC + 1,
    });
    expect(tooLong.success).toBe(false);
    expect(tooLong.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.fileTooLong,
    );

    const exact = AudioFileMetaSchema.safeParse({
      name: "a.mp3",
      size: 10,
      durationSec: MAX_DURATION_SEC,
    });
    expect(exact.success).toBe(true);
  });

  it("RecipientsSchema rejects a bad format with the same message", () => {
    const result = RecipientsSchema.safeParse(["jieun.lee@example"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.emailFormat,
    );
  });

  it("RecipientsSchema rejects a 21st address with the limit message", () => {
    const list = Array.from(
      { length: MAX_RECIPIENTS + 1 },
      (_, i) => `user${i}@example.com`,
    );
    const result = RecipientsSchema.safeParse(list);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.recipientsLimit,
    );
  });

  it("RecipientsSchema rejects a case-different duplicate", () => {
    const result = RecipientsSchema.safeParse(["a@b.com", "A@B.COM"]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.emailDuplicate,
    );
  });

  it("RecipientsSchema rejects an empty list with the recipientsEmpty message", () => {
    const result = RecipientsSchema.safeParse([]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      VALIDATION_MESSAGES.recipientsEmpty,
    );
  });
});
