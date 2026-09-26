import { describe, expect, it } from "vitest";

import { classifyGeminiError } from "@/scripts/check-external/gemini";
import { classifyGmailError } from "@/scripts/check-external/gmail";

/** Shaped like nodemailer's SMTPConnection._formatError output. */
function smtpError(code: string, response?: string): Error {
  const err = new Error(response ? `Invalid login: ${response}` : "boom") as Error &
    Record<string, unknown>;
  err.code = code;
  if (response) {
    err.response = response;
    err.responseCode = Number(response.slice(0, 3));
    err.command = "AUTH PLAIN";
  }
  return err;
}

/** Shaped like @google/genai's ApiError: status + raw JSON body as message. */
function apiError(status: number, body: Record<string, unknown>): Error {
  const err = new Error(JSON.stringify({ error: body })) as Error & { status: number };
  err.name = "ApiError";
  err.status = status;
  return err;
}

describe("classifyGmailError", () => {
  it.each([
    ["EAUTH 535 bad credentials", smtpError("EAUTH", "535-5.7.8 Username and Password not accepted. For more information, go to https://support.google.com/mail/?p=BadCredentials"), "앱 비밀번호가 틀렸거나 2단계 인증이 꺼져"],
    ["EAUTH 534 app password required", smtpError("EAUTH", "534-5.7.9 Application-specific password required."), "앱 비밀번호를 요구"],
    ["ETIMEDOUT", smtpError("ETIMEDOUT"), "네트워크 또는 방화벽"],
    ["ECONNECTION", smtpError("ECONNECTION"), "네트워크 또는 방화벽"],
    ["ESOCKET (ENOTFOUND wrapped)", smtpError("ESOCKET"), "네트워크 또는 방화벽"],
    ["EDNS", smtpError("EDNS"), "네트워크 또는 방화벽"],
    ["raw ENOTFOUND", smtpError("ENOTFOUND"), "네트워크 또는 방화벽"],
    ["ETLS", smtpError("ETLS"), "보안 연결(TLS)"],
    ["454 too many logins", smtpError("EAUTH", "454 4.7.0 Too many login attempts, please try again later."), "로그인 시도가 너무 많아"],
    ["daily limit", smtpError("EMESSAGE", "550 5.4.5 Daily user sending limit exceeded."), "하루 발송 한도"],
    ["EENVELOPE", smtpError("EENVELOPE"), "주소를 거절"],
    ["unknown", smtpError("ESTREAM"), "예상하지 못한"],
    ["not an error object", "weird", "예상하지 못한"],
  ])("%s", (_name, error, expected) => {
    const failure = classifyGmailError(error);
    expect(failure.cause).toContain(expected);
    expect(failure.next.length).toBeGreaterThan(0);
  });

  it("puts the code and response code in the detail", () => {
    const failure = classifyGmailError(
      smtpError("EAUTH", "535-5.7.8 Username and Password not accepted."),
    );
    expect(failure.detail).toBe("EAUTH 535: 535-5.7.8 Username and Password not accepted.");
  });
});

describe("classifyGeminiError", () => {
  const model = "gemini-3.8-flash";

  it.each([
    [
      "400 API_KEY_INVALID",
      apiError(400, {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID" }],
      }),
      "API 키가 올바르지 않습니다",
    ],
    ["401", apiError(401, { code: 401, message: "Unauthenticated", status: "UNAUTHENTICATED" }), "이 키를 거절"],
    [
      "403 SERVICE_DISABLED",
      apiError(403, {
        code: 403,
        message: "Generative Language API has not been used in project 123 before or it is disabled.",
        status: "PERMISSION_DENIED",
        details: [{ reason: "SERVICE_DISABLED" }],
      }),
      "Generative Language API",
    ],
    [
      "404 model",
      apiError(404, { code: 404, message: "models/gemini-3.8-flash is not found for API version v1beta", status: "NOT_FOUND" }),
      'gemini-3.8-flash"을(를) 이 키로 쓸 수 없습니다',
    ],
    ["429", apiError(429, { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" }), "요청 한도"],
    [
      "400 location",
      apiError(400, { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" }),
      "지역 제한",
    ],
    ["500", apiError(500, { code: 500, message: "Internal error", status: "INTERNAL" }), "일시적인 문제"],
    ["400 other", apiError(400, { code: 400, message: "Invalid value", status: "INVALID_ARGUMENT" }), "HTTP 400"],
  ])("%s", (_name, error, expected) => {
    const failure = classifyGeminiError(error, model);
    expect(failure.cause).toContain(expected);
    expect(failure.next.length).toBeGreaterThan(0);
  });

  it("404 tells how to change the model and does not fall back", () => {
    const failure = classifyGeminiError(apiError(404, { code: 404, status: "NOT_FOUND" }), model);
    expect(failure.next.join("\n")).toContain("GEMINI_MODEL");
    expect(failure.cause).toContain("자동으로 바꾸지 않습니다");
  });

  it("detail shows status and reason, not the raw JSON", () => {
    const failure = classifyGeminiError(
      apiError(400, {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ reason: "API_KEY_INVALID" }],
      }),
      model,
    );
    expect(failure.detail).toBe(
      "HTTP 400 INVALID_ARGUMENT (API_KEY_INVALID): API key not valid. Please pass a valid API key.",
    );
  });

  it("handles a non-JSON ApiError message", () => {
    const err = Object.assign(new Error("<html>Bad Gateway</html>"), { status: 502 });
    const failure = classifyGeminiError(err, model);
    expect(failure.cause).toContain("일시적인 문제");
    expect(failure.detail).toContain("HTTP 502");
  });

  it("timeout (AbortError / TimeoutError)", () => {
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(classifyGeminiError(abort, model).cause).toContain("30초 안에");
    const timeout = Object.assign(new Error("late"), { name: "TimeoutError" });
    expect(classifyGeminiError(timeout, model).cause).toContain("30초 안에");
  });

  it("network: fetch failed with a socket code on cause", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
    });
    const failure = classifyGeminiError(err, model);
    expect(failure.cause).toContain("네트워크 또는 방화벽");
    expect(failure.detail).toBe("ENOTFOUND");
  });

  it("TLS interception", () => {
    const err = new TypeError("fetch failed", {
      cause: Object.assign(new Error("self-signed certificate in certificate chain"), {
        code: "SELF_SIGNED_CERT_IN_CHAIN",
      }),
    });
    expect(classifyGeminiError(err, model).cause).toContain("보안 연결(TLS)");
  });

  it("anything else is generic", () => {
    expect(classifyGeminiError(new Error("odd"), model).cause).toContain("예상하지 못한");
    expect(classifyGeminiError(undefined, model).cause).toContain("예상하지 못한");
  });
});
