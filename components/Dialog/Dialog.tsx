"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { CloseIcon } from "@/components/icons";

import styles from "./Dialog.module.css";

export type DialogProps = {
  open: boolean;
  /** Called on 「닫기」/× click and on Esc (the native `cancel` event, which
   * is preventDefault'd — see the effect below). React state stays the
   * single source of truth for `open`; this component never closes itself. */
  onClose: () => void;
  title: ReactNode;
  /** Optional slot above the title — e.g. the confirmB badge "바로 보내기
   * · 검토 없이 발송" (design/01_PC.html:629). This component only
   * provides the slot/layout; the badge's own pill styling is the
   * caller's (it can reuse Header's badge look or bring its own). */
  eyebrow?: ReactNode;
  closeLabel?: string;
  /** Body content: paragraphs, lists, a `<DialogActions>` row, etc. Laid
   * out in the same 18px-gap column as the header (FRD 8-3 / plan 2-6). */
  children: ReactNode;
};

/**
 * Dialog (EPIC 2-6, FRD F14 §8-3): a native `<dialog>` driven by
 * `showModal()` / `close()`, so focus trapping, an inert background and
 * Esc-to-cancel all come from the platform instead of being reimplemented.
 *
 * The element is always mounted; `open` toggles it via an effect rather
 * than conditional rendering, since `showModal()`/`close()` are imperative
 * DOM calls a `<dialog>` needs to receive directly.
 *
 * Backdrop clicks do not close it — that's simply the platform default for
 * `<dialog>` (unlike a hand-rolled overlay `<div>`, nothing needs to be
 * suppressed for this).
 *
 * Focus on open: this component does not manage focus itself. `showModal()`
 * runs the platform's own "dialog focusing steps", which focus the first
 * descendant carrying the `autofocus` attribute, so the caller should put
 * `autoFocus` on whichever action is least destructive (e.g. 「머무르기」 /
 * 「주소 고치기」). If no action has it, those steps fall back to focusing
 * the `<dialog>` element itself — still a reasonable default.
 */
export function Dialog({
  open,
  onClose,
  title,
  eyebrow,
  closeLabel = "닫기",
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Esc fires `cancel` (then `close`) on a native <dialog>. Prevent the
    // default so the element doesn't close itself out from under React's
    // `open` state; ask the parent to update state instead, same as a
    // click on the × button.
    function handleCancel(event: Event) {
      event.preventDefault();
      onClose();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} className={styles.dialog}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          {eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className={styles.closeButton}
        >
          <CloseIcon size={20} strokeWidth={1.8} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Actions row: flex row justify-end gap 10px on PC/tablet; a full-width
 * column-reverse stack on mobile (<=599px), so the primary action still
 * ends up on top even though DOM order stays "secondary, then primary". */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

export type ButtonVariant = "secondary" | "primary-dark" | "primary-a" | "primary-b";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  secondary: styles.secondary,
  "primary-dark": styles.primaryDark,
  "primary-a": styles.primaryA,
  "primary-b": styles.primaryB,
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

/** Shared button look for dialog actions: `secondary` (white, outlined —
 * 「취소」/「머무르기」/「주소 고치기」), `primary-dark` (「처음으로」),
 * `primary-a` / `primary-b` (mode-colored — 「보내기」 /
 * 「이 주소로 올리고 보내기」). Defaults to `type="button"` since every
 * dialog action in the mockups is a plain click handler, not a form
 * submit; pass `type="submit"` explicitly if a caller ever needs one. */
export function Button({ variant = "secondary", className, type = "button", ...props }: ButtonProps) {
  const classes = [styles.button, VARIANT_CLASS[variant], className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props} />;
}
