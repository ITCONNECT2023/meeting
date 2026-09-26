/**
 * EPIC 1-7: send one test mail through the dedicated Gmail account
 * (smtp.gmail.com:465, app password). Self-contained on purpose — the real
 * sender (lib/mail/smtp.ts) is built in EPIC 7.
 */

import nodemailer from "nodemailer";

import type { ConfigResult, GmailConfig } from "./config.ts";
import { shortMessage } from "./types.ts";
import type { CheckOutcome, Failure } from "./types.ts";

export const GMAIL_HOST = "smtp.gmail.com";
export const GMAIL_PORT = 465;
export const TEST_SUBJECT = "[연결 점검] 회의록 봇";

export interface TestMessage {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
}

export interface SendInfo {
  messageId?: string;
  accepted?: unknown[];
  rejected?: unknown[];
}

/** The part of a nodemailer transporter this check uses. */
export interface MailTransport {
  verify: () => Promise<unknown>;
  sendMail: (message: TestMessage) => Promise<SendInfo>;
  close?: () => void;
}

export type TransportFactory = (config: GmailConfig) => MailTransport;

export const createGmailTransport: TransportFactory = (config) =>
  nodemailer.createTransport({
    host: GMAIL_HOST,
    port: GMAIL_PORT,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // Never let nodemailer print the SMTP conversation (it includes AUTH).
    logger: false,
    debug: false,
  });

export function formatKoreanTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
    timeStyle: "medium",
  }).format(date);
}

export function buildTestMessage(config: GmailConfig, now: Date): TestMessage {
  return {
    from: { name: config.fromName, address: config.user },
    to: config.to,
    subject: TEST_SUBJECT,
    text: [
      "회의록 봇 연결 점검 메일입니다.",
      "",
      `보낸 시각: ${formatKoreanTime(now)} (한국 시간)`,
      "보낸 곳: 개발 컴퓨터의 npm run check:external",
      "",
      "이 메일은 연결 점검용입니다. 답장하지 않아도 됩니다.",
    ].join("\n"),
  };
}

const NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ECONNECTION",
  "ESOCKET",
  "EDNS",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPROXY",
]);

