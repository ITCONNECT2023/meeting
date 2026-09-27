import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), ".local-data", "synthetic-audio");
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

console.log("=== 한국어 음성 합성 및 테스트 오디오 생성 시작 ===");

const rawWavPath = path.join(OUT_DIR, "raw_speech.wav");
const mp3Path = path.join(OUT_DIR, "sample_meeting.mp3");
const m4aPath = path.join(OUT_DIR, "sample_meeting.m4a");
const wavPath = path.join(OUT_DIR, "sample_meeting.wav");
const silentPath = path.join(OUT_DIR, "silent.mp3");
const corruptPath = path.join(OUT_DIR, "corrupted.mp3");

// PowerShell script to synthesize speech to wav
const scriptText = `안녕하세요. 신규 기능 출시 회의를 시작하겠습니다. 지은 님 오셨나요?
네 민수 님, 개발 일정 준비되었습니다.
화자3도 참석했습니다.
그럼 출시일은 10월 15일로 확정하겠습니다.
마케팅 공지 초안은 10월 8일까지 제가 준비할게요.
보고서 정리는 제가 맡겠습니다. 기한은 미정으로 하죠.
테스트 계정 준비도 누군가 해야 합니다. 담당자는 미정입니다.
문의사항은 010-1234-5678로 연락 주세요. 회의를 마칩니다.`;

const psScriptPath = path.join(OUT_DIR, "synth.ps1");
const psScriptContent = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Heami Desktop')
$synth.SetOutputToWaveFile('${rawWavPath.replace(/\\/g, "/")}')
$text = @"
${scriptText}
"@
$synth.Speak($text)
$synth.Dispose()
`;

fs.writeFileSync(psScriptPath, psScriptContent, "utf-8");

try {
  console.log("1. PowerShell System.Speech로 한국어 음성 합성 중...");
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, {
    stdio: "inherit",
  });
  console.log("   -> raw_speech.wav 생성 완료");
} catch (err) {
  console.error("음성 합성 실패:", err);
  process.exit(1);
}

// Convert using ffmpeg
try {
  console.log("2. ffmpeg로 포맷 변환 (mp3, m4a, wav)...");
  execSync(`ffmpeg -y -i "${rawWavPath}" -codec:a libmp3lame -q:a 2 "${mp3Path}"`, { stdio: "ignore" });
  execSync(`ffmpeg -y -i "${rawWavPath}" -codec:a aac -b:a 128k "${m4aPath}"`, { stdio: "ignore" });
  execSync(`ffmpeg -y -i "${rawWavPath}" -codec:a pcm_s16le "${wavPath}"`, { stdio: "ignore" });
  console.log("   -> sample_meeting.mp3, sample_meeting.m4a, sample_meeting.wav 생성 완료");

  console.log("3. 말소리 없는 파일(silent.mp3) 및 손상된 파일(corrupted.mp3) 생성...");
  execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 10 -codec:a libmp3lame -q:a 4 "${silentPath}"`, { stdio: "ignore" });
  fs.writeFileSync(corruptPath, "This is not an audio file but corrupted raw text data.", "utf-8");
  console.log("   -> silent.mp3, corrupted.mp3 생성 완료");

  // Create ground truth json
  const groundTruth = {
    script: scriptText,
    title: "신규 기능 출시 회의",
    attendees: ["김민수", "이지은", "화자3"],
    decisions: [
      { text: "출시일을 10월 15일로 확정한다", keywords: ["출시일", "10월 15일", "확정"] },
    ],
    todos: [
      { task: "마케팅 공지 초안 준비", owner: "이지은", due: "10월 8일" },
      { task: "보고서 정리", owner: "김민수", due: "미정" },
      { task: "테스트 계정 준비", owner: "미정", due: "미정" },
    ],
    maskedPhone: "***",
    note: "단일 합성 음성(Microsoft Heami)으로 생성되었으므로 화자 분리는 단일 화자 음성 특성상 참고용으로만 사용됨.",
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "ground-truth.json"),
    JSON.stringify(groundTruth, null, 2),
    "utf-8",
  );
  console.log("   -> ground-truth.json 정답표 생성 완료");

  console.log("=== 모든 테스트 오디오 생성 완료 ===");
} catch (err) {
  console.error("오디오 변환 실패:", err);
  process.exit(1);
}
