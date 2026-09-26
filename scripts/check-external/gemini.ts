/**
 * EPIC 1-7: send one tiny request to Gemini. Self-contained on purpose —
 * the real AI client (lib/ai/*) is built in EPIC 5. No fallback model: if
 * GEMINI_MODEL doesn't exist, that is reported, not papered over.
 */

import { GoogleGenAI } from "@google/genai";

import type { ConfigResult, GeminiConfig } from "./config.ts";
import { shortMessage } from "./types.ts";
import type { CheckOutcome, Failure } from "./types.ts";

export const GEMINI_HOST = "generativelanguage.googleapis.com";
export const GEMINI_TIMEOUT_MS = 30_000;
export const TEST_PROMPT = "연결 점검입니다. 'OK' 한 단어로만 답하세요.";
export const MAX_REPLY_CHARS = 50;

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
}

export interface GeminiReply {
  text?: string;
  usage?: GeminiUsage;
  modelVersion?: string;
}

export interface GenerateRequest {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
}

export type GenerateFn = (request: GenerateRequest) => Promise<GeminiReply>;

function timeoutError(ms: number): Error {
  const err = new Error(`${ms}ms 안에 응답이 없습니다.`);
  err.name = "TimeoutError";
  return err;
}

export const generateWithSdk: GenerateFn = async ({ apiKey, model, prompt, timeoutMs }) => {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });

  // The SDK's own timeout covers the HTTP call; this also bounds anything
  // around it so the command can never hang.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs + 2_000);
    timer.unref?.();
  });

  try {
    const response = await Promise.race([
      ai.models.generateContent({ model, contents: prompt }),
      deadline,
    ]);
    return {
      text: response.text,
      usage: response.usageMetadata,
      modelVersion: response.modelVersion,
    };
  } finally {
    clearTimeout(timer);
  }
};

interface GoogleErrorBody {
  code?: number;
  status?: string;
  message?: string;
  reasons: string[];
}

/**
 * @google/genai's ApiError keeps the HTTP status in `status` and the raw
 * JSON error body as its `message` string.
 */
function parseGoogleError(message: unknown): GoogleErrorBody {
  const empty: GoogleErrorBody = { reasons: [] };
  if (typeof message !== "string") return empty;
  try {
    const parsed: unknown = JSON.parse(message);
    const error =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? (parsed as { error: unknown }).error
        : undefined;
    if (typeof error !== "object" || error === null) return empty;
    const e = error as Record<string, unknown>;
    const details = Array.isArray(e.details) ? e.details : [];
    const reasons = details
      .map((d) =>
        typeof d === "object" && d !== null ? (d as Record<string, unknown>).reason : undefined,
      )
      .filter((r): r is string => typeof r === "string");
    return {
      code: typeof e.code === "number" ? e.code : undefined,
      status: typeof e.status === "string" ? e.status : undefined,
      message: typeof e.message === "string" ? e.message : undefined,
      reasons,
    };
  } catch {
    return empty;
  }
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const CERT_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** `fetch` failures carry the socket error code on `cause`. */
function networkCode(err: Record<string, unknown>): string {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const code = (current as Record<string, unknown>).code;
    if (typeof code === "string") return code;
    current = (current as Record<string, unknown>).cause;
  }
  return "";
}

const KEY_HELP =
  "Google AI Studio(https://aistudio.google.com/apikey)에서 키를 다시 복사해 .env.local의 GEMINI_API_KEY에 적으세요 (앞뒤 공백·따옴표 없이).";

