import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupUploads } from "@/lib/cleanup/uploads";

const TEST_DIR = path.join(process.cwd(), ".local-data", "test-cleanup-uploads");

function touch(filePath: string, mtime: Date): void {
  fs.writeFileSync(filePath, "x");
  fs.utimesSync(filePath, mtime, mtime);
}

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  vi.stubEnv("UPLOAD_DIR", TEST_DIR);
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("EPIC 9-1: 임시 업로드 청소 (lib/cleanup/uploads)", () => {
  it("1시간이 지난 파일은 지우고, 안 지난 파일은 남긴다", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const oldFile = path.join(TEST_DIR, "job-old_meeting.mp3");
    const newFile = path.join(TEST_DIR, "job-new_meeting.mp3");
    touch(oldFile, new Date(now.getTime() - 2 * 60 * 60 * 1000));
    touch(newFile, new Date(now.getTime() - 10 * 60 * 1000));

    const result = await cleanupUploads(now, false);

    expect(result).toEqual({ deleted: 1, kept: 1 });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });

  it(".gitkeep은 아무리 오래되어도 지우지 않는다", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const gitkeep = path.join(TEST_DIR, ".gitkeep");
    touch(gitkeep, new Date(now.getTime() - 5 * 60 * 60 * 1000));

    const result = await cleanupUploads(now, false);

    expect(result).toEqual({ deleted: 0, kept: 0 });
    expect(fs.existsSync(gitkeep)).toBe(true);
  });

  it("dryRun에서는 개수만 세고 실제로는 지우지 않는다", async () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const oldFile = path.join(TEST_DIR, "job-old_meeting.mp3");
    touch(oldFile, new Date(now.getTime() - 2 * 60 * 60 * 1000));

    const result = await cleanupUploads(now, true);

    expect(result).toEqual({ deleted: 1, kept: 0 });
    expect(fs.existsSync(oldFile)).toBe(true);
  });

  it("업로드 폴더가 아직 없으면 오류 없이 0건/0건", async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });

    const result = await cleanupUploads(new Date(), false);

    expect(result).toEqual({ deleted: 0, kept: 0 });
  });
});
