"use client";

import { useEffect, type ReactNode } from "react";

import { CloseIcon } from "@/components/icons";

import styles from "./Toast.module.css";

export type ToastProps = {
  open: boolean;
  onClose: () => void;
  /** Decorative leading icon (e.g. the download icon in
   * design/01_PC.html:598). Omit for a plain text-only toast. */
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** Auto-dismiss after this many ms. Omit to require an explicit close. */
  autoHideMs?: number;
};

/**
 * Toast (EPIC 2): the dark bottom-center status bar from the mockups —
 * e.g. the "시안이라 실제 파일은 만들어지지 않습니다" download notice.
 * Plain conditional rendering (no native `<dialog>`/portal): it's
 * non-modal and never traps focus, so nothing platform-specific is
 * needed the way Dialog needs `showModal()`.
 */
export function Toast({ open, onClose, icon, title, detail, autoHideMs }: ToastProps) {
  useEffect(() => {
    if (!open || autoHideMs === undefined) return;
    const id = window.setTimeout(onClose, autoHideMs);
    return () => window.clearTimeout(id);
  }, [open, autoHideMs, onClose]);

  if (!open) return null;

  return (
    <div role="status" className={styles.toast}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <div className={styles.body}>
        <span className={styles.title}>{title}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
      <button
        type="button"
        aria-label="알림 닫기"
        onClick={onClose}
        className={styles.closeButton}
      >
        <CloseIcon size={18} strokeWidth={2} />
      </button>
    </div>
  );
}
