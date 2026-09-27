// EPIC 2-1: input-validation rules shared by the browser (FilePicker,
// ChipInput, the upload form) and the server (POST /api/jobs in EPIC 3).
// Deliberately free of "server-only" and any Node-only API so both sides
// can import this file unmodified.
//
// FRD refs: F1 (녹음 파일 올리기), F2 (회의 정보 선택 입력),
// F3 (받는 메일 주소 입력), 6장 (오류 상황 모음).
//
// Style note: every "check*" function below returns a discriminated union
// (never throws, never returns a bare string). Ok results carry whatever
// normalized value the caller needs (e.g. the lowercased extension); error
// results carry both a short machine-readable `kind` and the exact
// user-facing `message` from VALIDATION_MESSAGES. The zod schemas further
// down reuse these same functions/messages so the browser and the server
// can never drift apart.

import { z } from "zod";

/** F1: allowed recording formats (extension, lowercase, no dot). */
export const ALLOWED_EXTENSIONS = ["mp3", "m4a", "wav"] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** F1: 200MB file size ceiling. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;

/** F1: 2 hour recording length ceiling, in seconds. */
export const MAX_DURATION_SEC = 2 * 60 * 60;

/** F3: recipient list ceiling. */
export const MAX_RECIPIENTS = 20;

/**
 * F2: meeting title / attendee limits. The FRD does not spell out a
 * message for these (it only says the fields are optional / free text), so
 * the length ceilings and their messages below are this file's own choice,
 * not a copy of FRD wording. They exist so the server schema (used by
 * POST /api/jobs, EPIC 3) has a sane bound.
 */
export const MAX_TITLE_LENGTH = 200;
export const MAX_ATTENDEE_NAME_LENGTH = 50;
export const MAX_ATTENDEES = 50;

/**
 * FRD F1/F3/6장 exact user-facing strings.
 *
 * `fileFormat` is a function because the FRD shows the picked file's own
 * (lowercased) extension inside the parens, e.g. "(.mp4)"; a name with no
 * extension at all drops the parens entirely (see FRD 6장 footnote).
 */
export const VALIDATION_MESSAGES = {
  fileMissing: "녹음 파일을 올려 주세요.",
  fileFormat(ext: string | null): string {
    return ext
      ? `지원하지 않는 형식입니다(.${ext}). mp3, m4a, wav 파일을 올려 주세요.`
      : "지원하지 않는 형식입니다. mp3, m4a, wav 파일을 올려 주세요.";
  },
  fileTooLarge: "파일이 너무 큽니다. 200MB 이하 파일을 올려 주세요.",
  fileTooLong: "녹음이 2시간을 넘습니다. 2시간 이하로 나눠서 올려 주세요.",
  emailFormat: "메일 주소 형식이 아닙니다. 예: name@company.com",
  emailDuplicate: "이미 추가한 주소입니다.",
  recipientsEmpty: "받는 메일 주소를 1개 이상 입력해 주세요.",
  recipientsLimit: "받는 사람은 20명까지 넣을 수 있습니다.",
} as const;

// ---------------------------------------------------------------------------
// Small pure functions the UI calls directly (FilePicker, ChipInput, ...).
// ---------------------------------------------------------------------------

/** Trims and drops trailing commas (typing "a@b.com," should behave like
 * typing "a@b.com" then Enter). Shared by recipient and attendee input. */
function stripTrailingComma(raw: string): string {
  return raw.trim().replace(/,+$/, "").trim();
}

/** Lowercased extension without the dot, or null when the name has none
 * (including a dotfile like ".mp3", which has nothing before the dot). */
function extensionOf(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export type FileCheckResult =
  | { ok: true; ext: AllowedExtension }
  | { ok: false; kind: "format" | "size"; message: string };

/**
 * F1: checks a picked file's name/size. Format is checked before size (a
 * wrong-format 200MB+ file still reports the format error). Does not check
 * length — see {@link checkDurationSec} (duration usually isn't known until
 * the file is parsed).
 */
export function checkPickedFile(file: {
  name: string;
  size: number;
}): FileCheckResult {
  const ext = extensionOf(file.name);
  if (!ext || !isAllowedExtension(ext)) {
    return { ok: false, kind: "format", message: VALIDATION_MESSAGES.fileFormat(ext) };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, kind: "size", message: VALIDATION_MESSAGES.fileTooLarge };
  }
  return { ok: true, ext };
}

