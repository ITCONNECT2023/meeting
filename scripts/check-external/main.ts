/**
 * `npm run check:external` (EPIC 1-7): from this computer, send one test
 * mail through the dedicated Gmail account and one short request to
 * Gemini, then print a Korean result per check.
 *
 * Reads .env.local the same way Next does (@next/env). Values already in
 * the process environment win over the file. Every printed line passes
 * through the redactor, so secret values never reach the terminal.
 */

import path from "node:path";

import nextEnv from "@next/env";

import { readGeminiConfig, readGmailConfig } from "./config.ts";
import { runGeminiCheck } from "./gemini.ts";
import { runGmailCheck } from "./gmail.ts";
import { collectSecrets, createRedactor } from "./redact.ts";
import { runChecks } from "./run.ts";

const root = process.cwd();
let envFileError = false;
const { loadedEnvFiles } = nextEnv.loadEnvConfig(root, true, {
  info: () => {},
  // @next/env passes the underlying error here; don't print it.
  error: () => {
    envFileError = true;
  },
});

const redact = createRedactor(collectSecrets(process.env));
const print = (line: string) => {
  process.stdout.write(`${redact(line)}\n`);
};

function bail(): void {
  print("점검 도중 예상하지 못한 오류로 멈췄습니다. 다시 실행해 보세요.");
  process.exit(1);
}
process.on("uncaughtException", bail);
process.on("unhandledRejection", bail);

print("외부 연결 점검 (Gmail 발송, Gemini 요청)");
const files = loadedEnvFiles.map((f) => path.relative(root, f.path) || f.path);
print(
  files.length > 0
    ? `설정 파일: ${files.join(", ")}`
    : "설정 파일: 없음 (.env.example을 복사해 .env.local을 만들고 값을 적으세요)",
);
if (envFileError) print("주의: 설정 파일 중 일부를 읽지 못했습니다.");

const exitCode = await runChecks(
  [
    {
      title: "Gmail 시험 메일 보내기",
      run: () => runGmailCheck(readGmailConfig(process.env)),
    },
    {
      title: "Gemini 짧은 요청",
      run: () => runGeminiCheck(readGeminiConfig(process.env)),
    },
  ],
  print,
);

process.exitCode = exitCode;
