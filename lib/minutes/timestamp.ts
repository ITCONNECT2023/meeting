/**
 * Timestamp parsing and formatting utilities
 * Handles [mm:ss] and [h:mm:ss] formats.
 */

export interface ParsedTimestamp {
  seconds: number;
  formatted: string;
  withBrackets: string;
}

export function parseTimestamp(raw: string): ParsedTimestamp | null {
  if (!raw || typeof raw !== "string") return null;

  // Strip backticks, brackets, whitespace
  const clean = raw.trim().replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");

  // Match mm:ss or h:mm:ss
  const parts = clean.split(":");
  if (parts.length === 2) {
    const [mStr, sStr] = parts;
    if (!/^\d+$/.test(mStr) || !/^\d{2}$/.test(sStr)) return null;
    const m = parseInt(mStr, 10);
    const s = parseInt(sStr, 10);
    if (s < 0 || s >= 60 || m < 0) return null;

    const totalSeconds = m * 60 + s;
    const formatted = formatTimestamp(totalSeconds);
    return {
      seconds: totalSeconds,
      formatted,
      withBrackets: `[${formatted}]`,
    };
  }

  if (parts.length === 3) {
    const [hStr, mStr, sStr] = parts;
    if (!/^\d+$/.test(hStr) || !/^\d{2}$/.test(mStr) || !/^\d{2}$/.test(sStr)) {
      return null;
    }
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const s = parseInt(sStr, 10);
    if (h < 0 || m < 0 || m >= 60 || s < 0 || s >= 60) return null;

    const totalSeconds = h * 3600 + m * 60 + s;
    const formatted = formatTimestamp(totalSeconds);
    return {
      seconds: totalSeconds,
      formatted,
      withBrackets: `[${formatted}]`,
    };
  }

  return null;
}

export function formatTimestamp(
  seconds: number,
  options?: { withBrackets?: boolean; forceHours?: boolean }
): string {
  if (seconds < 0 || isNaN(seconds)) {
    return options?.withBrackets ? "[00:00]" : "00:00";
  }

  const sec = Math.floor(seconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remainSec = sec % 60;

  let formatted: string;
  if (hours > 0 || options?.forceHours) {
    formatted = `${hours}:${String(minutes).padStart(2, "0")}:${String(remainSec).padStart(2, "0")}`;
  } else {
    formatted = `${String(minutes).padStart(2, "0")}:${String(remainSec).padStart(2, "0")}`;
  }

  return options?.withBrackets ? `[${formatted}]` : formatted;
}

export function isValidTimestamp(raw: string, maxSeconds?: number): boolean {
  const parsed = parseTimestamp(raw);
  if (!parsed) return false;
  if (maxSeconds !== undefined && parsed.seconds > maxSeconds) {
    return false;
  }
  return true;
}
