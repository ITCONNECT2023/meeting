export interface DecisionItem {
  text: string;
  ts?: string; // e.g. "12:34" or "1:02:03", or "근거 없음"
}

export interface TodoItem {
  task: string;
  owner: string; // name or "미정"
  due: string; // date/expression or "미정"
  ts?: string; // e.g. "21:45" or "근거 없음"
}

export interface ScriptLine {
  ts: string; // e.g. "00:00"
  speaker: string; // e.g. "김민수" or "화자1"
  text: string;
}

export interface MeetingMinutes {
  title: string;
  date: string; // "YYYY-MM-DD HH:MM", "YYYY-MM-DD", or "미정"
  attendees: string[]; // ["김민수", "이지은", "화자3"] or ["미정"]
  summary: string[]; // summary bullet points, or ["없음"]
  decisions: DecisionItem[]; // or [{ text: "없음" }]
  todos: TodoItem[]; // or [{ task: "없음", owner: "없음", due: "없음" }]
  script: ScriptLine[];
}

export type JobMode = "A" | "B";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export type JobStepName =
  | "upload"
  | "transcribe"
  | "minutes"
  | "send";

export interface StepState {
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  errorMessage?: string;
}

export type RecipientStatus = "pending" | "sent" | "failed";

export interface RecipientResult {
  email: string;
  status: RecipientStatus;
  errorReason?: string; // e.g. "주소를 찾을 수 없음"
}

export interface JobRecord {
  id: string;
  mode: JobMode;
  fileName: string;
  fileSize: number;
  durationSeconds?: number;
  recordedAt?: string;
  createdAt: number;
  updatedAt: number;
  audioDeleted?: boolean;

  // Initial user input
  inputTitle?: string;
  inputDate?: string;
  inputAttendees?: string[];
  recipients: string[];

  // Processing state
  status: "processing" | "review" | "sent" | "failed";
  steps: {
    upload: StepState;
    transcribe: StepState;
    minutes: StepState;
    send?: StepState;
  };
  error?: string;
  errorMessage?: string;

  // Generated / edited minutes
  minutes?: MeetingMinutes;
  // Masked sensitive items count
  maskedCount?: number;

  // Email results (for sent / result screens)
  recipientResults?: RecipientResult[];
  // A send handed (or about to be handed) to Gmail whose outcome hasn't
  // been saved yet. Written before SMTP and cleared together with the
  // results, so if it is still here the previous attempt was interrupted:
  // look for `messageId` in Sent Mail before sending again (EPIC 7-4).
  sendAttempt?: SendAttempt;
  // If client navigated away (sendBeacon for B)
  clientLeft?: boolean;
}

export interface SendAttempt {
  messageId: string;
  recipients: string[];
  startedAt: number;
}
