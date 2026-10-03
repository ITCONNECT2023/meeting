/**
 * `npm run cleanup` (EPIC 9-1, TRD 3 "Vercel 청소 예약(cron)" and TRD 4
 * "남은 녹음 청소"): deletes what this service leaves behind once it's old
 * enough that nothing still needs it — stale uploads, stale Gemini
 * file-store copies, finished Workflow run records, old mail. A person
 * runs this locally for now; on Vercel (EPIC 10) `vercel.json`'s daily
 * cron calls the same code instead.
 *
 * Reads .env.local the same way Next does (@next/env). Plain Node, no
 * Next bundler — lib/cleanup and everything it imports use relative
 * ".ts" imports only, so this file does too.
 */

import nextEnv from "@next/env";

import { runCleanup } from "../../lib/cleanup/index.ts";
import type { CleanupReport, CleanupSectionResult } from "../../lib/cleanup/types.ts";

const root = process.cwd();
nextEnv.loadEnvConfig(root, true, {
  info: () => {},
  // @next/env passes the underlying error here; don't print it (it can
  // include the file's path).
  error: () => {},
});

const dryRun = process.argv.includes("--dry-run");

function printSection(label: string, result: CleanupSectionResult): boolean {
  const line = `${label}: 지움 ${result.deleted}건, 유지 ${result.kept}건`;
  if (result.error) {
    console.log(`${line}, 오류 ${result.error}`);
    return false;
  }
  console.log(line);
  return true;
}

async function main(): Promise<void> {
  console.log(dryRun ? "청소 시작 (dry-run: 실제로 지우지 않습니다)" : "청소 시작");

  const report: CleanupReport = await runCleanup({ dryRun });

  let ok = true;
  ok = printSection("임시 업로드 폴더", report.uploads) && ok;
  ok = printSection("Gemini 파일 저장소", report.geminiFiles) && ok;
  ok = printSection("Workflow 진행 기록", report.workflowRuns) && ok;
  ok = printSection("전용 Gmail 메일", report.mail) && ok;

  console.log(ok ? "청소 완료 (오류 없음)." : "청소를 마쳤지만 일부 항목에서 오류가 있었습니다.");
  process.exitCode = ok ? 0 : 1;
}

main().catch(() => {
  console.log("청소 도중 예상하지 못한 오류로 멈췄습니다. 다시 실행해 보세요.");
  process.exitCode = 1;
});
