import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * TRD 5장 "기록" 정적 점검.
 *
 * 기록(로그)에는 작업 번호, 단계, 오류 코드, 걸린 시간, AI 토큰 수만 남을 수
 * 있습니다. 녹음 내용, 스크립트, 이름, 메일 주소, 파일 이름, 비밀값은 절대
 * 남기지 않습니다.
 *
 * 이 시험은 app/, lib/, workflows/, proxy.ts의 모든 console.* 호출을 찾아
 * 인자에 금지된 값이 쓰였는지 정적으로 확인합니다. AST 수준의 완벽한 분석은
 * 아니고, 문자열/템플릿 리터럴의 "그냥 적힌 문구"는 무시하고(예: "4분이
 * 넘었습니다" 같은 안내문 속 낱말은 무시) 실제 값이 채워지는 자리
 * (템플릿 보간 `${...}`, 그대로 넘긴 인자)만 검사해 오탐을 줄입니다.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "workflows"];
const SCAN_FILES = ["proxy.ts"];

// 소스가 아니라 빌드 산출물이라 검사하지 않는 경로 (workflow 패키지가
// 매 빌드마다 workflows/steps.ts 등에서 다시 생성하는 파일들. git에도
// 올리지 않음 — .gitignore 참고).
const SKIP_SEGMENTS = [`${path.sep}.well-known${path.sep}`];

const CONSOLE_CALL = /console\.(log|error|warn|info|debug)\s*\(/g;

// 값이 실제로 채워지는 자리에 있으면 안 되는 이름들.
// (메일 주소, 참석자 이름, 스크립트/회의록 본문, 파일 이름 등)
const FORBIDDEN_VALUE_NAMES = [
  "email",
  "emails",
  "to",
  "recipient",
  "recipients",
  "script",
  "transcript",
  "minutes",
  "fileName",
  "filename",
  "attendee",
  "attendees",
  "address",
  "addresses",
];

// 원본 오류 객체(또는 .message)를 통째로 남기면 안 됩니다. err.code처럼
// 코드값만 남기는 것은 허용합니다.
const RAW_ERROR_NAMES = ["err", "error", "e", "sendErr", "smtpErr", "imapErr", "gmailErr", "mailErr"];

/**
 * 문자열·템플릿 리터럴의 "그냥 적힌 글자" 부분을 공백으로 지웁니다.
 * 템플릿 리터럴의 `${...}` 안쪽은 실제 코드이므로 그대로 남깁니다.
 * 길이를 보존해서(같은 인덱스가 원본과 대응) 줄 번호 계산이 어긋나지
 * 않게 합니다.
 */
function stripLiteralText(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"') {
      const quote = c;
      out += " ";
      i++;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\" && i + 1 < code.length) {
          out += "  ";
          i += 2;
          continue;
        }
        out += " ";
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    if (c === "`") {
      out += " ";
      i++;
      while (i < code.length && code[i] !== "`") {
        if (code[i] === "\\" && i + 1 < code.length) {
          out += "  ";
          i += 2;
          continue;
        }
        if (code[i] === "$" && code[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < code.length && depth > 0) {
            if (code[i] === "{") depth++;
            else if (code[i] === "}") depth--;
            out += code[i];
            i++;
          }
          continue;
        }
        out += " ";
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 최상위 콤마(괄호/대괄호/중괄호 밖)로 인자를 나눕니다. */
function splitTopLevelArgs(residue: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of residue) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim() !== "") args.push(current);
  return args;
}

interface Violation {
  line: number;
  snippet: string;
  reason: string;
}

function findConsoleViolations(source: string): Violation[] {
  const residue = stripLiteralText(source);
  const violations: Violation[] = [];

  CONSOLE_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONSOLE_CALL.exec(residue))) {
    const openParenIdx = match.index + match[0].length - 1;
    let depth = 0;
    let closeIdx = -1;
    for (let i = openParenIdx; i < residue.length; i++) {
      if (residue[i] === "(") depth++;
      else if (residue[i] === ")") {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx === -1) continue; // unbalanced — ignore rather than crash

    const argsResidue = residue.slice(openParenIdx + 1, closeIdx);
    const line = source.slice(0, match.index).split("\n").length;
    const snippet = source.slice(match.index, Math.min(source.length, closeIdx + 1)).slice(0, 160);

    const forbiddenNameRegex = new RegExp(`\\b(${FORBIDDEN_VALUE_NAMES.join("|")})\\b`, "i");
    const foundName = argsResidue.match(forbiddenNameRegex);
    if (foundName) {
      violations.push({
        line,
        snippet,
        reason: `금지된 값(${foundName[0]})이 로그 인자 자리에 쓰였습니다`,
      });
    }

    const rawErrorRegex = new RegExp(`^(${RAW_ERROR_NAMES.join("|")})(\\.message)?$`, "i");
    for (const arg of splitTopLevelArgs(argsResidue)) {
      const trimmed = arg.trim();
      if (trimmed !== "" && rawErrorRegex.test(trimmed)) {
        violations.push({
          line,
          snippet,
          reason: `원본 오류 객체(또는 .message)를 그대로 남겼습니다: ${trimmed}`,
        });
      }
    }
  }

  return violations;
}

function listSourceFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (SKIP_SEGMENTS.some((seg) => full.includes(seg))) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }

  for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  for (const file of SCAN_FILES) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full)) files.push(full);
  }

  return files;
}

describe("로그 정책 정적 점검 (TRD 5장 기록)", () => {
  it("탐지 로직이 금지된 패턴을 실제로 잡아낸다 (자체 검증)", () => {
    expect(
      findConsoleViolations('console.error("메일 발송 실패", err);'),
    ).toHaveLength(1);
    expect(
      findConsoleViolations("console.error(err.message);"),
    ).toHaveLength(1);
    expect(
      findConsoleViolations('console.log(`받는 사람: ${to.join(",")}`);'),
    ).toHaveLength(1);
    expect(
      findConsoleViolations("console.log(`스크립트: ${script}`);"),
    ).toHaveLength(1);
    expect(
      findConsoleViolations("console.warn(`파일 ${fileName} 처리 실패`);"),
    ).toHaveLength(1);
  });

  it("허용되는 패턴(작업 번호, 오류 코드, 걸린 시간)은 통과한다 (자체 검증)", () => {
    expect(
      findConsoleViolations(
        'console.error(`[send] job=${jobId} step=send-mail error=${code}`);',
      ),
    ).toHaveLength(0);
    expect(
      findConsoleViolations(
        'console.warn(`[Warning] Job ${jobId} transcribe took longer than 4 minutes: ${elapsed}s`);',
      ),
    ).toHaveLength(0);
    expect(
      findConsoleViolations('console.error(`처리 실패: ${err.code ?? "UNKNOWN"}`);'),
    ).toHaveLength(0);
  });

  const files = listSourceFiles();

  it("점검 대상 파일을 찾는다 (app/, lib/, workflows/, proxy.ts)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    it(`${rel}: console 호출에 금지된 값이 없다`, () => {
      const source = fs.readFileSync(file, "utf8");
      const violations = findConsoleViolations(source);
      if (violations.length > 0) {
        const details = violations
          .map((v) => `  ${rel}:${v.line} - ${v.reason}\n    ${v.snippet}`)
          .join("\n");
        throw new Error(`금지된 로그 패턴을 찾았습니다:\n${details}`);
      }
      expect(violations).toHaveLength(0);
    });
  }
});
