import type { DecisionItem, MeetingMinutes, TodoItem } from "./types";
import { formatTimestamp, parseTimestamp } from "./timestamp";
import { maskMinutes } from "../privacy/mask";

export interface MetaEditData {
  title?: string;
  date?: string;
  attendees?: string | string[];
}

export type SummaryEditData = string[];

export interface DecisionEditItem {
  text: string;
  ts?: string;
}

export interface TodoEditItem {
  task: string;
  owner?: string;
  due?: string;
  ts?: string;
}

export type ApplyEditSuccess = {
  ok: true;
  minutes: MeetingMinutes;
  maskedCountAdded: number;
};

export type ApplyEditFailure = {
  ok: false;
  error: string;
  message: string;
  field?: string;
  index?: number;
};

export type ApplyEditResult = ApplyEditSuccess | ApplyEditFailure;

function markModified(val: string): string {
  const trimmed = val.trim();
  if (trimmed.endsWith("(수정됨)")) return trimmed;
  return `${trimmed} (수정됨)`;
}

export function validateDate(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "미정") {
    return { ok: true, value: "미정" };
  }

  // Without (수정됨) tag if already present
  const baseDate = trimmed.replace(/\s*\(수정됨\)$/, "");
  const match = baseDate.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
  if (!match) {
    return {
      ok: false,
      message: "일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.",
    };
  }

  const [, , moStr, dStr, hStr, miStr] = match;
  const mo = parseInt(moStr, 10);
  const d = parseInt(dStr, 10);

  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    return {
      ok: false,
      message: "일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.",
    };
  }

  if (hStr !== undefined && miStr !== undefined) {
    const h = parseInt(hStr, 10);
    const mi = parseInt(miStr, 10);
    if (h < 0 || h > 23 || mi < 0 || mi > 59) {
      return {
        ok: false,
        message: "일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.",
      };
    }
  }

  return { ok: true, value: trimmed };
}

export function validateCitation(
  raw?: string,
  durationSeconds?: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (!raw || typeof raw !== "string") {
    return { ok: true, value: "근거 없음" };
  }

  const clean = raw.trim().replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "").trim();
  if (!clean || clean === "근거 없음") {
    return { ok: true, value: "근거 없음" };
  }

  const parsed = parseTimestamp(clean);
  if (!parsed) {
    return {
      ok: false,
      message: "근거는 12:34 또는 1:02:03처럼 적어 주세요.",
    };
  }

  if (durationSeconds !== undefined && durationSeconds > 0 && parsed.seconds > durationSeconds) {
    const limitFormatted = formatTimestamp(durationSeconds);
    return {
      ok: false,
      message: `녹음 길이(${limitFormatted})보다 뒤의 위치입니다.`,
    };
  }

  return { ok: true, value: parsed.formatted };
}

