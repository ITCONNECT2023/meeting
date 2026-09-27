import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStorageDriver } from "@/lib/storage/local";

const TEST_UPLOAD_DIR = path.join(process.cwd(), ".local-data", "test-uploads");

beforeEach(() => {
  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  vi.stubEnv("UPLOAD_DIR", TEST_UPLOAD_DIR);
});

afterEach(() => {
  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("LocalStorageDriver", () => {
  it("saves a valid audio file buffer", async () => {
    const driver = new LocalStorageDriver(TEST_UPLOAD_DIR);
    const buffer = Buffer.from("audio content dummy");
    const result = await driver.saveAudio("job-123", "meeting.mp3", buffer);

    expect(result.jobId).toBe("job-123");
    expect(result.sizeBytes).toBe(buffer.length);
    expect(fs.existsSync(result.filePath)).toBe(true);

    const count = await driver.countUploads();
    expect(count).toBe(1);

    const foundPath = await driver.getAudioPath("job-123");
    expect(foundPath).toBe(result.filePath);

    await driver.deleteAudio("job-123");
    expect(fs.existsSync(result.filePath)).toBe(false);
    expect(await driver.countUploads()).toBe(0);
  });

  it("rejects unsupported extensions", async () => {
    const driver = new LocalStorageDriver(TEST_UPLOAD_DIR);
    const buffer = Buffer.from("video content");

    await expect(
      driver.saveAudio("job-video", "video.mp4", buffer),
    ).rejects.toThrow("지원하지 않는 형식입니다(.mp4). mp3, m4a, wav 파일을 올려 주세요.");
  });

  it("rejects files exceeding 200MB and cleans up partial file", async () => {
    const driver = new LocalStorageDriver(TEST_UPLOAD_DIR);
    // Pretend size > 200MB by passing huge buffer length or stream
    const hugeSize = 200 * 1024 * 1024 + 10;
    const hugeBuffer = Buffer.alloc(100);
    Object.defineProperty(hugeBuffer, "length", { value: hugeSize });

    await expect(
      driver.saveAudio("job-huge", "huge.mp3", hugeBuffer),
    ).rejects.toThrow("파일이 너무 큽니다. 200MB 이하 파일을 올려 주세요.");

    const count = await driver.countUploads();
    expect(count).toBe(0);
  });
});
