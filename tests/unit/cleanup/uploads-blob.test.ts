import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const blobMock = vi.hoisted(() => ({ list: vi.fn(), del: vi.fn() }));

vi.mock("@vercel/blob", () => blobMock);

import { cleanupUploads } from "@/lib/cleanup/uploads.ts";

const NOW = new Date("2026-10-03T12:00:00Z");
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
const TEN_MINUTES_AGO = new Date(NOW.getTime() - 10 * 60 * 1000);

beforeEach(() => {
  blobMock.list.mockReset();
  blobMock.del.mockReset();
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cleanupUploads with Vercel Blob", () => {
  it("deletes recordings older than one hour and keeps the rest", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [
        { pathname: "uploads/old_a.mp3", url: "https://blob/old", uploadedAt: TWO_HOURS_AGO },
        { pathname: "uploads/new_b.mp3", url: "https://blob/new", uploadedAt: TEN_MINUTES_AGO },
      ],
      hasMore: false,
    });

    const result = await cleanupUploads(NOW, false);

    expect(result).toEqual({ deleted: 1, kept: 1 });
    expect(blobMock.del).toHaveBeenCalledWith(["https://blob/old"]);
  });

  it("only counts in a dry run", async () => {
    blobMock.list.mockResolvedValue({
      blobs: [{ pathname: "uploads/old_a.mp3", url: "https://blob/old", uploadedAt: TWO_HOURS_AGO }],
      hasMore: false,
    });

    expect(await cleanupUploads(NOW, true)).toEqual({ deleted: 1, kept: 0 });
    expect(blobMock.del).not.toHaveBeenCalled();
  });

  it("reports a listing failure as an error code", async () => {
    blobMock.list.mockRejectedValue(new Error("network"));
    expect(await cleanupUploads(NOW, false)).toEqual({
      deleted: 0,
      kept: 0,
      error: "UPLOADS_CLEANUP_FAILED",
    });
  });
});
