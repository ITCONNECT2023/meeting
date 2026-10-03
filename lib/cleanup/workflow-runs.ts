/**
 * EPIC 9-1: Vercel Workflow local-runtime record cleanup (TRD 4 "어디에
 * 얼마나 남는가": "Workflow 진행 기록 ... 실행이 끝나고 1일 뒤 삭제").
 *
 * Local only. `@workflow/next`'s `withWorkflow` (next.config.ts) sets
 * `WORKFLOW_LOCAL_DATA_DIR=.next/workflow-data` for `next dev`/`next start`
 * on this machine (see `node_modules/@workflow/next/dist/index.js` and
 * `node_modules/@workflow/utils/dist/check-data-dir.js`'s
 * `possibleWorkflowDataPaths`), not the `@workflow/world-local` package's
 * own generic default of `.workflow-data` — so that's this project's
 * fallback too when the env var isn't set (e.g. this script, run outside
 * `next dev`).
 *
 * On Vercel (EPIC 10, `WORKFLOW_TARGET_WORLD=vercel`) there is no local
 * data directory at all — Vercel's own Workflow service stores and expires
 * run records itself, so this section becomes a permanent no-op there
 * (the directory never exists → "doesn't exist" branch below, deleted 0 /
 * kept 0, no error).
 *
 * Layout under the data directory (from
 * `node_modules/@workflow/world-local/dist/storage/*.js` and `fs.js`,
 * confirmed against `.next/workflow-data` on this machine):
 *   runs/{runId}.json              — one record per workflow run
 *   steps/{runId}-{stepId}.json    — one record per step of that run
 *   events/{runId}-{eventId}.json  — one record per event of that run
 *   .locks/steps/{runId}-{stepId}.terminal — marker file per finished step
 * A run's `status` is one of "pending" | "running" | "completed" |
 * "failed" | "cancelled"; the last three are terminal and always carry a
 * `completedAt` timestamp (`@workflow/world`'s `WorkflowRunSchema`).
 *
 * Runs under plain Node (`npm run cleanup`) as well as under Next: relative
 * ".ts" imports only, no "@/" alias, no "server-only".
 */

import fs from "node:fs";
import path from "node:path";

import type { CleanupSectionResult } from "./types.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const JSON_EXT = ".json";
const FINISHED_STATUSES = new Set(["completed", "failed", "cancelled"]);

interface RunRecord {
  status?: string;
  completedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

/** Same resolution `@workflow/next` gives this project locally. */
export function getWorkflowDataDir(): string {
  return (
    process.env.WORKFLOW_LOCAL_DATA_DIR || path.join(process.cwd(), ".next", "workflow-data")
  );
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.promises.readdir(dir);
  } catch {
    return [];
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Already gone, or never existed — fine either way.
  }
}

/** Groups `{runId}-...` file names (steps/events/lock files) by run id. */
function groupByRunId(fileNames: readonly string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const name of fileNames) {
    const dash = name.indexOf("-");
    if (dash <= 0) continue;
    const runId = name.slice(0, dash);
    const list = map.get(runId);
    if (list) list.push(name);
    else map.set(runId, [name]);
  }
  return map;
}

export async function cleanupWorkflowRuns(now: Date, dryRun: boolean): Promise<CleanupSectionResult> {
  const baseDir = getWorkflowDataDir();
  const runsDir = path.join(baseDir, "runs");

  let runFiles: string[];
  try {
    runFiles = await fs.promises.readdir(runsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Nothing has run locally yet (or this is Vercel) — not an error.
      return { deleted: 0, kept: 0 };
    }
    return { deleted: 0, kept: 0, error: "WORKFLOW_LIST_FAILED" };
  }

  let deleted = 0;
  let kept = 0;

  try {
    const stepsDir = path.join(baseDir, "steps");
    const eventsDir = path.join(baseDir, "events");
    const locksDir = path.join(baseDir, ".locks", "steps");

    const stepsByRun = groupByRunId(await safeReaddir(stepsDir));
    const eventsByRun = groupByRunId(await safeReaddir(eventsDir));
    const locksByRun = groupByRunId(await safeReaddir(locksDir));

    for (const fileName of runFiles) {
      if (!fileName.endsWith(JSON_EXT)) continue;
      const runId = fileName.slice(0, -JSON_EXT.length);
      const runPath = path.join(runsDir, fileName);

      let run: RunRecord;
      try {
        const raw = await fs.promises.readFile(runPath, "utf-8");
        run = JSON.parse(raw) as RunRecord;
      } catch {
        // Unreadable/corrupt record — leave it alone rather than guess.
        kept++;
        continue;
      }

      if (!run.status || !FINISHED_STATUSES.has(run.status)) {
        // pending/running (or an unrecognized status) — never touched.
        kept++;
        continue;
      }

      const finishedRaw = run.completedAt ?? run.updatedAt ?? run.createdAt;
      const finishedAt = finishedRaw ? new Date(finishedRaw).getTime() : NaN;
      if (!Number.isFinite(finishedAt) || now.getTime() - finishedAt <= ONE_DAY_MS) {
        kept++;
        continue;
      }

      if (!dryRun) {
        await removeIfExists(runPath);
        for (const f of stepsByRun.get(runId) ?? []) await removeIfExists(path.join(stepsDir, f));
        for (const f of eventsByRun.get(runId) ?? [])
          await removeIfExists(path.join(eventsDir, f));
        // Best-effort: the per-step "finished" lock markers aren't part of
        // the documented run/step/event record set, so their removal
        // doesn't affect the count either way.
        for (const f of locksByRun.get(runId) ?? []) await removeIfExists(path.join(locksDir, f));
      }
      deleted++;
    }

    return { deleted, kept };
  } catch {
    return { deleted, kept, error: "WORKFLOW_CLEANUP_FAILED" };
  }
}
