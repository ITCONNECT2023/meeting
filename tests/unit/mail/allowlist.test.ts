import { describe, expect, it } from "vitest";
import {
  isAllowedRecipient,
  filterAllowedRecipients,
  isAllowlistRequired,
} from "@/lib/mail/allowlist";

describe("MAIL_ALLOWLIST validation (PRD 5-1, TRD 5-1)", () => {
  it("허용 목록이 비어 있으면 모든 주소를 허용한다 (운영 기본값)", () => {
    expect(isAllowedRecipient("user@example.com", "")).toBe(true);
    expect(isAllowedRecipient("anyone@anywhere.org", undefined)).toBe(true);
  });

  it("정확한 이메일 주소 매칭 (대소문자 무시)", () => {
    const list = "test@company.com, admin@company.com";
    expect(isAllowedRecipient("test@company.com", list)).toBe(true);
    expect(isAllowedRecipient("TEST@COMPANY.COM", list)).toBe(true);
    expect(isAllowedRecipient("other@company.com", list)).toBe(false);
  });

  it("와일드카드 도메인 매칭 (*@domain.com)", () => {
    const list = "*@testcorp.com, allowed@external.com";
    expect(isAllowedRecipient("alice@testcorp.com", list)).toBe(true);
    expect(isAllowedRecipient("bob@testcorp.com", list)).toBe(true);
    expect(isAllowedRecipient("charlie@othercorp.com", list)).toBe(false);
    expect(isAllowedRecipient("allowed@external.com", list)).toBe(true);
    expect(isAllowedRecipient("hacker@external.com", list)).toBe(false);
  });

  it("filterAllowedRecipients로 허용된 주소와 차단된 주소를 분리한다", () => {
    const list = "a@x.com, b@x.com";
    const res = filterAllowedRecipients(["a@x.com", "c@x.com", "B@X.COM"], list);
    expect(res.allowed).toEqual(["a@x.com", "B@X.COM"]);
    expect(res.blocked).toEqual(["c@x.com"]);
  });
});

describe("MAIL_ALLOWLIST 필수 모드 (로컬·미리보기 실제 발송, EPIC 7-2)", () => {
  it("필수 모드에서 허용 목록이 비어 있으면 모든 주소를 막는다", () => {
    const opts = { requireAllowlist: true };
    expect(isAllowedRecipient("user@example.com", "", opts)).toBe(false);
    expect(isAllowedRecipient("user@example.com", "   ", opts)).toBe(false);
    expect(isAllowedRecipient("user@example.com", " , ,", opts)).toBe(false);
    const res = filterAllowedRecipients(["a@x.com", "b@y.com"], "", opts);
    expect(res.allowed).toEqual([]);
    expect(res.blocked).toEqual(["a@x.com", "b@y.com"]);
  });

  it("필수 모드여도 목록에 적힌 주소는 그대로 보낸다", () => {
    const opts = { requireAllowlist: true };
    expect(isAllowedRecipient("me@x.com", "me@x.com", opts)).toBe(true);
    expect(isAllowedRecipient("other@x.com", "me@x.com", opts)).toBe(false);
  });

  it("실제 SMTP이고 운영(VERCEL_ENV=production)이 아닐 때만 필수다", () => {
    expect(isAllowlistRequired({ realSmtp: true, vercelEnv: undefined })).toBe(true);
    expect(isAllowlistRequired({ realSmtp: true, vercelEnv: "" })).toBe(true);
    expect(isAllowlistRequired({ realSmtp: true, vercelEnv: "development" })).toBe(true);
    expect(isAllowlistRequired({ realSmtp: true, vercelEnv: "preview" })).toBe(true);
    expect(isAllowlistRequired({ realSmtp: true, vercelEnv: "production" })).toBe(false);
    // 가짜 메일 창구는 실제로 나가지 않으므로 영향 없음
    expect(isAllowlistRequired({ realSmtp: false, vercelEnv: undefined })).toBe(false);
  });
});
