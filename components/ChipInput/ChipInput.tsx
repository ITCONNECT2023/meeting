"use client";

import { useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";

import { AlertCircleIcon, CloseIcon } from "@/components/icons";

import { commit, type ChipCheck, type ChipCommitResult } from "./commit";
import styles from "./ChipInput.module.css";

export type { ChipCheck, ChipCheckResult, ChipCommitResult } from "./commit";

export type ChipInputValue = ChipCommitResult;

export type ChipInputProps = {
  /** id of the text `<input>`. The parent renders the visible
   * `<label htmlFor={inputId}>` itself — see `labelSlot` below — since its
   * wording and position differ between fields (참석자 이름 puts it above
   * the chip list; 받는 메일 주소 puts it between the chip list and the
   * input row). */
  inputId: string;
  /** aria-label of the chip `<ul>`, e.g. "입력한 참석자" or "받는 사람". */
  listLabel: string;
  items: string[];
  draft: string;
  error: string | null;
  onChange: (next: ChipInputValue) => void;
  check: ChipCheck;
  placeholder?: string;
  /** "email" adds the email keyboard hint + disables mobile
   * autocapitalize/autocorrect/spellcheck. The input's `type` stays
   * "text" either way — `type="email"` sanitizes the value and fights a
   * controlled input (a half-typed address can be rejected by the browser
   * before onChange even sees it). */
  inputMode?: "text" | "email";
  maxLength?: number;
  /** aria-label for a chip's × button. Defaults to `${item} 빼기`. */
  removeLabel?: (item: string) => string;
  /** id of a hint paragraph the parent renders below the field (merged
   * into the input's aria-describedby alongside the error line). */
  describedBy?: string;
  /** Rendered between the chip list and the input row — e.g. the
   * recipients field's own `<label htmlFor={inputId}>받는 사람 추가</label>`
   * (design/01_PC.html:205). Omit it (and have the parent render its label
   * above `<ChipInput>` instead) for a field like 참석자 이름 where the
   * label sits above the chips. This is the "clean chips/field placement"
   * knob called for in the brief — one component, one slot, rather than
   * two separately-exported sub-components. */
  labelSlot?: ReactNode;
};

function defaultRemoveLabel(item: string): string {
  return `${item} 빼기`;
}

/**
 * Chip input for 참석자 이름 / 받는 메일 주소 (EPIC 2-3, FRD F2/F3).
 *
 * Fully controlled: all state (`items`, `draft`, `error`) lives in the
 * parent and flows back through one `onChange`. This lets the parent
 * auto-commit a leftover draft on submit (FRD: "입력칸에 남아 있는 주소도
 * 자동으로 추가") by calling the same `commit()` this component uses, and
 * lets it tell an empty form apart from one with only draft text typed.
 *
 * ---
 * Korean IME handling (FRD F2 + plan: "김민수 + Enter → 글자가 잘리지 않은
 * 칩 1개"):
 *
 * A `keydown` for Enter fired *while composing* (`isComposing` true, or —
 * some IMEs only set the legacy `keyCode === 229` — that check too) must
 * not commit the half-composed text ("ㅁ" instead of "민수" mid-composition,
 * for instance). So a composing Enter only records "a commit was
 * requested"; it does not read the input's value at all. The actual commit
 * happens on `compositionend`, deferred one tick (`setTimeout(…, 0)`) so it
 * reads the input's *live DOM value* via a ref — by the time our handler
 * runs, the browser has finished writing the fully-composed text into the
 * element, whereas React's own `draft` prop can still be one render behind.
 *
 * Some browsers (macOS Chrome/Safari) additionally fire a *second*,
 * non-composing Enter `keydown` right after `compositionend`. That one is
 * handled the ordinary way — it just calls the same commit path — and is
 * safe by construction: whichever of the two commits runs first empties
 * the input, so the other one commits an empty draft, which `commit()`
 * treats as a no-op (an "empty" segment is dropped without adding a chip
 * or raising an error). No de-duplication flag is needed for that race;
 * only the *first* keydown (the composing one) needs the "don't commit
 * yet, remember to on compositionend" flag.
 *
 * Commas typed on mobile keyboards often arrive as `keyCode === 229` with
 * no usable `key` (the IME swallows them), so they never reach the Enter
 * branch above. They do reach `onChange` as ordinary text, though, so the
 * change handler separately checks: whenever the field is not composing
 * and the new value contains a comma, commit the complete segments and
 * keep the remainder as the draft — the same rule a desktop user gets by
 * typing "a@x.com," one keystroke at a time.
 */
export function ChipInput({
  inputId,
  listLabel,
  items,
  draft,
  error,
  onChange,
  check,
  placeholder,
  inputMode = "text",
  maxLength,
  removeLabel = defaultRemoveLabel,
  describedBy,
  labelSlot,
}: ChipInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const pendingCommitRef = useRef(false);

  // Commits whatever is *currently in the DOM* (never the `draft` prop,
  // which may be stale right after a composition ends). Appending "," is
  // what tells commit() to also commit the tail — the piece after the last
  // comma, which normally stays in the draft until the user signals they
  // are done with it (Enter / 「추가」), unlike a comma typed mid-draft.
  function commitNow() {
    const raw = inputRef.current?.value ?? draft;
    onChange(commit(`${raw},`, items, check));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;
    if (isComposingRef.current) {
      onChange({ items, draft: value, error: null });
      return;
    }
    if (value.includes(",")) {
      onChange(commit(value, items, check));
      return;
    }
    // Plain typing: FRD F3 — the format-error line clears as soon as the
    // user starts typing again.
    onChange({ items, draft: value, error: null });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (composing) {
      // Leave the default alone: the IME needs this Enter to finish the
      // composition, which is what fires compositionend below.
      pendingCommitRef.current = true;
      return;
    }
    event.preventDefault();
    commitNow();
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
  }

  function handleCompositionEnd() {
    isComposingRef.current = false;
    if (!pendingCommitRef.current) return;
    pendingCommitRef.current = false;
    // Defer one tick: right at compositionend some browsers haven't yet
    // settled the input's DOM value to the final composed text.
    window.setTimeout(commitNow, 0);
  }

  function handleRemove(item: string) {
    onChange({ items: items.filter((existing) => existing !== item), draft, error });
  }

  const errorId = `${inputId}-error`;
  const describedByIds =
    [describedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <>
      {items.length > 0 && (
        <ul aria-label={listLabel} className={styles.chipList}>
          {items.map((item) => (
            <li key={item} className={styles.chip}>
              <span className={styles.chipText}>{item}</span>
              <button
                type="button"
                aria-label={removeLabel(item)}
                onClick={() => handleRemove(item)}
                className={styles.chipRemove}
              >
                <CloseIcon size={16} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {labelSlot}

      <div className={styles.fieldRow}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode={inputMode}
          autoCapitalize={inputMode === "email" ? "none" : undefined}
          autoCorrect={inputMode === "email" ? "off" : undefined}
          spellCheck={inputMode === "email" ? false : undefined}
          value={draft}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          className={`${styles.input} ${error ? styles.inputError : ""}`}
        />
        <button type="button" onClick={commitNow} className={styles.addButton}>
          추가
        </button>
      </div>

      {error && (
        <p id={errorId} role="alert" aria-live="polite" className={styles.errorLine}>
          <span className={styles.errorIcon}>
            <AlertCircleIcon size={18} strokeWidth={1.8} />
          </span>
          <span>{error}</span>
        </p>
      )}
    </>
  );
}