export type DurationCheckResult =
  | { ok: true }
  | { ok: false; kind: "duration"; message: string };

/**
 * F1: checks a recording length in seconds. `null`/`undefined`/`NaN` means
 * "unknown" (music-metadata couldn't read it) — the FRD says that case is
 * only checked later, during processing, so it passes here. Exactly 7200s
 * (2 hours) is allowed; 7201s is not.
 */
export function checkDurationSec(
  durationSec: number | null | undefined,
): DurationCheckResult {
  if (durationSec == null || Number.isNaN(durationSec)) return { ok: true };
  if (durationSec > MAX_DURATION_SEC) {
    return { ok: false, kind: "duration", message: VALIDATION_MESSAGES.fileTooLong };
  }
  return { ok: true };
}

const EMAIL_SCHEMA = z.email({ message: VALIDATION_MESSAGES.emailFormat });

function isValidEmail(value: string): boolean {
  return EMAIL_SCHEMA.safeParse(value).success;
}

export type RecipientCheckResult =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "duplicate"; message: string }
  | { kind: "limit"; message: string }
  | { kind: "ok"; value: string };

/**
 * F3: checks a candidate recipient address against the list already added.
 * Order: trim/strip trailing comma -> empty is "nothing to add" -> format
 * -> duplicate (case-insensitive; a duplicate never grows the list, so it
 * is checked before the 20-address ceiling) -> ceiling -> ok.
 */
export function checkNewRecipient(
  raw: string,
  existing: readonly string[],
): RecipientCheckResult {
  const value = stripTrailingComma(raw);
  if (!value) return { kind: "empty" };
  if (!isValidEmail(value)) {
    return { kind: "invalid", message: VALIDATION_MESSAGES.emailFormat };
  }
  const lower = value.toLowerCase();
  if (existing.some((e) => e.trim().toLowerCase() === lower)) {
    return { kind: "duplicate", message: VALIDATION_MESSAGES.emailDuplicate };
  }
  if (existing.length >= MAX_RECIPIENTS) {
    return { kind: "limit", message: VALIDATION_MESSAGES.recipientsLimit };
  }
  return { kind: "ok", value };
}

export type AttendeeCheckResult =
  | { kind: "empty" }
  | { kind: "duplicate" }
  | { kind: "ok"; value: string };

/**
 * F2: checks a candidate attendee name. FRD: re-adding an existing name
 * just clears the input with no message, so the "duplicate" result
 * deliberately carries no `message` field (unlike recipients/files).
 * Duplicate comparison is an exact match after trim (case-sensitive), same
 * as recipient names being distinct people rather than normalized
 * addresses.
 */
export function checkNewAttendee(
  raw: string,
  existing: readonly string[],
): AttendeeCheckResult {
  const value = stripTrailingComma(raw);
  if (!value) return { kind: "empty" };
  if (existing.includes(value)) return { kind: "duplicate" };
  return { kind: "ok", value };
}

// ---------------------------------------------------------------------------
// zod schemas for the server side (POST /api/jobs, EPIC 3). Reuse the pure
// functions/messages above so browser and server can't drift apart.
// ---------------------------------------------------------------------------

/**
 * F3 + 6장: the recipients array. Order matches {@link checkNewRecipient}:
 * empty list -> recipientsEmpty, more than 20 -> recipientsLimit, any
 * element not shaped like an address -> emailFormat, any case-insensitive
 * repeat -> emailDuplicate (reported on the later element).
 */