export function applyMetaEdits(
  original: MeetingMinutes,
  data: MetaEditData,
): ApplyEditResult {
  let title = original.title;
  if (data.title && data.title.trim()) {
    const newTitle = data.title.trim();
    if (newTitle !== original.title) {
      title = markModified(newTitle);
    } else {
      title = newTitle;
    }
  }

  let date = original.date;
  if (data.date !== undefined) {
    const dateVal = validateDate(data.date);
    if (!dateVal.ok) {
      return {
        ok: false,
        error: "INVALID_DATE",
        message: dateVal.message,
        field: "date",
      };
    }
    const cleanDate = dateVal.value;
    if (cleanDate !== original.date) {
      date = cleanDate === "미정" ? "미정" : markModified(cleanDate);
    } else {
      date = cleanDate;
    }
  }

  let attendees: string[] = original.attendees || [];
  if (data.attendees !== undefined) {
    let parsedAttendees: string[] = [];
    if (typeof data.attendees === "string") {
      parsedAttendees = data.attendees
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (Array.isArray(data.attendees)) {
      parsedAttendees = data.attendees.map((s) => s.trim()).filter(Boolean);
    }

    if (parsedAttendees.length === 0) {
      attendees = ["미정"];
    } else {
      const origJoined = (original.attendees || []).join(", ");
      const newJoined = parsedAttendees.join(", ");
      if (newJoined !== origJoined) {
        // Mark the last attendee with (수정됨) to mark the line
        const lastIdx = parsedAttendees.length - 1;
        parsedAttendees[lastIdx] = markModified(parsedAttendees[lastIdx]);
      }
      attendees = parsedAttendees;
    }
  }

  const updated: MeetingMinutes = {
    ...original,
    title,
    date,
    attendees,
  };

  const { minutes: masked, count: maskedCountAdded } = maskMinutes(updated);
  return { ok: true, minutes: masked, maskedCountAdded };
}

export function applySummaryEdits(
  original: MeetingMinutes,
  data: SummaryEditData,
): ApplyEditResult {
  const origSummary = original.summary || [];
  const cleanedLines = data.map((l) => l.trim()).filter(Boolean);

  const updatedSummary = cleanedLines.map((line, idx) => {
    const origLine = origSummary[idx];
    if (!origLine || line !== origLine) {
      return markModified(line);
    }
    return line;
  });

  const updated: MeetingMinutes = {
    ...original,
    summary: updatedSummary,
  };

  const { minutes: masked, count: maskedCountAdded } = maskMinutes(updated);
  return { ok: true, minutes: masked, maskedCountAdded };
}

export function applyDecisionsEdits(
  original: MeetingMinutes,
  data: DecisionEditItem[],
  durationSeconds?: number,
): ApplyEditResult {
  const origDecs = original.decisions || [];
  const updatedDecs: DecisionItem[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const text = item.text.trim();
    if (!text) continue; // discard empty lines

    const citationVal = validateCitation(item.ts, durationSeconds);
    if (!citationVal.ok) {
      return {
        ok: false,
        error: "INVALID_CITATION",
        message: citationVal.message,
        field: "ts",
        index: i,
      };
    }

    const origItem = origDecs[i];
    let finalText = text;
    if (!origItem || origItem.text !== text) {
      finalText = markModified(text);
    }

    updatedDecs.push({
      text: finalText,
      ts: citationVal.value,
    });
  }

  const updated: MeetingMinutes = {
    ...original,
    decisions: updatedDecs,
  };

  const { minutes: masked, count: maskedCountAdded } = maskMinutes(updated);
  return { ok: true, minutes: masked, maskedCountAdded };
}

export function applyTodosEdits(
  original: MeetingMinutes,
  data: TodoEditItem[],
  durationSeconds?: number,
): ApplyEditResult {
  const origTodos = original.todos || [];
  const updatedTodos: TodoItem[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const task = item.task.trim();
    if (!task) continue; // discard empty lines

    const citationVal = validateCitation(item.ts, durationSeconds);
    if (!citationVal.ok) {
      return {
        ok: false,
        error: "INVALID_CITATION",
        message: citationVal.message,
        field: "ts",
        index: i,
      };
    }

    const origItem = origTodos[i];
    let finalTask = task;
    let owner = item.owner?.trim() || "미정";
    let due = item.due?.trim() || "미정";

    if (!origItem) {
      // Entirely new todo item
      finalTask = markModified(task);
    } else {
      if (origItem.task !== task) {
        finalTask = markModified(task);
      }
      if (origItem.owner !== owner && owner !== "미정") {
        owner = markModified(owner);
      }
      if (origItem.due !== due && due !== "미정") {
        due = markModified(due);
      }
    }

    updatedTodos.push({
      task: finalTask,
      owner,
      due,
      ts: citationVal.value,
    });
  }

  const updated: MeetingMinutes = {
    ...original,
    todos: updatedTodos,
  };

  const { minutes: masked, count: maskedCountAdded } = maskMinutes(updated);
  return { ok: true, minutes: masked, maskedCountAdded };
}

export function applyMinutesEdits(
  original: MeetingMinutes,
  section: "meta" | "summary" | "decisions" | "todos",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  durationSeconds?: number,
): ApplyEditResult {
  switch (section) {
    case "meta":
      return applyMetaEdits(original, data as MetaEditData);
    case "summary":
      return applySummaryEdits(original, data as SummaryEditData);
    case "decisions":
      return applyDecisionsEdits(original, data as DecisionEditItem[], durationSeconds);
    case "todos":
      return applyTodosEdits(original, data as TodoEditItem[], durationSeconds);
    default:
      return {
        ok: false,
        error: "INVALID_SECTION",
        message: `알 수 없는 구역입니다: ${section}`,
      };
  }
}
