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
};

export function Header({ mode, showHome = false }: HeaderProps) {
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
        {showHome && (
          <Link href="/" aria-label="처음으로" className={styles.homeButton}>
            <HouseIcon />
            <span className={styles.homeLabel}>처음으로</span>
          </Link>
        )}
      </div>
    </header>
  );
}
