import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Header } from "@/components/Header/Header";
import { LockIcon } from "@/components/icons";
import { isValidSessionCookie } from "@/lib/auth/check";
import { readAuthConfig } from "@/lib/auth/env";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

import { LoginForm } from "./LoginForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "접속 암호 · 회의록 자동 작성",
};

// EPIC 1-4 (F13): 접속 암호 화면. Not in the mockups (FRD 8-1), so it is
// composed from the mockups' surfaces, fonts, input and primary button.
export default async function LoginPage() {
  // Reading cookies first also opts this page out of build-time
  // prerendering, so the env check below only ever runs per request.
  const cookieStore = await cookies();
  if (isValidSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value)) {
    redirect("/");
  }
  const auth = readAuthConfig();

  return (
    <>
      <Header />
      <main className={styles.main}>
        <section className={styles.card} aria-labelledby="login-title">
          <span className={styles.icon}>
            <LockIcon size={22} />
          </span>
          <h1 id="login-title" className={styles.title}>
            회의록 자동 작성
          </h1>
          <p className={styles.lead}>
            팀 공용 암호를 입력하세요. 이 기기에서는 30일 동안 다시 묻지
            않습니다.
          </p>
          <LoginForm unavailable={!auth.ok} />
        </section>
      </main>
    </>
  );
}
