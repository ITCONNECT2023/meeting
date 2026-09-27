import { parseTimestamp } from "../minutes/timestamp.ts";
import type { MeetingMinutes, ScriptLine } from "../minutes/types.ts";

export interface ValidateTranscriptResult {
  valid: boolean;
  reason?: "NO_SPEECH" | "TIMESTAMP_REVERSED" | "OUT_OF_BOUNDS" | "EXCEEDS_DURATION" | "INVALID_FORMAT";
}

export function validateTranscript(
  script: ScriptLine[],
  chunkStartSec: number,
  chunkEndSec: number,
  totalDurationSec?: number,
): ValidateTranscriptResult {
  if (!script || script.length === 0) {
    return { valid: false, reason: "NO_SPEECH" };
  }

  let prevSec = -1;
  const marginSec = 5;

  for (const line of script) {
    const parsed = parseTimestamp(line.ts);
    if (!parsed) {
      return { valid: false, reason: "INVALID_FORMAT" };
    }
    const sec = parsed.seconds;

    // Out of chunk bounds check
    if (sec < chunkStartSec - marginSec || sec > chunkEndSec + marginSec) {
      return { valid: false, reason: "OUT_OF_BOUNDS" };
    }

    // Exceeds total audio duration check
    if (totalDurationSec !== undefined && sec > totalDurationSec + marginSec) {
      return { valid: false, reason: "EXCEEDS_DURATION" };
    }

    // Reverse flow check
    if (sec < prevSec) {
      return { valid: false, reason: "TIMESTAMP_REVERSED" };
    }

    prevSec = sec;
  }

  return { valid: true };
}

export interface LineItem {
  line?: number;
  ts?: string;
  [key: string]: unknown;
}

export function convertLineNumbersToTimestamps<T extends LineItem>(
  items: T[],
  script: ScriptLine[],
): { valid: boolean; items: (Omit<T, "line"> & { ts?: string })[] } {
  if (!items || items.length === 0) {
    return { valid: true, items: [] };
  }

  const converted: (Omit<T, "line"> & { ts?: string })[] = [];

  for (const item of items) {
    const { line, ...rest } = item;
    if (typeof line !== "number" || line < 1 || line > script.length) {
      return { valid: false, items: [] };
    }
    const targetLine = script[line - 1];
    converted.push({
      ...rest,
      ts: targetLine.ts,
    });
  }

  return { valid: true, items: converted };
}

export interface MinutesInputInfo {
  title?: string;
  date?: string;
  attendees?: string[];
  recordedAt?: string;
}

export function fillMinutesDefaults(
  rawMinutes: Partial<MeetingMinutes>,
  inputInfo: MinutesInputInfo,
): MeetingMinutes {
  // Title: input -> raw -> fallback
  const title = inputInfo.title?.trim() || rawMinutes.title?.trim() || "회의록";

  // Date: input -> recordedAt -> '미정'
  let date = "미정";
  if (inputInfo.date?.trim()) {
    date = inputInfo.date.trim().replace("T", " ");
  } else if (inputInfo.recordedAt) {
    const trimmed = inputInfo.recordedAt.trim();
    if (trimmed) {
      date = trimmed.replace("T", " ");
    }
  }

  // Attendees: input first, then add unique speakers from script
  const attendees: string[] = [];
  if (inputInfo.attendees && inputInfo.attendees.length > 0) {
    for (const a of inputInfo.attendees) {
      const clean = a.trim();
      if (clean && !attendees.includes(clean)) {
        attendees.push(clean);
      }
    }
  }

  if (rawMinutes.script && rawMinutes.script.length > 0) {
    for (const line of rawMinutes.script) {
      const spk = line.speaker?.trim();
      if (spk && !attendees.includes(spk)) {
        attendees.push(spk);
      }
    }
  }

  if (attendees.length === 0) {
    attendees.push("미정");
  }

  return {
    title,
    date,
    attendees,
    summary: rawMinutes.summary || [],
    decisions: rawMinutes.decisions || [],
    todos: rawMinutes.todos || [],
    script: rawMinutes.script || [],
  };
}
