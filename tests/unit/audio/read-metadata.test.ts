import { describe, expect, it } from "vitest";

import {
  pickRecordedAt,
  readAudioMetadata,
} from "@/lib/audio/read-metadata";

/**
 * Builds a minimal PCM WAV file in memory: a 44-byte canonical header plus
 * `dataBytes` bytes of silence. `declaredDataBytes` (defaults to
 * `dataBytes`) lets a test lie in the header about how much data follows,
 * to probe how music-metadata reacts to a truncated file.
 */
function buildWav(options: {
  sampleRate: number;
  bitsPerSample?: number;
  numChannels?: number;
  dataBytes: number;
  declaredDataBytes?: number;
}): ArrayBuffer {
  const {
    sampleRate,
    bitsPerSample = 8,
    numChannels = 1,
    dataBytes,
    declaredDataBytes = dataBytes,
  } = options;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + declaredDataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, declaredDataBytes, true);
  bytes.fill(128, 44, 44 + dataBytes); // mid-value = silence for 8-bit PCM
  return buffer;
}

describe("pickRecordedAt", () => {
  const now = new Date("2026-09-27T12:00:00");

  it("prefers format.creationTime over common.date", () => {
    const result = pickRecordedAt(
      { creationTime: new Date("2026-01-02T03:04:00") },
      { date: "2026-05-06T07:08:00" },
      now,
    );
    expect(result).toBe("2026-01-02T03:04");
  });

  it("falls back to common.date when creationTime is absent", () => {
    const result = pickRecordedAt(
      {},
      { date: "2026-05-06T07:08:00" },
      now,
    );
    expect(result).toBe("2026-05-06T07:08");
  });

  it("returns null when neither is present", () => {
    expect(pickRecordedAt({}, {}, now)).toBeNull();
  });

  it("ignores a pre-2000 creationTime (MP4 1904 zero-time artifact)", () => {
    const result = pickRecordedAt(
      { creationTime: new Date("1904-01-01T00:00:00") },
      { date: "2026-05-06T07:08:00" },
      now,
    );
    expect(result).toBe("2026-05-06T07:08");
  });

  it("ignores a creationTime more than 1 day in the future", () => {
    const tooFarFuture = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const result = pickRecordedAt(
      { creationTime: tooFarFuture },
      { date: "2026-05-06T07:08:00" },
      now,
    );
    expect(result).toBe("2026-05-06T07:08");
  });

  it("ignores an invalid Date", () => {
    const result = pickRecordedAt(
      { creationTime: new Date(NaN) },
      { date: "2026-05-06T07:08:00" },
      now,
    );
    expect(result).toBe("2026-05-06T07:08");
  });

  it("treats a date-only common.date tag (no time part) as unusable", () => {
    expect(pickRecordedAt({}, { date: "2026-09-22" }, now)).toBeNull();
  });

  it("ignores an unparseable common.date tag", () => {
    expect(pickRecordedAt({}, { date: "not a date 12:00" }, now)).toBeNull();
  });
});

describe("readAudioMetadata (real parse)", () => {
  it("reads duration ≈ 2s from a tiny 8kHz mono 8-bit PCM WAV", async () => {
    const sampleRate = 8000;
    const dataBytes = sampleRate * 2; // 2 seconds, 1 byte/sample
    const wav = buildWav({ sampleRate, dataBytes });
    const blob = new Blob([wav], { type: "audio/wav" });

    const result = await readAudioMetadata(blob);

    expect(result.durationSec).not.toBeNull();
    expect(result.durationSec as number).toBeCloseTo(2, 1);
  });

  it("never throws on garbage bytes named .mp3; resolves both fields to null", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const file = new File([garbage], "garbage.mp3", { type: "audio/mpeg" });

    const result = await readAudioMetadata(file);

    expect(result).toEqual({ durationSec: null, recordedAt: null });
  });

  // Note: the brief also asks for a WAV whose header claims 7201s of data
  // but is truncated, checking whether music-metadata reports the
  // (bogus) header duration. Verified experimentally: it does not — the
  // parser (via strtok3, which knows the Blob's real byte length) clips to
  // the actual bytes present and reports the *real* ~2s duration instead
  // of the declared 7201s. So there is no "header lies, parser believes
  // it" case to guard against for Blob input, and that test is dropped per
  // the brief's fallback instruction.
});
