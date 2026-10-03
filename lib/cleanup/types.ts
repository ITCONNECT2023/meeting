/**
 * EPIC 9-1: shared shape of one cleanup run. `runCleanup` (lib/cleanup/index.ts)
 * returns it; `npm run cleanup` prints it and `GET /api/cron/cleanup`
 * answers with it. Counts and error codes only — never file names, job
 * ids' contents, addresses or meeting text (TRD 5, 기록).
 */

export interface CleanupSectionResult {
  /** How many items were removed (or would be, when dryRun). */
  deleted: number;
  /** How many were looked at and kept (too new, still running, …). */
  kept: number;
  /** Set when this section could not run; the other sections still run. */
  error?: string;
}

export interface CleanupReport {
  startedAt: string;
  dryRun: boolean;
  /** Local upload folder (.local-data/uploads), files older than 1 hour. */
  uploads: CleanupSectionResult;
  /** Gemini file store, files older than 1 hour. */
  geminiFiles: CleanupSectionResult;
  /** Workflow run records, finished more than 1 day ago. */
  workflowRuns: CleanupSectionResult;
  /** Dedicated Gmail, mail older than 30 days moved to Trash. */
  mail: CleanupSectionResult;
}

export interface CleanupOptions {
  now?: Date;
  dryRun?: boolean;
}
