import { NextResponse, type NextRequest } from "next/server";

import { checkCronAuthorization } from "@/lib/auth/cron";
import {
  runCleanup,
  type CleanupReport,
  type CleanupSectionResult,
} from "@/lib/cleanup";

/**
 * EPIC 9-1: `GET /api/cron/cleanup`, called once a day by Vercel Cron
 * (EPIC 10 registers it in vercel.json).
 *
 * `proxy.ts` lets exactly this path through without the session cookie;
 * the only credential accepted here is `Authorization: Bearer
 * <CRON_SECRET>` (lib/auth/cron.ts). A logged-in browser without that
 * header is refused like anyone else.
 *
 * 200 with the report when every section ran, 500 with the same report
 * when any section has `error`. The report holds counts and error codes
 * only (TRD 5, 기록). Other methods: 405. HEAD is answered explicitly so
 * Next doesn't map it onto GET and run a cleanup.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Copies only the known count fields, so nothing else can leak out. */
function section(result: CleanupSectionResult): CleanupSectionResult {
  const out: CleanupSectionResult = {
    deleted: result.deleted,
    kept: result.kept,
  };
  if (result.error !== undefined) out.error = result.error;
  return out;
}

function publicReport(report: CleanupReport): CleanupReport {
  return {
    startedAt: report.startedAt,
    dryRun: report.dryRun,
    uploads: section(report.uploads),
    geminiFiles: section(report.geminiFiles),
    workflowRuns: section(report.workflowRuns),
    mail: section(report.mail),
  };
}

function hasSectionError(report: CleanupReport): boolean {
  return [
    report.uploads,
    report.geminiFiles,
    report.workflowRuns,
    report.mail,
  ].some((s) => s.error !== undefined);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = checkCronAuthorization(request.headers.get("authorization"));
  if (auth !== "ok") {
    // Same answer for "wrong secret" and "CRON_SECRET not configured":
    // callers learn nothing about the server's setup.
    return json({ code: "CRON_AUTH_REQUIRED" }, 401);
  }

  let report: CleanupReport;
  try {
    report = publicReport(await runCleanup());
  } catch (error) {
    // Never log the error message itself: it may carry file names or
    // addresses. The name is enough to find the failing section.
    console.error("[cron] cleanup failed:", (error as Error)?.name ?? "Error");
    return json({ code: "CLEANUP_FAILED" }, 500);
  }

  return json(report, hasSectionError(report) ? 500 : 200);
}

function methodNotAllowed(): NextResponse {
  return NextResponse.json(
    { code: "METHOD_NOT_ALLOWED" },
    { status: 405, headers: { ...NO_STORE, Allow: "GET" } },
  );
}

export const HEAD = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
