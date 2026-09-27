// EPIC 2-4 adapters: bridge lib/validation/input's FRD-specific check
// functions (checkNewAttendee / checkNewRecipient) to ChipInput's generic
// ChipCheck contract (components/ChipInput/commit.ts's `check` callback).
// Kept in their own file (rather than inline in useUploadForm.ts) so both
// the hook and any test that wants to exercise the exact adapter used by
// the real screen can import it directly.

import type { ChipCheck, ChipCheckResult } from "@/components/ChipInput/commit";
import { checkNewAttendee, checkNewRecipient } from "@/lib/validation/input";

/**
 * F2: 참석자 이름. A repeat name is silent per FRD ("이미 있는 이름을 다시
 * 추가하면 칩을 더 만들지 않고 입력칸만 비웁니다") — checkNewAttendee's
 * "duplicate" kind carries no message, so it maps to ChipCheck's
 * "duplicate-silent" rather than the `message` branch.
 */
export const attendeeChipCheck: ChipCheck = (value, items): ChipCheckResult => {
  const result = checkNewAttendee(value, items);
  switch (result.kind) {
    case "empty":
      return { ok: false, reason: "empty" };
    case "duplicate":
      return { ok: false, reason: "duplicate-silent" };
    case "ok":
      return { ok: true, value: result.value };
  }
};

/**
 * F3: 받는 메일 주소. Unlike attendees, a repeated address IS an error
 * ("이미 추가한 주소입니다.") shown on the field, so "duplicate" (like
 * "invalid" and "limit") goes through ChipCheck's `message` branch instead
 * of "duplicate-silent".
 */
export const recipientChipCheck: ChipCheck = (value, items): ChipCheckResult => {
  const result = checkNewRecipient(value, items);
  switch (result.kind) {
    case "empty":
      return { ok: false, reason: "empty" };
    case "invalid":
    case "duplicate":
    case "limit":
      return { ok: false, message: result.message };
    case "ok":
      return { ok: true, value: result.value };
  }
};
