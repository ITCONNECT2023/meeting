// EPIC 2-2: reads what music-metadata can tell us about a picked recording
// before it is uploaded.
//
// - F1's "녹음 길이는 고를 때 알 수 있으면 그때 검사" needs the duration.
// - F2's "일시가 비면 파일에 담긴 녹음 시각을 쓰고" fallback needs a
//   recorded time out of the file's tags.
//
// This runs in the browser inside FilePicker; bundlers (webpack/Turbopack,
// via Next) resolve music-metadata's "default" export condition
// (lib/core.js), which is its browser-safe entry built on Blob/Web Streams
// rather than Node's fs. The same code also runs directly under Node in
// tests (Node has a global Blob/File), exercising the real parser.

import { parseBlob } from "music-metadata";

export interface AudioMetadataResult {
  /** Recording length in seconds, or null when it couldn't be read (FRD:
   * checked later, during processing, in that case). */
  durationSec: number | null;
  /** Recording time embedded in the file's tags, as a value shaped like
   * `<input type="datetime-local">` (`YYYY-MM-DDTHH:MM`), local time, or
   * null when no usable one was found. */
  recordedAt: string | null;
}

/** music-metadata's own duration/date fields, factored out so
 * {@link pickRecordedAt} is pure and unit-testable without a real file. */
export interface RecordedAtFormatInput {
  creationTime?: Date | null;
}
export interface RecordedAtCommonInput {
  date?: string | null;
}

// MP4/m4a containers that never had a creation time often carry the format's
// epoch zero instead (1904-01-01, QuickTime's epoch), which reads as a
// valid-but-wrong Date. Treat anything before 2000 as absent.
const MIN_PLAUSIBLE_YEAR = 2000;
// Clock skew / timezone slop; a tag legitimately "in the future" by more
// than this is more likely bogus than a recording made ahead of now.
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Formats a Date as local-time `YYYY-MM-DDTHH:MM` (same shape the
 * `<input type="datetime-local">` element produces/consumes). */
function toLocalDatetimeValue(date: Date): string {
  const y = date.getFullYear();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

function isPlausible(date: Date, now: Date): boolean {
  if (Number.isNaN(date.getTime())) return false;
  if (date.getFullYear() < MIN_PLAUSIBLE_YEAR) return false;
  if (date.getTime() - now.getTime() > FUTURE_SLACK_MS) return false;
  return true;
}

/**
 * Parses a `common.date` tag value into a Date, or null when the tag has
 * no time-of-day component at all (e.g. a bare "2026-09-22" release-date
 * tag) — kept simple per spec: a date-only tag can't fill a datetime-local
 * field, which needs both parts, so it is treated the same as "no tag".
 * Also null for anything Date can't parse.
 */
function parseTagDateWithTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed.includes(":")) return null; // no time-of-day in the tag
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Picks the recording time to fall back to when 일시 is left blank.
 * Prefers `format.creationTime` (MP4/m4a container atom, a Date), else
 * `common.date` (a free-form tag string). Invalid, pre-2000 (see
 * MIN_PLAUSIBLE_YEAR above) and more-than-a-day-in-the-future values are
 * ignored on both. Exported and pure so it can be unit tested without
 * parsing a real audio file.
 */
export function pickRecordedAt(
  format: RecordedAtFormatInput,
  common: RecordedAtCommonInput,
  now: Date = new Date(),
): string | null {
  if (format.creationTime && isPlausible(format.creationTime, now)) {
    return toLocalDatetimeValue(format.creationTime);
  }
  if (common.date) {
    const parsed = parseTagDateWithTime(common.date);
    if (parsed && isPlausible(parsed, now)) {
      return toLocalDatetimeValue(parsed);
    }
  }
  return null;
}

/**
 * Reads duration + recorded-at out of a picked recording. Never throws:
 * any parse failure (corrupt file, unsupported container, garbage bytes)
 * resolves to `{ durationSec: null, recordedAt: null }` so the caller can
 * treat "unknown" uniformly (FRD: an unknown length is only checked later,
 * during processing).
 */
export async function readAudioMetadata(
  file: Blob,
): Promise<AudioMetadataResult> {
  try {
    const metadata = await parseBlob(file, { skipCovers: true });
    const rawDuration = metadata.format.duration;
    const durationSec =
      typeof rawDuration === "number" && !Number.isNaN(rawDuration)
        ? rawDuration
        : null;
    const recordedAt = pickRecordedAt(
      { creationTime: metadata.format.creationTime },
      { date: metadata.common.date },
    );
    return { durationSec, recordedAt };
  } catch {
    return { durationSec: null, recordedAt: null };
  }
}
