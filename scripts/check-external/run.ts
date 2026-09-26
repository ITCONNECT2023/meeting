/**
 * EPIC 1-7: runs each check independently (one failing never skips the
 * next) and prints a Korean result per check. Exit code 0 only if all
 * succeed.
 */

import type { Check, CheckOutcome } from "./types.ts";

export type Print = (line: string) => void;

async function runOne(check: Check): Promise<CheckOutcome> {
  try {
    return await check.run();
  } catch {
    // Checks classify their own errors; this is only a safety net. The
    // error itself is not printed (it could carry request details).
    return {
      ok: false,
      cause: "점검 도중 예상하지 못한 오류가 났습니다.",
      next: ["다시 실행해 보세요."],
    };
  }
}

export async function runChecks(checks: readonly Check[], print: Print): Promise<number> {
  let passed = 0;

  for (const [index, check] of checks.entries()) {
    print("");
    print(`[${index + 1}/${checks.length}] ${check.title}`);
    const outcome = await runOne(check);

    if (outcome.ok) {
      passed += 1;
      print("  결과: 성공");
      for (const line of outcome.lines) print(`  ${line}`);
    } else {
      print("  결과: 실패");
      print(`  원인: ${outcome.cause}`);
      for (const step of outcome.next) print(`  할 일: ${step}`);
      if (outcome.detail) print(`  세부: ${outcome.detail}`);
    }
  }

  print("");
  const allPassed = passed === checks.length;
  print(
    allPassed
      ? `모두 성공 (${passed}/${checks.length}).`
      : `${checks.length}개 중 ${checks.length - passed}개 실패. 위 '할 일'을 따라 고친 뒤 다시 실행하세요.`,
  );
  return allPassed ? 0 : 1;
}
