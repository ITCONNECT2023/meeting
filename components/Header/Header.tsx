import Link from "next/link";

import { BrandMarkIcon, HouseIcon, ReviewModeIcon, SendModeIcon } from "@/components/icons";

import styles from "./Header.module.css";

export type HeaderMode = "a" | "b";

type HeaderProps = {
  /** Mode badge to show. Omit on the home screen (FRD: badge shows on
   * every screen except home). */
  mode?: HeaderMode;
  /** 「처음으로」 button. Omit on the home screen. */
  showHome?: boolean;
  /** FRD F14: screens with unsaved state (올리기/확인/결과 화면) must ask
   * "처음 화면으로 갈까요?" before leaving, instead of navigating away
   * immediately. Passing `onHome` swaps 「처음으로」 from a `<Link
   * href="/">` to a `<button>` with the exact same look that calls it
   * (e.g. to open that confirmation dialog) — the caller decides whether
   * to skip the dialog for an empty form. Omit to keep the plain link
   * (home screen, and the current /new placeholder, have nothing to
   * confirm). Header stays hook-free either way, so it still works from
   * server components. */
  onHome?: () => void;
};

export function Header({ mode, showHome = false, onHome }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>
          <BrandMarkIcon />
        </span>
        <span className={styles.brandName}>회의록 자동 작성</span>
      </div>
      <div className={styles.actions}>
        {mode === "a" && (
          <span className={`${styles.badge} ${styles.badgeA}`}>
            <ReviewModeIcon />
            검토 후 보내기
          </span>
        )}
        {mode === "b" && (
          <span className={`${styles.badge} ${styles.badgeB}`}>
            <SendModeIcon />
            바로 보내기
          </span>
        )}
        {showHome &&
          (onHome ? (
            <button
              type="button"
              aria-label="처음으로"
              onClick={onHome}
              className={styles.homeButton}
            >
              <HouseIcon />
              <span className={styles.homeLabel}>처음으로</span>
            </button>
          ) : (
            <Link href="/" aria-label="처음으로" className={styles.homeButton}>
              <HouseIcon />
              <span className={styles.homeLabel}>처음으로</span>
            </Link>
          ))}
      </div>
    </header>
  );
}
