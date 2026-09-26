import { Header, type HeaderMode } from "@/components/Header/Header";

import styles from "./page.module.css";

type NewPageProps = {
  searchParams: Promise<{ mode?: string | string[] }>;
};

function resolveMode(value: string | string[] | undefined): HeaderMode {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "b" ? "b" : "a";
}

// EPIC 2 builds the real upload screen. This placeholder only exists so the
// header's mode-badge / 「처음으로」 variants can be seen for 1-2. Per FRD
// F14, an empty upload screen leaves for home without a confirm dialog, so
// 「처음으로」 here is a plain link back to `/`.
export default async function NewPage({ searchParams }: NewPageProps) {
  const params = await searchParams;
  const mode = resolveMode(params.mode);

  return (
    <>
      <Header mode={mode} showHome />
      <main className={styles.main}>
        <h1 className={styles.title}>회의 녹음 올리기</h1>
        <p className={styles.note}>올리기 화면은 다음 단계에서 만듭니다.</p>
      </main>
    </>
  );
}
