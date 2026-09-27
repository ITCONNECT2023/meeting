// EPIC 2-3 / FRD F2, F3: pure chip-commit logic, no React.
//
// Both "참석자 이름" and "받는 메일 주소" chip fields share this module. The
// actual name-dedup and email-format rules live outside this file (email
// rules in lib/validation/input.ts, owned by another agent) — this module
// only knows the generic "split on commas, commit segments, stop on the
// first error" shape described by the `check` callback contract below.

/** What `check(value, items)` reports back for one candidate segment. */
export type ChipCheckResult =
  | { ok: true; value: string }
  /** Blank segment (e.g. from "a,,b" or an all-whitespace draft) — skipped,
   * no chip added, no error shown. */
  | { ok: false; reason: "empty" }
  /** Already in `items` — FRD F2/F3: re-adding an existing name/address just
   * clears the input, no chip added, no error shown. */
  | { ok: false; reason: "duplicate-silent" }
  /** Any other rejection (format, count limit, ...) — shown to the user. */
  | { ok: false; message: string };

export type ChipCheck = (value: string, items: string[]) => ChipCheckResult;

export type ChipCommitResult = {
  items: string[];
  draft: string;
  error: string | null;
};

/**
 * Splits a raw draft on commas (typed one at a time, pasted in bulk, or
 * ending in a trailing comma).
 *
 * Every piece is trimmed. The last piece — the text after the final comma,
 * or the whole trimmed string when there is no comma at all — is the
 * "tail": text the user hasn't finished (no comma follows it yet), so it is
 * never committed on its own. Everything before it is a "complete segment".
 *
 * A trailing comma (`"a, b,"`) makes every piece complete, since nothing
 * follows the last comma: segments = ["a", "b"], tail = "".
 *
 * This intentionally does not drop blank pieces (e.g. from "a,,b" or a
 * leading comma) — that call belongs to `check`'s "empty" reason, not to
 * parsing.
 */
export function splitDraft(raw: string): { segments: string[]; tail: string } {
  const parts = raw.split(",").map((part) => part.trim());
  return { segments: parts.slice(0, -1), tail: parts[parts.length - 1] };
}

/**
 * Commits as many complete segments of `raw` as `check` accepts, in order.
 *
 * - An "ok" segment is appended to the (copied) item list, using `check`'s
 *   returned `value` (not necessarily the raw segment text — e.g. a
 *   trimmed/normalized form).
 * - "empty" and "duplicate-silent" segments are dropped silently and
 *   processing continues with the next segment.
 * - The first segment that fails with a `message` stops processing: that
 *   segment, every segment after it, and the tail are put back into the
 *   returned `draft` (comma-joined) so the user can see and fix it, and
 *   `error` is set to that message.
 * - If every segment commits (or there were none), `draft` is just the
 *   tail and `error` is null.
 *
 * `check`'s `items` argument grows as segments commit within this same
 * call, so pasting "a@x.com, a@x.com" catches the second one as a
 * duplicate too, not just repeats across separate calls.
 *
 * To force the tail itself to be committed (used for Enter / 「추가」, as
 * opposed to a comma typed mid-draft, which must only commit what's
 * already complete and leave the tail as-is) callers pass `raw + ","` —
 * see ChipInput.tsx's commitNow().
 */
export function commit(
  raw: string,
  items: string[],
  check: ChipCheck,
): ChipCommitResult {
  const { segments, tail } = splitDraft(raw);
  const nextItems = items.slice();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const result = check(segment, nextItems);
    if (result.ok) {
      nextItems.push(result.value);
      continue;
    }
    if ("reason" in result) {
      continue; // "empty" / "duplicate-silent": skip, no error.
    }
    const remaining = [segment, ...segments.slice(i + 1)];
    if (tail !== "") remaining.push(tail);
    return { items: nextItems, draft: remaining.join(", "), error: result.message };
  }

  return { items: nextItems, draft: tail, error: null };
}
