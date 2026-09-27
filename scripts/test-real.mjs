/**
 * `npm run test:real` (EPIC 5-6):
 * Real Gemini evaluation script comparing results against ground truth.
 *
 * If `tests/fixtures/audio/` does not contain real recordings:
 * prints informational notice and exits 0 cleanly.
 *
 * If `--synthetic` flag is passed, runs evaluation on synthetic sample audio.
 */

import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";

const root = process.cwd();
nextEnv.loadEnvConfig(root);

import { geminiTranscribe, geminiWriteMinutes, listGeminiFiles } from "../lib/ai/gemini.ts";
import { getAccumulatedGeminiCost } from "../lib/ai/budget.ts";

const FIXTURES_DIR = path.join(root, "tests", "fixtures", "audio");
const SYNTHETIC_DIR = path.join(root, ".local-data", "synthetic-audio");

async function main() {
  console.log("=== EPIC 5 실제 AI 연결(Gemini) 시험 및 정답표 비교 ===");

  const hasRealFixtures =
    fs.existsSync(FIXTURES_DIR) &&
    fs.readdirSync(FIXTURES_DIR).some((f) => /\.(mp3|m4a|wav)$/i.test(f));

  const runSynthetic = process.argv.includes("--synthetic") || process.env.RUN_SYNTHETIC === "true";

  if (!hasRealFixtures && !runSynthetic) {
    console.log(
      "시험 녹음이 없습니다. (사용자가 tests/fixtures/audio/에 실제 회의 녹음과 정답표를 추가하면 정답표 비교가 실행됩니다.)",
    );
    console.log("합성 음성 테스트를 실행하려면 `npm run test:real -- --synthetic`을 실행하세요.");
    process.exit(0);
  }

  const audioPath = runSynthetic
    ? path.join(SYNTHETIC_DIR, "sample_meeting.mp3")
    : path.join(FIXTURES_DIR, fs.readdirSync(FIXTURES_DIR).find((f) => /\.(mp3|m4a|wav)$/i.test(f)));

  const groundTruthPath = runSynthetic
    ? path.join(SYNTHETIC_DIR, "ground-truth.json")
    : path.join(FIXTURES_DIR, "ground-truth.json");

  console.log(`- 테스트 파일: ${audioPath}`);
  let groundTruth = null;
  if (fs.existsSync(groundTruthPath)) {
    groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, "utf-8"));
    console.log(`- 정답표 파일 로드: ${groundTruthPath}`);
  }

  const costBefore = await getAccumulatedGeminiCost();
  const startTime = Date.now();

  try {
    // 1. Transcribe
    console.log("1. Gemini 받아쓰기(Transcribe) 요청 중...");
    const transcribeStart = Date.now();
    const transcribeRes = await geminiTranscribe({
      filePath: audioPath,
      fileName: path.basename(audioPath),
      attendees: groundTruth?.attendees || ["김민수", "이지은"],
    });
    const transcribeDuration = Date.now() - transcribeStart;
    console.log(`   -> 받아쓰기 완료: 발언 ${transcribeRes.script.length}줄 (소요: ${Math.round(transcribeDuration / 1000)}초)`);

    // 2. Write Minutes
    console.log("2. Gemini 회의록(Minutes) 생성 요청 중...");
    const minutesStart = Date.now();
    const minutesRes = await geminiWriteMinutes({
      script: transcribeRes.script,
      title: groundTruth?.title || "신규 기능 출시 회의",
      attendees: groundTruth?.attendees || ["김민수", "이지은"],
      fileName: path.basename(audioPath),
    });
    const minutesDuration = Date.now() - minutesStart;
    console.log(`   -> 회의록 작성 완료 (소요: ${Math.round(minutesDuration / 1000)}초)`);

    const totalDuration = Date.now() - startTime;
    const costAfter = await getAccumulatedGeminiCost();
    const costDelta = Math.round((costAfter - costBefore) * 10) / 10;

    // 3. Ground truth comparison
    console.log("\n=== 정답표 비교 결과 ===");
    const { minutes } = minutesRes;
    console.log(`제목: ${minutes.title}`);
    console.log(`일시: ${minutes.date}`);
    console.log(`참석자: ${minutes.attendees.join(", ")}`);
    console.log(`요약: ${minutes.summary.length}건`);
    console.log(`결정사항: ${minutes.decisions.length}건`);
    minutes.decisions.forEach((d, i) => {
      console.log(`  [${i + 1}] ${d.text} (${d.ts || "근거 없음"})`);
    });
    console.log(`할 일: ${minutes.todos.length}건`);
    minutes.todos.forEach((t, i) => {
      console.log(`  [${i + 1}] ${t.task} | 담당: ${t.owner} | 기한: ${t.due} (${t.ts || "근거 없음"})`);
    });

    if (groundTruth) {
      console.log("\n[정답표 일치율 점검]");
      const expectedDecisions = groundTruth.decisions?.length ?? 0;
      const actualDecisions = minutes.decisions.length;
      console.log(`- 결정사항 건수: 정답 ${expectedDecisions}건 vs 실제 ${actualDecisions}건`);

      const hasDueUndefined = minutes.todos.some((t) => t.due === "미정");
      console.log(`- 기한 미정 보존: ${hasDueUndefined ? "정상 보존" : "미정 없음"}`);

      const hasOwnerUndefined = minutes.todos.some((t) => t.owner === "미정");
      console.log(`- 담당자 미정 보존: ${hasOwnerUndefined ? "정상 보존" : "미정 없음"}`);
    }

    // 4. File cleanup check
    console.log("\n=== Gemini 파일 저장소 잔여 파일 점검 (완료 기준 10) ===");
    const remainingFiles = await listGeminiFiles();
    console.log(`- Gemini 파일 저장소 잔여 파일 수: ${remainingFiles.length}건`);
    if (remainingFiles.length === 0) {
      console.log("   -> 통과: 처리가 끝난 뒤 Gemini 파일이 0건으로 정상 삭제되었습니다.");
    } else {
      console.warn("   -> 경고: 파일이 남아 있습니다:", remainingFiles.map((f) => f.name));
    }

    console.log("\n=== 소요 시간 및 비용 요약 ===");
    console.log(`- 총 처리 시간: ${Math.round(totalDuration / 1000)}초 (받아쓰기: ${Math.round(transcribeDuration / 1000)}초, 회의록: ${Math.round(minutesDuration / 1000)}초)`);
    console.log(`- 이번 실행 예상 비용: 약 ${costDelta}원`);
    console.log(`- 누적 Gemini 비용: ${costAfter}원 / 한도 3,000원`);
  } catch (err) {
    console.error("실제 AI 시험 실패:", err);
    process.exit(1);
  }
}

main();