export const RecipientsSchema = z
  .array(z.email({ message: VALIDATION_MESSAGES.emailFormat }))
  .min(1, { message: VALIDATION_MESSAGES.recipientsEmpty })
  .max(MAX_RECIPIENTS, { message: VALIDATION_MESSAGES.recipientsLimit })
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((value, index) => {
      const lower = value.trim().toLowerCase();
      if (seen.has(lower)) {
        ctx.addIssue({
          code: "custom",
          message: VALIDATION_MESSAGES.emailDuplicate,
          path: [index],
        });
      }
      seen.add(lower);
    });
  });

const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * True for a string shaped like `<input type="datetime-local">`'s value
 * (`YYYY-MM-DDTHH:MM`) that also names a real calendar date/time (rejects
 * e.g. "2026-02-30T10:00" even though it matches the pattern).
 */
export function isValidDatetimeLocal(value: string): boolean {
  if (!DATETIME_LOCAL_PATTERN.test(value)) return false;
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute
  );
}

/**
 * FRD 6장's wording for an invalid 일시 is written for the review screen's
 * free-text edit (EPIC 3+), but it is the only FRD string about date
 * format and reads fine here too, so the upload form's schema reuses it
 * rather than inventing new copy.
 */
const MEETING_DATE_MESSAGE =
  "일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.";

const MeetingTitleSchema = z
  .string()
  .trim()
  .max(MAX_TITLE_LENGTH, {
    message: `제목은 ${MAX_TITLE_LENGTH}자 이내로 입력해 주세요.`,
  });

const MeetingDateSchema = z.string().refine(
  (value) => value === "" || isValidDatetimeLocal(value),
  { message: MEETING_DATE_MESSAGE },
);

const AttendeeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_ATTENDEE_NAME_LENGTH, {
    message: `참석자 이름은 ${MAX_ATTENDEE_NAME_LENGTH}자 이내로 입력해 주세요.`,
  });

/** F2: title/date/attendees are all optional; see MAX_TITLE_LENGTH etc.
 * above for why the length ceilings/messages here are not FRD copy. */
export const MeetingInfoSchema = z.object({
  title: MeetingTitleSchema.optional(),
  date: MeetingDateSchema.optional(),
  attendees: z
    .array(AttendeeNameSchema)
    .max(MAX_ATTENDEES, {
      message: `참석자는 ${MAX_ATTENDEES}명까지 넣을 수 있습니다.`,
    })
    .refine((list) => new Set(list).size === list.length, {
      message: "참석자 이름이 중복되었습니다.",
    })
    .optional(),
});

/**
 * F1: a picked file's metadata, validated with the exact same rules (and
 * messages) as {@link checkPickedFile} / {@link checkDurationSec}.
 */
export const AudioFileMetaSchema = z
  .object({
    name: z.string().min(1),
    size: z.number().int().nonnegative(),
    durationSec: z.number().nullable().optional(),
  })
  .superRefine((file, ctx) => {
    const fileCheck = checkPickedFile(file);
    if (!fileCheck.ok) {
      ctx.addIssue({
        code: "custom",
        message: fileCheck.message,
        path: [fileCheck.kind === "format" ? "name" : "size"],
      });
      return; // a format/size problem makes checking length moot
    }
    const durationCheck = checkDurationSec(file.durationSec);
    if (!durationCheck.ok) {
      ctx.addIssue({
        code: "custom",
        message: durationCheck.message,
        path: ["durationSec"],
      });
    }
  });

export const JobModeSchema = z.enum(["a", "b"]);

/** Combined shape for POST /api/jobs (EPIC 3): everything the upload
 * screen collects, re-checked with the same rules the browser used. */
export const JobInputSchema = z.object({
  mode: JobModeSchema,
  audio: AudioFileMetaSchema,
  meetingInfo: MeetingInfoSchema,
  recipients: RecipientsSchema,
});

export type JobMode = z.infer<typeof JobModeSchema>;
export type MeetingInfo = z.infer<typeof MeetingInfoSchema>;
export type AudioFileMeta = z.infer<typeof AudioFileMetaSchema>;
export type RecipientList = z.infer<typeof RecipientsSchema>;
export type JobInput = z.infer<typeof JobInputSchema>;