const CERT_CODES = new Set([
  "ETLS",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

interface SmtpErrorLike {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
}

function detailOf(err: SmtpErrorLike): string {
  const parts: string[] = [];
  if (typeof err.code === "string") parts.push(err.code);
  if (typeof err.responseCode === "number") parts.push(String(err.responseCode));
  const text = shortMessage(
    typeof err.response === "string" ? err.response : err.message,
  );
  return [parts.join(" "), text].filter((s) => s !== "").join(": ");
}

const APP_PASSWORD_HELP =
  "https://myaccount.google.com/apppasswords 에서 앱 비밀번호를 새로 만들어 .env.local의 GMAIL_APP_PASSWORD에 적으세요 (공백은 있어도 됩니다).";

export function classifyGmailError(error: unknown): Failure {
  const err: SmtpErrorLike =
    typeof error === "object" && error !== null ? (error as SmtpErrorLike) : {};
  const code = typeof err.code === "string" ? err.code : "";
  const responseCode = typeof err.responseCode === "number" ? err.responseCode : 0;
  const response = typeof err.response === "string" ? err.response : "";
  const detail = detailOf(err) || undefined;

  if (responseCode === 534 || /5\.7\.9|application-specific password/i.test(response)) {
    return {
      cause: "Gmail이 앱 비밀번호를 요구합니다. 일반 로그인 비밀번호를 적었거나 2단계 인증이 꺼져 있습니다.",
      next: [
        "전용 Gmail 계정에서 Google 계정 → 보안 → 2단계 인증을 켜세요.",
        APP_PASSWORD_HELP,
      ],
      detail,
    };
  }

  if (responseCode === 454 || /too many login attempts/i.test(response)) {
    return {
      cause: "짧은 시간에 로그인 시도가 너무 많아 Gmail이 잠시 막았습니다.",
      next: ["10분쯤 기다린 뒤 다시 실행하세요."],
      detail,
    };
  }

  if (/5\.4\.5|sending limit/i.test(response)) {
    return {
      cause: "Gmail 하루 발송 한도를 넘었습니다.",
      next: ["24시간 뒤 다시 실행하세요."],
      detail,
    };
  }

  if (code === "EAUTH" || responseCode === 535) {
    return {
      cause: "Gmail이 로그인을 거절했습니다. 앱 비밀번호가 틀렸거나 2단계 인증이 꺼져 있습니다 (2단계 인증을 끄면 앱 비밀번호도 함께 없어집니다).",
      next: [
        "GMAIL_USER가 앱 비밀번호를 만든 그 전용 Gmail 주소인지 확인하세요.",
        APP_PASSWORD_HELP,
      ],
      detail,
    };
  }

  if (code === "ENOAUTH") {
    return {
      cause: "Gmail 로그인 정보가 전달되지 않았습니다.",
      next: ["GMAIL_USER와 GMAIL_APP_PASSWORD를 .env.local에 적었는지 확인하세요."],
      detail,
    };
  }

  if (CERT_CODES.has(code)) {
    return {
      cause: `${GMAIL_HOST}와 보안 연결(TLS)을 맺지 못했습니다.`,
      next: [
        "백신·보안 프로그램의 '메일 검사'나 'SSL/HTTPS 검사' 기능이 연결을 가로채는지 확인하세요.",
        "회사망이라면 보안 장비가 인증서를 바꿔 끼우는지 담당자에게 확인하세요.",
      ],
      detail,
    };
  }

  if (NETWORK_CODES.has(code)) {
    return {
      cause: `${GMAIL_HOST}:${GMAIL_PORT}에 연결하지 못했습니다 (네트워크 또는 방화벽).`,
      next: [
        "인터넷 연결을 확인하세요.",
        "방화벽·백신·VPN·회사망이 465번 포트(메일 발송)를 막는지 확인하세요.",
      ],
      detail,
    };
  }

  if (code === "EENVELOPE") {
    return {
      cause: "Gmail이 보내는 주소나 받는 주소를 거절했습니다.",
      next: ["GMAIL_USER와 EXTERNAL_CHECK_TO(적었다면)의 주소가 맞는지 확인하세요."],
      detail,
    };
  }

  return {
    cause: "Gmail 발송 중 예상하지 못한 오류가 났습니다.",
    next: ["아래 세부 내용을 확인하고, 잠시 뒤 다시 실행하세요."],
    detail,
  };
}

export async function runGmailCheck(
  configResult: ConfigResult<GmailConfig>,
  createTransport: TransportFactory = createGmailTransport,
  now: () => Date = () => new Date(),
): Promise<CheckOutcome> {
  if (!configResult.ok) {
    return {
      ok: false,
      cause: configResult.problems.join(" "),
      next: ["위 설정을 .env.local에 적은 뒤 다시 실행하세요."],
    };
  }

  const { config } = configResult;
  let transport: MailTransport | undefined;
  try {
    transport = createTransport(config);
    await transport.verify();
    const info = await transport.sendMail(buildTestMessage(config, now()));

    if (Array.isArray(info.rejected) && info.rejected.length > 0) {
      return {
        ok: false,
        cause: "Gmail이 받는 주소를 거절했습니다.",
        next: ["EXTERNAL_CHECK_TO(적었다면)나 GMAIL_USER의 주소가 맞는지 확인하세요."],
      };
    }

    return {
      ok: true,
      lines: [
        `받는 사람: ${config.to}`,
        `메일 번호(Message-ID): ${info.messageId ?? "(없음)"}`,
        `메일함(안 보이면 스팸함)에서 "${TEST_SUBJECT}" 메일을 확인하세요.`,
      ],
    };
  } catch (error) {
    return { ok: false, ...classifyGmailError(error) };
  } finally {
    transport?.close?.();
  }
}
