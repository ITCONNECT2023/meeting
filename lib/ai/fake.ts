import type { MeetingMinutes, ScriptLine } from "@/lib/minutes/types";

export interface TranscribeInput {
  filePath: string;
  fileName: string;
  attendees?: string[];
}

export interface TranscribeOutput {
  script: ScriptLine[];
  durationSeconds: number;
}

export interface WriteMinutesInput {
  script: ScriptLine[];
  title?: string;
  date?: string;
  attendees?: string[];
  fileName?: string;
}

export interface WriteMinutesOutput {
  minutes: MeetingMinutes;
}

export const FAKE_EXAMPLE_SCRIPT: ScriptLine[] = [
  { ts: "00:00", speaker: "김민수", text: "시작하겠습니다. 오늘은 출시 일정 얘기부터 하죠." },
  { ts: "00:07", speaker: "이지은", text: "네, 개발 쪽 일정부터 공유드릴게요." },
  { ts: "00:15", speaker: "화자3", text: "개발은 10월 첫 주 안에 마무리될 것 같습니다." },
  { ts: "12:20", speaker: "이지은", text: "그때 개발이 끝나면 QA를 거쳐도 15일 출시는 가능해 보여요." },
  { ts: "12:34", speaker: "김민수", text: "그럼 출시일은 10월 15일로 확정하겠습니다." },
  { ts: "17:48", speaker: "화자3", text: "QA는 5일 정도면 충분할 것 같습니다." },
  { ts: "18:02", speaker: "김민수", text: "좋습니다. QA 기간은 5일로 하죠." },
  { ts: "19:30", speaker: "이지은", text: "마케팅 자료는 출시 1주 전까지 준비해 두겠습니다." },
  { ts: "21:45", speaker: "김민수", text: "출시 공지 초안은 지은 님이 10월 8일까지 부탁드려요." },
  { ts: "21:52", speaker: "이지은", text: "네, 8일까지 드릴게요." },
  { ts: "23:10", speaker: "김민수", text: "보고서 정리는 제가 맡겠습니다." },
  { ts: "25:31", speaker: "이지은", text: "테스트 계정도 누군가 준비해야 할 것 같은데요." },
  { ts: "25:38", speaker: "김민수", text: "문의사항은 010-1234-5678로 연락 주세요. 오늘은 여기까지 하겠습니다." },
];

export async function fakeTranscribe(input: TranscribeInput): Promise<TranscribeOutput> {
  if (input.fileName.includes("_fail")) {
    const error = new Error("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    (error as { code?: string }).code = "TRANSCRIBE_FAILED";
    throw error;
  }

  // Return the standard example script
  return {
    script: [...FAKE_EXAMPLE_SCRIPT],
    durationSeconds: 1545, // ~25:45
  };
}

export async function fakeWriteMinutes(input: WriteMinutesInput): Promise<WriteMinutesOutput> {
  const title = input.title?.trim() || "신규 기능 출시 일정 회의";
  const date = input.date?.trim() || "2026-09-22 14:00";
  const attendees = input.attendees && input.attendees.length > 0
    ? [...input.attendees]
    : ["김민수", "이지은", "화자3"];

  // Ensure "화자3" is included if not in input attendees for matching PRD 5-1
  if (!attendees.includes("화자3") && !input.attendees) {
    attendees.push("화자3");
  }

  const minutes: MeetingMinutes = {
    title,
    date,
    attendees,
    summary: [
      "신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.",
      "마케팅 자료는 출시 1주 전까지 준비하기로 했다.",
    ],
    decisions: [
      { text: "출시일을 10월 15일로 확정한다.", ts: "12:34" },
      { text: "QA 기간은 5일로 한다.", ts: "18:02" },
    ],
    todos: [
      { task: "출시 공지 초안 작성", owner: "이지은", due: "10월 8일", ts: "21:45" },
      { task: "보고서 정리", owner: "김민수", due: "미정", ts: "23:10" },
      { task: "테스트 계정 준비", owner: "미정", due: "미정", ts: "25:31" },
    ],
    script: input.script && input.script.length > 0 ? input.script : [...FAKE_EXAMPLE_SCRIPT],
  };

  return { minutes };
}
