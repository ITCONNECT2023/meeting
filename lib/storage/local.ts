import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  VALIDATION_MESSAGES,
} from "@/lib/validation/input";
import { missingAudioError, type StorageDriver, type StoredAudioFile } from "./types";

function getUploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), ".local-data", "uploads");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

export class LocalStorageDriver implements StorageDriver {
  private uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir || getUploadDir();
  }

  async saveAudio(
    jobId: string,
    fileName: string,
    source: ReadableStream<Uint8Array> | Buffer,
  ): Promise<StoredAudioFile> {
    ensureDir(this.uploadDir);

    const ext = getExtension(fileName);
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
      const err = new Error(VALIDATION_MESSAGES.fileFormat(ext));
      (err as { code?: string }).code = "FILE_TYPE";
      throw err;
    }

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(this.uploadDir, `${jobId}_${safeName}`);

    if (Buffer.isBuffer(source)) {
      if (source.length > MAX_FILE_BYTES) {
        const err = new Error(VALIDATION_MESSAGES.fileTooLarge);
        (err as { code?: string }).code = "FILE_TOO_LARGE";
        throw err;
      }
      await fs.promises.writeFile(targetPath, source);
      return {
        jobId,
        fileName,
        filePath: targetPath,
        sizeBytes: source.length,
      };
    }

    // Stream write with size limit enforcement
    const nodeStream = Readable.fromWeb(source as import("node:stream/web").ReadableStream);
    const writeStream = fs.createWriteStream(targetPath);

    let totalBytes = 0;
    let exceeded = false;

    const sizeTracker = new (class extends (await import("node:stream")).Transform {
      _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
        totalBytes += chunk.length;
        if (totalBytes > MAX_FILE_BYTES) {
          exceeded = true;
          const err = new Error(VALIDATION_MESSAGES.fileTooLarge);
          (err as { code?: string }).code = "FILE_TOO_LARGE";
          callback(err);
          return;
        }
        callback(null, chunk);
      }
    })();

    try {
      await pipeline(nodeStream, sizeTracker, writeStream);
    } catch (error) {
      // Clean up partially written file
      if (fs.existsSync(targetPath)) {
        try {
          await fs.promises.unlink(targetPath);
        } catch {
          // ignore
        }
      }
      if (exceeded) {
        const err = new Error(VALIDATION_MESSAGES.fileTooLarge);
        (err as { code?: string }).code = "FILE_TOO_LARGE";
        throw err;
      }
      throw error;
    }

    return {
      jobId,
      fileName,
      filePath: targetPath,
      sizeBytes: totalBytes,
    };
  }

  async getAudioPath(jobId: string): Promise<string | null> {
    ensureDir(this.uploadDir);
    const files = await fs.promises.readdir(this.uploadDir);
    const prefix = `${jobId}_`;
    const matched = files.find((f) => f.startsWith(prefix));
    return matched ? path.join(this.uploadDir, matched) : null;
  }

  async hasAudio(jobId: string): Promise<boolean> {
    return (await this.getAudioPath(jobId)) !== null;
  }

  async withAudioFile<T>(jobId: string, run: (filePath: string) => Promise<T>): Promise<T> {
    const audioPath = await this.getAudioPath(jobId);
    if (!audioPath) throw missingAudioError();
    return run(audioPath);
  }

  async deleteAudio(jobId: string): Promise<void> {
    ensureDir(this.uploadDir);
    const files = await fs.promises.readdir(this.uploadDir);
    const prefix = `${jobId}_`;
    for (const f of files) {
      if (f.startsWith(prefix)) {
        try {
          await fs.promises.unlink(path.join(this.uploadDir, f));
        } catch {
          // ignore
        }
      }
    }
  }

  async countUploads(): Promise<number> {
    ensureDir(this.uploadDir);
    const files = await fs.promises.readdir(this.uploadDir);
    return files.filter((f) => f !== ".gitkeep").length;
  }
}
