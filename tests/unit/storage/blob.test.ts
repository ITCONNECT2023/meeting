import fs from "node:fs";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMock);

import { BlobStorageDriver, confirmBlobUpload, DIRECT_UPLOAD_ONLY_CODE } from "@/lib/storage/blob";

const JOB = "job-1";

function audioStream(text: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from([Buffer.from(text)])) as ReadableStream<Uint8Array>;
}

beforeEach(() => {
  blobMock.list.mockReset();
  blobMock.get.mockReset();
  blobMock.del.mockReset();
  blobMock.head.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BlobStorageDriver", () => {
  it("refuses server-side saves: the browser uploads directly", async () => {
    const driver = new BlobStorageDriver();
    await expect(driver.saveAudio()).rejects.toMatchObject({ code: DIRECT_UPLOAD_ONLY_CODE });
  });

  it("reports whether a job's recording exists, matching by job prefix only", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [
        { pathname: `uploads/${JOB}_meeting.mp3`, url: "u1" },
        { pathname: "uploads/job-10_other.mp3", url: "u2" },
      ],
      hasMore: false,
    });
    const driver = new BlobStorageDriver();
    expect(await driver.hasAudio(JOB)).toBe(true);
    expect(blobMock.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: `uploads/${JOB}_` }),
    );
  });

  it("reports no recording when the job has none", async () => {
    blobMock.list.mockResolvedValue({ blobs: [], hasMore: false });
    expect(await new BlobStorageDriver().hasAudio(JOB)).toBe(false);
  });

  it("downloads to a temporary file for the call and removes it afterwards", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [{ pathname: `uploads/${JOB}_meeting.mp3`, url: "u1" }],
      hasMore: false,
    });
    blobMock.get.mockResolvedValue({
      statusCode: 200,
      stream: audioStream("dummy audio"),
    });

    let seenPath = "";
    const result = await new BlobStorageDriver().withAudioFile(JOB, async (filePath) => {
      seenPath = filePath;
      expect(fs.readFileSync(filePath, "utf8")).toBe("dummy audio");
      return "done";
    });

    expect(result).toBe("done");
    expect(seenPath.endsWith(".mp3")).toBe(true);
    expect(fs.existsSync(seenPath)).toBe(false);
    expect(blobMock.get).toHaveBeenCalledWith(`uploads/${JOB}_meeting.mp3`, { access: "private" });
  });

  it("removes the temporary file even when the transcribe step fails", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [{ pathname: `uploads/${JOB}_meeting.mp3`, url: "u1" }],
      hasMore: false,
    });
    blobMock.get.mockResolvedValue({ statusCode: 200, stream: audioStream("x") });

    let seenPath = "";
    await expect(
      new BlobStorageDriver().withAudioFile(JOB, async (filePath) => {
        seenPath = filePath;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(fs.existsSync(seenPath)).toBe(false);
  });

  it("reports a missing recording as FILE_CORRUPT", async () => {
    blobMock.list.mockResolvedValue({ blobs: [], hasMore: false });
    await expect(
      new BlobStorageDriver().withAudioFile(JOB, async () => "never"),
    ).rejects.toMatchObject({ code: "FILE_CORRUPT" });
  });

  it("deletes the job's blobs by URL", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [{ pathname: `uploads/${JOB}_meeting.mp3`, url: "https://blob/x" }],
      hasMore: false,
    });
    await new BlobStorageDriver().deleteAudio(JOB);
    expect(blobMock.del).toHaveBeenCalledWith(["https://blob/x"]);
  });

  it("counts uploads across every page", async () => {
    blobMock.list
      .mockResolvedValueOnce({ blobs: [{}, {}], hasMore: true, cursor: "next" })
      .mockResolvedValueOnce({ blobs: [{}], hasMore: false });
    expect(await new BlobStorageDriver().countUploads()).toBe(3);
    expect(blobMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next" }));
  });
});

describe("confirmBlobUpload", () => {
  it("accepts a blob that exists and is not empty", async () => {
    blobMock.head.mockResolvedValue({ size: 1234 });
    expect(await confirmBlobUpload("uploads/job_x.mp3")).toBe(true);
  });

  it("rejects an empty or missing blob", async () => {
    blobMock.head.mockResolvedValue({ size: 0 });
    expect(await confirmBlobUpload("uploads/job_x.mp3")).toBe(false);
    blobMock.head.mockRejectedValue(new Error("not found"));
    expect(await confirmBlobUpload("uploads/job_x.mp3")).toBe(false);
  });
});
