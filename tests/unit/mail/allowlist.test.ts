import { describe, expect, it } from "vitest";
import { isAllowedRecipient, filterAllowedRecipients } from "@/lib/mail/allowlist";

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
