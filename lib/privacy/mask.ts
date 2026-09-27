import type {
  MeetingMinutes,
  ScriptLine,
  DecisionItem,
  TodoItem,
} from "@/lib/minutes/types";

/**
 * Privacy Masking Utilities (FRD F12, 3-2)
 *
 * Masks 4 types of sensitive numbers with `***`:
 * 1. Resident registration numbers (주민등록번호)
 * 2. Phone numbers (휴대전화·일반전화·대표번호)
 * 3. Bank account numbers (계좌번호)
 * 4. Credit/debit card numbers (카드번호)
 *
 * Crucial rule: Dates (YYYY-MM-DD, 10월 15일), times/timestamps (14:00, [12:34]),
 * amounts (100,000원), and general counts/versions MUST NOT be masked.
 */

// 1. Credit/Debit Card: 4-4-4-4 or 4-6-5 (15 or 16 digits)
const CARD_REGEX = /\b(?:\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3,4}|\d{4}[-\s]\d{6}[-\s]\d{5})\b/g;

// 2. Resident Registration Number (RRN): 6 digits - 7 digits
const RRN_REGEX = /\b\d{6}[-\s][1-8]\d{6}\b/g;

// 3. Phone Numbers:
// - Mobile: 010, 011, 016, 017, 018, 019
// - Landline: 02 (Seoul), 031-064 (Regional)
// - Internet/Virtual: 070, 050x
// - Customer centers: 15xx, 16xx, 18xx
const PHONE_REGEX = /\b(?:01[016789][-\s]\d{3,4}[-\s]\d{4}|02[-\s]\d{3,4}[-\s]\d{4}|(?:0[3-6][1-5]|070|050\d)[-\s]\d{3,4}[-\s]\d{4}|(?:15\d{2}|16\d{2}|18\d{2})[-\s]\d{4})\b/g;

// 4. Bank Account Number: 3 or 4 segments of numbers separated by hyphens
// Must have total digits between 10 and 16, and NOT be a date (YYYY-MM-DD)
const ACCOUNT_REGEX = /\b\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{1,5})?\b/g;

// Date patterns that must NEVER be masked
const DATE_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function maskString(text: string): { masked: string; count: number } {
  if (!text || typeof text !== "string") {
    return { masked: text || "", count: 0 };
  }

  let count = 0;
  let result = text;

  // Mask 1: Card numbers
  result = result.replace(CARD_REGEX, () => {
    count++;
    return "***";
  });

  // Mask 2: Resident Registration Numbers
  result = result.replace(RRN_REGEX, () => {
    count++;
    return "***";
  });

  // Mask 3: Phone numbers
  result = result.replace(PHONE_REGEX, () => {
    count++;
    return "***";
  });

  // Mask 4: Bank account numbers (excluding dates and checking length)
  result = result.replace(ACCOUNT_REGEX, (match) => {
    if (DATE_YMD_REGEX.test(match)) {
      return match;
    }
    const digitsOnly = match.replace(/\D/g, "");
    if (digitsOnly.length >= 10 && digitsOnly.length <= 16) {
      count++;
      return "***";
    }
    return match;
  });

  return { masked: result, count };
}

export function maskScript(script: ScriptLine[]): {
  script: ScriptLine[];
  count: number;
} {
  let totalCount = 0;
  const maskedScript = script.map((line) => {
    const { masked, count } = maskString(line.text);
    totalCount += count;
    return {
      ...line,
      text: masked,
    };
  });
  return { script: maskedScript, count: totalCount };
}

export function maskMinutes(minutes: MeetingMinutes): {
  minutes: MeetingMinutes;
  count: number;
} {
  let totalCount = 0;

  // Title: usually not sensitive, but mask just in case
  const { masked: maskedTitle, count: titleCount } = maskString(minutes.title);
  totalCount += titleCount;

  // Summary
  const maskedSummary = minutes.summary.map((s) => {
    const { masked, count } = maskString(s);
    totalCount += count;
    return masked;
  });

  // Decisions
  const maskedDecisions: DecisionItem[] = minutes.decisions.map((d) => {
    const { masked, count } = maskString(d.text);
    totalCount += count;
    return {
      ...d,
      text: masked,
    };
  });

  // Todos
  const maskedTodos: TodoItem[] = minutes.todos.map((t) => {
    const { masked: maskedTask, count: taskCount } = maskString(t.task);
    const { masked: maskedOwner, count: ownerCount } = maskString(t.owner);
    const { masked: maskedDue, count: dueCount } = maskString(t.due);
    totalCount += taskCount + ownerCount + dueCount;
    return {
      ...t,
      task: maskedTask,
      owner: maskedOwner,
      due: maskedDue,
    };
  });

  // Script
  const { script: maskedScript, count: scriptCount } = maskScript(minutes.script || []);
  totalCount += scriptCount;

  const maskedMinutes: MeetingMinutes = {
    ...minutes,
    title: maskedTitle,
    summary: maskedSummary,
    decisions: maskedDecisions,
    todos: maskedTodos,
    script: maskedScript,
  };

  return { minutes: maskedMinutes, count: totalCount };
}
