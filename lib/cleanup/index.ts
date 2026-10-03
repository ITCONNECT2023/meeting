/**
 * EPIC 9-1: cleanup core (TRD 4 "어디에 얼마나 남는가", "남은 녹음 청소").
 * `npm run cleanup` (scripts/cleanup) and `GET /api/cron/cleanup` both call
 * this. Each section below is independent — one throwing never stops the
 * others, and only ever surfaces as a short error CODE (never a message
 * with paths, names, addresses or secrets; see `types.ts`).
 *
 * Runs under plain Node (`npm run cleanup`, native TS type stripping) as
 * well as under Next: relative ".ts" imports only, no "@/" alias, no
 * "server-only" — same convention as `lib/mail/retention.ts`.
 */

import { cleanupGeminiFiles } from "./gemini-files.ts";
import type { CleanupOptions, CleanupReport, CleanupSectionResult } from "./types.ts";
import { cleanupUploads } from "./uploads.ts";
import { cleanupWorkflowRuns } from "./workflow-runs.ts";
import { purgeOldMail } from "../mail/retention.ts";

export type { CleanupOptions, CleanupReport, CleanupSectionResult } from "./types.ts";

const MAIL_RETENTION_DAYS = 30;

function isFakeMailProvider(): boolean {
  // Same "unset behaves like fake" default as lib/mail/bounce.ts.
  return (process.env.MAIL_PROVIDER || "fake").toLowerCase() === "fake";
}

async function runMailSection(now: Date, dryRun: boolean): Promise<CleanupSectionResult> {
  if (isFakeMailProvider()) {
    return { deleted: 0, kept: 0 };
  }
  try {
    return await purgeOldMail({ now, olderThanDays: MAIL_RETENTION_DAYS, dryRun });
  } catch {
    return { deleted: 0, kept: 0, error: "MAIL_PURGE_FAILED" };
  }
}

/** Runs a section, turning any escaped exception into a section error. */
async function runSection(
  code: string,
  section: () => Promise<CleanupSectionResult>,
): Promise<CleanupSectionResult> {
  try {
    return await section();
  } catch {
    return { deleted: 0, kept: 0, error: code };
  }
}

export async function runCleanup(options: CleanupOptions = {}): Promise<CleanupReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;

  // Independent on purpose: Promise.all so one section being slow doesn't
  // delay the others, and each is already wrapped so one failing can't
  // reject the others' promises.
  const [uploads, geminiFiles, workflowRuns, mail] = await Promise.all([
    runSection("UPLOADS_CLEANUP_FAILED", () => cleanupUploads(now, dryRun)),
    runSection("GEMINI_LIST_FAILED", () => cleanupGeminiFiles(now, dryRun)),
    runSection("WORKFLOW_CLEANUP_FAILED", () => cleanupWorkflowRuns(now, dryRun)),
    runSection("MAIL_PURGE_FAILED", () => runMailSection(now, dryRun)),
  ]);

  return {
    startedAt: now.toISOString(),
    dryRun,
    uploads,
    geminiFiles,
    workflowRuns,
    mail,
  };
}
