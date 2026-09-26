/**
 * EPIC 1-7: reads the env vars `npm run check:external` needs. Problems
 * name the variable, never its value.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_MAIL_FROM_NAME = "회의록 봇";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const APP_PASSWORD_LENGTH = 16;

export interface GmailConfig {
  user: string;
  /** Whitespace already removed. */
  appPassword: string;
  fromName: string;
  to: string;
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export type ConfigResult<T> =
  | { ok: true; config: T }
  | { ok: false; problems: string[] };

function value(env: Env, name: string): string {
  return (env[name] ?? "").trim();
}

function missing(names: string[]): string {
  return `.env.local에 값이 비어 있습니다: ${names.join(", ")}`;
}

/**
 * Google displays app passwords as "abcd efgh ijkl mnop"; people paste it
 * like that. The spaces are not part of the password.
 */
export function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

function looksLikeEmail(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
}

export function readGmailConfig(env: Env): ConfigResult<GmailConfig> {
  const user = value(env, "GMAIL_USER");
  const appPassword = normalizeAppPassword(env.GMAIL_APP_PASSWORD ?? "");

  const empty: string[] = [];
  if (user === "") empty.push("GMAIL_USER");
  if (appPassword === "") empty.push("GMAIL_APP_PASSWORD");
  if (empty.length > 0) return { ok: false, problems: [missing(empty)] };

  const problems: string[] = [];
  if (!looksLikeEmail(user)) {
    problems.push("GMAIL_USER가 메일 주소 모양이 아닙니다 (예: meeting.bot@gmail.com).");
  }
  if (appPassword.length !== APP_PASSWORD_LENGTH) {
    problems.push(
      `GMAIL_APP_PASSWORD는 공백을 빼고 ${APP_PASSWORD_LENGTH}자여야 합니다. ` +
        "Gmail 로그인 비밀번호가 아니라 Google 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 만든 값을 적으세요.",
    );
  }

  const to = value(env, "EXTERNAL_CHECK_TO") || user;
  if (to !== user && !looksLikeEmail(to)) {
    problems.push("EXTERNAL_CHECK_TO가 메일 주소 모양이 아닙니다. 비워 두면 GMAIL_USER로 보냅니다.");
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    config: {
      user,
      appPassword,
      fromName: value(env, "MAIL_FROM_NAME") || DEFAULT_MAIL_FROM_NAME,
      to,
    },
  };
}

export function readGeminiConfig(env: Env): ConfigResult<GeminiConfig> {
  const apiKey = value(env, "GEMINI_API_KEY");
  if (apiKey === "") return { ok: false, problems: [missing(["GEMINI_API_KEY"])] };

  return {
    ok: true,
    config: {
      apiKey,
      model: value(env, "GEMINI_MODEL") || DEFAULT_GEMINI_MODEL,
    },
  };
}