export function classifyGeminiError(error: unknown, model: string): Failure {
  const err: Record<string, unknown> =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const status = typeof err.status === "number" ? err.status : 0;

  if (status > 0) {
    const body = parseGoogleError(err.message);
    const reasonText = body.reasons.length > 0 ? ` (${body.reasons.join(", ")})` : "";
    const head = `HTTP ${status}${body.status ? ` ${body.status}` : ""}${reasonText}`;
    const text = shortMessage(body.message ?? (body.status ? "" : err.message));
    const detail = text ? `${head}: ${text}` : head;
    const has = (reason: string) => body.reasons.includes(reason);
    const msg = body.message ?? "";

    if (has("API_KEY_INVALID") || /api key not valid|api key expired/i.test(msg)) {
      return { cause: "Gemini API 키가 올바르지 않습니다.", next: [KEY_HELP], detail };
    }

    if (status === 401 || status === 403) {
      return {
        cause:
          "Gemini가 이 키를 거절했습니다. 키가 잘못되었거나, 키가 속한 Google Cloud 프로젝트에서 Gemini API(Generative Language API)가 꺼져 있거나, 키에 사용 제한이 걸려 있습니다.",
        next: [
          KEY_HELP,
          "Google Cloud 콘솔에서 해당 프로젝트의 Generative Language API가 사용 설정되어 있는지, 키의 API·IP 제한을 확인하세요.",
        ],
        detail,
      };
    }

    if (status === 404) {
      return {
        cause: `모델 "${model}"을(를) 이 키로 쓸 수 없습니다. 모델 이름이 틀렸거나, 아직 열리지 않았거나, 더 이상 제공되지 않는 모델입니다. (다른 모델로 자동으로 바꾸지 않습니다.)`,
        next: [
          "https://ai.google.dev/gemini-api/docs/models 에서 쓸 수 있는 정확한 모델 이름을 확인하세요.",
          ".env.local에 GEMINI_MODEL=<모델 이름> 을 적고 다시 실행하세요 (기본값: gemini-3.8-flash).",
        ],
        detail,
      };
    }

    if (status === 429) {
      return {
        cause: "Gemini 요청 한도를 넘었거나, 유료 등급 결제가 연결되지 않았습니다.",
        next: [
          "Google AI Studio → 결제(Billing)에서 이 키의 프로젝트에 결제가 연결되어 유료 등급인지 확인하세요.",
          "연결되어 있다면 1분쯤 뒤 다시 실행하세요.",
        ],
        detail,
      };
    }

    if (body.status === "FAILED_PRECONDITION" || /location is not supported|billing/i.test(msg)) {
      return {
        cause: "Gemini를 이 조건에서 쓸 수 없습니다 (지역 제한이거나 결제가 연결되지 않음).",
        next: [
          "Google AI Studio → 결제(Billing)에서 결제를 연결하세요.",
          "VPN을 쓰고 있다면 끄고 다시 실행하세요.",
        ],
        detail,
      };
    }

    if (status >= 500) {
      return {
        cause: "Gemini 서버에 일시적인 문제가 있습니다.",
        next: ["몇 분 뒤 다시 실행하세요."],
        detail,
      };
    }

    return {
      cause: `Gemini가 요청을 거절했습니다 (HTTP ${status}).`,
      next: [
        `모델 이름("${model}")이 맞는지 확인하세요. 바꾸려면 .env.local의 GEMINI_MODEL에 적으세요.`,
        "아래 세부 내용을 확인하세요.",
      ],
      detail,
    };
  }

  const name = typeof err.name === "string" ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return {
      cause: `Gemini가 ${GEMINI_TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다.`,
      next: ["인터넷 연결을 확인하고 잠시 뒤 다시 실행하세요."],
      detail: name,
    };
  }

  const code = networkCode(err);
  if (CERT_CODES.has(code)) {
    return {
      cause: `${GEMINI_HOST}와 보안 연결(TLS)을 맺지 못했습니다.`,
      next: [
        "백신·보안 프로그램의 'SSL/HTTPS 검사' 기능이 연결을 가로채는지 확인하세요.",
        "회사망이라면 보안 장비가 인증서를 바꿔 끼우는지 담당자에게 확인하세요.",
      ],
      detail: code,
    };
  }
  if (NETWORK_CODES.has(code) || (name === "TypeError" && err.message === "fetch failed")) {
    return {
      cause: `${GEMINI_HOST}에 연결하지 못했습니다 (네트워크 또는 방화벽).`,
      next: ["인터넷 연결을 확인하고, 방화벽·VPN·회사망이 막는지 확인하세요."],
      detail: code || shortMessage(err.message),
    };
  }

  return {
    cause: "Gemini 요청 중 예상하지 못한 오류가 났습니다.",
    next: ["아래 세부 내용을 확인하고, 잠시 뒤 다시 실행하세요."],
    detail: [name, shortMessage(err.message)].filter((s) => s !== "").join(": ") || undefined,
  };
}

function formatUsage(usage: GeminiUsage | undefined): string {
  if (!usage) return "(정보 없음)";
  const parts = [
    `입력 ${usage.promptTokenCount ?? 0}`,
    `출력 ${usage.candidatesTokenCount ?? 0}`,
  ];
  if (usage.thoughtsTokenCount) parts.push(`생각 ${usage.thoughtsTokenCount}`);
  parts.push(`합계 ${usage.totalTokenCount ?? 0}`);
  return parts.join(", ");
}

export function formatReply(text: string | undefined): string {
  const oneLine = (text ?? "").replace(/\s+/g, " ").trim();
  if (oneLine === "") return "(빈 응답)";
  return oneLine.length > MAX_REPLY_CHARS ? `${oneLine.slice(0, MAX_REPLY_CHARS)}…` : oneLine;
}

export async function runGeminiCheck(
  configResult: ConfigResult<GeminiConfig>,
  generate: GenerateFn = generateWithSdk,
): Promise<CheckOutcome> {
  if (!configResult.ok) {
    return {
      ok: false,
      cause: configResult.problems.join(" "),
      next: ["위 설정을 .env.local에 적은 뒤 다시 실행하세요."],
    };
  }

  const { apiKey, model } = configResult.config;
  try {
    const reply = await generate({
      apiKey,
      model,
      prompt: TEST_PROMPT,
      timeoutMs: GEMINI_TIMEOUT_MS,
    });
    const version =
      reply.modelVersion && reply.modelVersion !== model ? ` (응답 모델: ${reply.modelVersion})` : "";
    return {
      ok: true,
      lines: [
        `모델: ${model}${version}`,
        `응답: ${formatReply(reply.text)}`,
        `토큰: ${formatUsage(reply.usage)}`,
      ],
    };
  } catch (error) {
    return { ok: false, ...classifyGeminiError(error, model) };
  }
}
