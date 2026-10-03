/**
 * EPIC 9-1: local upload folder cleanup (TRD 4 "어디에 얼마나 남는가").
 *
 * The local Blob stand-in (`lib/storage/local.ts`, D5) deletes a job's
 * upload as soon as the recording is handed to Gemini, but a crashed or
 * killed process can leave one behind. Anything older than an hour is
 * stale — no in-flight job should still need it — so this sweeps it up.
 *
 * Runs under plain Node (`npm run cleanup`) as well as under Next: relative
 * ".ts" imports only, no "@/" alias, no "server-only".
 */

import fs from "node:fs";
import path from "node:path";

import { del, list } from "@vercel/blob";

import type { CleanupSectionResult } from "./types.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;
/** Same prefix as `lib/storage/pathname.ts`. */
const BLOB_UPLOAD_PREFIX = "uploads/";

/** Same resolution as `lib/storage/local.ts`'s `getUploadDir`. */
export function getUploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), ".local-data", "uploads");
}

export async function cleanupUploads(now: Date, dryRun: boolean): Promise<CleanupSectionResult> {
  // EPIC 10-3: on Vercel the recordings live in Blob, not in a folder.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return cleanupBlobUploads(now, dryRun);
  }

  const dir = getUploadDir();

  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch (err) {
    // No upload folder yet (nothing has been uploaded on this machine) —
    // that's not an error, just nothing to clean.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { deleted: 0, kept: 0 };
    }
    return { deleted: 0, kept: 0, error: "UPLOADS_LIST_FAILED" };
  }

  let deleted = 0;
  let kept = 0;

  try {
    for (const name of entries) {
      if (name === ".gitkeep") continue;

      const fullPath = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch {
        // Vanished between readdir and stat — nothing left to do about it.
        continue;
      }
      if (!stat.isFile()) continue;

      const age = now.getTime() - stat.mtimeMs;
      if (age <= ONE_HOUR_MS) {
        kept++;
        continue;
      }

      if (dryRun) {
        deleted++;
        continue;
      }

      try {
        await fs.promises.unlink(fullPath);
        deleted++;
      } catch {
        // Couldn't remove it (e.g. still open elsewhere) — it's still
        // there, so count it as kept rather than claim it's gone.
        kept++;
      }
    }
    return { deleted, kept };
  } catch {
    return { deleted, kept, error: "UPLOADS_CLEANUP_FAILED" };
  }
}

/** Blob version of the sweep above: same one-hour rule, same counts. */
async function cleanupBlobUploads(now: Date, dryRun: boolean): Promise<CleanupSectionResult> {
  let deleted = 0;
  let kept = 0;
  let cursor: string | undefined;

  try {
    do {
      const page = await list({ prefix: BLOB_UPLOAD_PREFIX, cursor, limit: 1000 });
      const stale: string[] = [];
      for (const blob of page.blobs) {
        if (now.getTime() - blob.uploadedAt.getTime() > ONE_HOUR_MS) {
          stale.push(blob.url);
        } else {
          kept++;
        }
      }
      if (!dryRun && stale.length > 0) {
        await del(stale);
      }
      deleted += stale.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return { deleted, kept };
  } catch {
    return { deleted, kept, error: "UPLOADS_CLEANUP_FAILED" };
  }
}
