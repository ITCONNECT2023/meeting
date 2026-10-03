import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { del, get, head, list } from "@vercel/blob";

import { MAX_FILE_BYTES } from "@/lib/validation/input";
import { UPLOAD_PREFIX, jobPathnamePrefix } from "./pathname";
import { missingAudioError, type StorageDriver, type StoredAudioFile } from "./types";

/**
 * EPIC 10-3: Vercel Blob (private store). The browser uploads straight to
 * Blob with a token this server hands out (app/api/upload/token), so the
 * recording never passes through a function body (4.5 MB limit). The server
 * only looks files up, reads them for transcribe, and deletes them.
 */

export const DIRECT_UPLOAD_ONLY_CODE = "DIRECT_UPLOAD_ONLY";

async function listJobBlobs(jobId: string) {
  const prefix = jobPathnamePrefix(jobId);
  const page = await list({ prefix, limit: 100 });
  return page.blobs.filter((blob) => blob.pathname.startsWith(prefix));
}

/**
 * Checks that the browser's upload really landed in the store. Used by the
 * upload-complete paths before the workflow is started.
 */
export async function confirmBlobUpload(pathname: string): Promise<boolean> {
  try {
    const meta = await head(pathname);
    return meta.size > 0 && meta.size <= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

export class BlobStorageDriver implements StorageDriver {
  async saveAudio(): Promise<StoredAudioFile> {
    const err = new Error("녹음은 저장소에 직접 올려야 합니다.");
    (err as { code?: string }).code = DIRECT_UPLOAD_ONLY_CODE;
    throw err;
  }

  async hasAudio(jobId: string): Promise<boolean> {
    return (await listJobBlobs(jobId)).length > 0;
  }

  async withAudioFile<T>(jobId: string, run: (filePath: string) => Promise<T>): Promise<T> {
    const [blob] = await listJobBlobs(jobId);
    if (!blob) throw missingAudioError();

    const result = await get(blob.pathname, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) throw missingAudioError();

    const tmpPath = path.join(
      os.tmpdir(),
      `meeting-${jobId}-${randomUUID()}${path.extname(blob.pathname)}`,
    );
    try {
      await pipeline(
        Readable.fromWeb(result.stream as import("node:stream/web").ReadableStream),
        fs.createWriteStream(tmpPath),
      );
      return await run(tmpPath);
    } finally {
      await fs.promises.rm(tmpPath, { force: true });
    }
  }

  async deleteAudio(jobId: string): Promise<void> {
    try {
      const blobs = await listJobBlobs(jobId);
      if (blobs.length > 0) await del(blobs.map((blob) => blob.url));
    } catch {
      // Same as the local folder: a failed delete is left for the cleanup job.
    }
  }

  async countUploads(): Promise<number> {
    let count = 0;
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: UPLOAD_PREFIX, cursor, limit: 1000 });
      count += page.blobs.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return count;
  }
}
