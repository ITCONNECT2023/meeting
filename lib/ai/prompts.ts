/**
 * Prompt templates and schemas for Gemini AI processing
 * Reference: docs/03_TRD.md Section 2 & 3, docs/04_개발계획.md 5-1~5-4
 */

export function buildDiarizationPrompt(attendees?: string[]): string {
  const attendeeList =
    attendees && attendees.length > 0
      ? attendees.map((a) => `- ${a}`).join("\n")
      : "(입력된 참석자 없음)";

  return `당신은 회의 녹음의 화자 분리 전문가입니다.
녹음을 듣고 고유한 목소리마다 고유한 화자 식별자(화자1, 화자2, ...)를 부여하세요.

입력된 참석자 후보 명단:
${attendeeList}

규칙:
1. 녹음 속에서 서로 다른 사람의 이름을 부르거나 자기소개를 하는 등 발언과 호칭이 확실하게 일치하는 경우에만 화자 식별자를 실제 참석자 이름으로 연결하세요.
2. 조금이라도 불확실하거나 이름이 언급되지 않은 목소리는 절대로 추측하지 말고 '화자N'(예: 화자1, 화자2)으로 유지하세요.
3. 결과는 JSON 객체 형식으로만 응답하세요:
{
  "speakers": [
    { "id": "화자1", "name": "김민수", "confidence": "high" },
    { "id": "화자2", "name": "화자2", "confidence": "uncertain" }
  ]
}`;
}

export function buildTranscriptionPrompt(speakerContext?: string): string {
  const contextNote = speakerContext
    ? `\n참고 화자 정보:\n${speakerContext}\n`
    : "";

  return `당신은 전문 회의 속기사입니다.
제공된 녹음 구간의 모든 발언을 정확하게 받아쓰세요.
${contextNote}
작성 규칙:
1. 발언마다 시작 시각을 [mm:ss] 또는 [h:mm:ss] 형식으로 표기하고, 화자 이름과 발언 내용을 적으세요.
   형식 예시: [00:07] 이지은: 네, 개발 쪽 일정부터 공유드릴게요.
2. 모든 숫자는 반드시 아라비아 숫자(0, 1, 2, ..., 10월 15일, 5일, 010-1234-5678, 100,000원)로 적으세요.
3. 발언 순서는 시간 순서대로 앞으로만 흘러야 합니다.
4. 녹음에 사람의 말소리가 전혀 없거나 식별 가능한 발언이 하나도 없다면 정확히 "NO_SPEECH"라고만 출력하세요.
5. 불필요한 서문이나 설명 없이 스크립트 줄만 한 줄에 하나씩 출력하세요.`;
}

export interface MinutesPromptInput {
  title?: string;
  attendees?: string[];
  numberedScript: string;
}

export function buildMinutesPrompt(input: MinutesPromptInput): string {
  const titleHint = input.title ? `입력된 회의 제목: ${input.title}` : `회의 제목: (녹음 내용으로 적절한 제목 생성 필요)`;
  const attendeesHint = input.attendees && input.attendees.length > 0
    ? `입력된 참석자: ${input.attendees.join(", ")}`
    : `입력된 참석자: 없음`;

  return `당신은 최고 수준의 회의록 작성 전문가입니다.
아래에 줄 번호가 매겨진 회의 스크립트가 제공됩니다.
스크립트의 내용에 근거하여 회의록 요약, 결정사항, 할 일을 작성하세요.

${titleHint}
${attendeesHint}

스크립트:
${input.numberedScript}

작성 규칙:
1. [제목]: 입력된 제목이 있으면 사용하고, 없으면 회의 주제를 명확하고 간결하게 나타내는 제목을 만드세요.
2. [요약]: 회의에서 논의된 핵심 내용만 간결한 문장들의 배열로 작성하세요. 요약에는 타임스탬프나 줄 번호를 붙이지 마세요.
3. [결정사항]: 회의에서 합의되거나 확정된 사항만 작성하세요. 각 결정사항마다 반드시 근거가 되는 스크립트의 줄 번호(정수, 예: L0012이면 12)를 'line' 필드에 기재하세요. 합의된 결정사항이 없다면 빈 배열([])로 두세요.
4. [할 일]: 회의 중 특정인에게 부여되거나 실행하기로 한 작업만 작성하세요.
   - task: 할 일 내용
   - owner: 담당자 이름. 녹음에서 명확히 언급되지 않았으면 반드시 "미정"으로 표기하세요.
   - due: 완료 기한. 녹음에서 명확히 언급되지 않았으면 반드시 "미정"으로 표기하세요. 절대로 임의로 날짜를 지어내거나 추측하지 마세요!
   - line: 할 일이 언급되거나 부여된 근거 스크립트의 줄 번호(정수, 예: L0035이면 35).
   - 할 일이 없다면 빈 배열([])로 두세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "title": "회의 제목",
  "summary": [
    "요약 문장 1",
    "요약 문장 2"
  ],
  "decisions": [
    { "text": "결정사항 문장", "line": 4 }
  ],
  "todos": [
    { "task": "할 일 문장", "owner": "이지은", "due": "10월 8일", "line": 12 },
    { "task": "보고서 정리", "owner": "김민수", "due": "미정", "line": 15 },
    { "task": "테스트 계정 준비", "owner": "미정", "due": "미정", "line": 18 }
  ]
}`;
}
