"use client";

import { useRef, useState, type FormEvent } from "react";

import { AlertCircleIcon } from "@/components/icons";

import styles from "./page.module.css";

// FRD 6장 wording. The server only sends codes (TRD §6).
const MESSAGES = {
  AUTH_WRONG: "암호가 맞지 않습니다.",
  AUTH_LOCKED: "여러 번 틀려 10분 동안 입력할 수 없습니다.",
  EMPTY: "암호를 입력하세요.",
  UNAVAILABLE: "지금은 접속할 수 없습니다. 잠시 후 다시 시도하세요.",
} as const;

type MessageKey = keyof typeof MESSAGES;

function messageFor(code: unknown): MessageKey {
  if (code === "AUTH_WRONG" || code === "AUTH_LOCKED") return code;
  return "UNAVAILABLE";
}

export function LoginForm({ unavailable }: { unavailable: boolean }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(
    unavailable ? "UNAVAILABLE" : null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  function fail(key: MessageKey) {
    setError(key);
    setSubmitting(false);
    if (key === "AUTH_WRONG" || key === "AUTH_LOCKED") setPassword("");
    // Focus after React re-enables the input.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (password === "") {
      fail("EMPTY");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok) {
        // Full navigation (not the client router) so `/` is fetched fresh
        // with the new cookie; replace() so Back doesn't return here.
        window.location.replace("/");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const code =
        typeof body === "object" && body !== null
          ? (body as Record<string, unknown>).code
          : undefined;
      fail(messageFor(code));
    } catch {
      fail("UNAVAILABLE");
    }
  }

  const hasError = error !== null;

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.field}>
        <label htmlFor="access-password" className={styles.label}>
          접속 암호
        </label>
        <input
          ref={inputRef}
          id="access-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          readOnly={submitting}
          aria-invalid={hasError}
          aria-describedby={hasError ? "access-password-error" : undefined}
          className={`${styles.input} ${hasError ? styles.inputError : ""}`}
        />
        {hasError && (
          <p id="access-password-error" role="alert" className={styles.error}>
            <span className={styles.errorIcon}>
              <AlertCircleIcon />
            </span>
            <span>{MESSAGES[error]}</span>
          </p>
        )}
      </div>
      <button
        type="submit"
        className={styles.submit}
        disabled={submitting}
        aria-busy={submitting}
      >
        들어가기
      </button>
    </form>
  );
}
