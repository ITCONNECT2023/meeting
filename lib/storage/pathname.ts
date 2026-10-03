import { ALLOWED_EXTENSIONS } from "@/lib/validation/input";

/**
 * EPIC 10-3: the Blob pathname rules, shared by the browser (which picks the
 * pathname) and the server (which refuses any pathname it did not expect).
 * Kept free of "server-only" so the upload form can import it too.
 */

export const UPLOAD_PREFIX = "uploads/";

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** `uploads/<jobId>_<safe name>`, the same shape the local folder uses. */
export function audioPathnameFor(jobId: string, fileName: string): string {
  return `${UPLOAD_PREFIX}${jobId}_${sanitizeFileName(fileName)}`;
}

export function jobPathnamePrefix(jobId: string): string {
  return `${UPLOAD_PREFIX}${jobId}_`;
}

/** True only for this job's own upload name with an allowed audio extension. */
export function isAudioPathnameFor(pathname: string, jobId: string): boolean {
  if (!jobId || !pathname.startsWith(jobPathnamePrefix(jobId))) return false;
  const dot = pathname.lastIndexOf(".");
  if (dot <= jobPathnamePrefix(jobId).length) return false;
  const ext = pathname.slice(dot + 1).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number]);
}
