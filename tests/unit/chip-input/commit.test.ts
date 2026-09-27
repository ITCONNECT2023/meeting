import { describe, expect, it } from "vitest";

import { commit, splitDraft, type ChipCheck, type ChipCheckResult } from "@/components/ChipInput/commit";

// Small fake `check` callbacks for these tests. The real rules (email
// format, 20-address cap, ...) live in lib/validation/input.ts, owned by
// another agent — these fakes only need to exercise commit()'s generic
// shape: ok / empty / duplicate-silent / message.

function fakeCheck(value: string, items: string[]): ChipCheckResult {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (items.includes(trimmed)) return { ok: false, reason: "duplicate-silent" };
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(trimmed)) {
    return { ok: false, message: "메일 주소 형식이 아닙니다. 예: name@company.com" };
  }
  return { ok: true, value: trimmed };
}

/** Accepts anything non-empty/non-duplicate — stands in for a name field,
 * which (per FRD F2) has no format rule, only the empty/duplicate ones. */
function nameCheck(value: string, items: string[]): ChipCheckResult {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (items.includes(trimmed)) return { ok: false, reason: "duplicate-silent" };
  return { ok: true, value: trimmed };
}

describe("splitDraft", () => {
  it("returns no segments and the whole trimmed string as tail when there is no comma", () => {
    expect(splitDraft("김민수")).toEqual({ segments: [], tail: "김민수" });
    expect(splitDraft("  김민수  ")).toEqual({ segments: [], tail: "김민수" });
  });

  it("treats text after the last comma as the unfinished tail", () => {
    expect(splitDraft("a@x.com, b@y.com")).toEqual({
      segments: ["a@x.com"],
      tail: "b@y.com",
    });
  });

  it("treats a trailing comma as making every piece complete", () => {
    expect(splitDraft("a@x.com, b@y.com,")).toEqual({
      segments: ["a@x.com", "b@y.com"],
      tail: "",
    });
  });

  it("supports several pasted commas at once", () => {
    expect(splitDraft("a@x.com,b@y.com,c@z.com")).toEqual({
      segments: ["a@x.com", "b@y.com"],
      tail: "c@z.com",
    });
  });

  it("keeps blank pieces (e.g. from a leading/doubled comma) for check() to classify", () => {
    expect(splitDraft(",,test")).toEqual({ segments: ["", ""], tail: "test" });
  });

  it("returns an empty tail for a wholly empty draft", () => {
    expect(splitDraft("")).toEqual({ segments: [], tail: "" });
  });
});

describe("commit", () => {
  it("does nothing (no comma, no forced tail) until the draft is forced complete", () => {
    // Mirrors typing "김민수" without yet pressing Enter/comma/추가.
    const result = commit("김민수", [], nameCheck);
    expect(result).toEqual({ items: [], draft: "김민수", error: null });
  });

  it("FRD F2: 김민수 + Enter (forced via trailing comma) becomes one whole chip", () => {
    // ChipInput's commitNow() forces the tail to commit by appending ",".
    const result = commit("김민수,", [], nameCheck);
    expect(result).toEqual({ items: ["김민수"], draft: "", error: null });
  });

  it("commits complete segments from a comma typed mid-draft, keeping the tail", () => {
    const result = commit("a@x.com, b@y.com", [], fakeCheck);
    expect(result).toEqual({ items: ["a@x.com"], draft: "b@y.com", error: null });
  });

  it("adds three addresses one at a time, in order", () => {
    let state = commit("a@x.com,", [], fakeCheck);
    state = commit("b@y.com,", state.items, fakeCheck);
    state = commit("c@z.com,", state.items, fakeCheck);
    expect(state).toEqual({
      items: ["a@x.com", "b@y.com", "c@z.com"],
      draft: "",
      error: null,
    });
  });

  it("re-adding an existing item clears the draft without an error (duplicate-silent)", () => {
    const result = commit("a@x.com,", ["a@x.com"], fakeCheck);
    expect(result).toEqual({ items: ["a@x.com"], draft: "", error: null });
  });

  it("catches a duplicate introduced within the same paste, not just across calls", () => {
    const result = commit("a@x.com, a@x.com,", [], fakeCheck);
    expect(result).toEqual({ items: ["a@x.com"], draft: "", error: null });
  });

  it("skips blank segments silently (reason: empty)", () => {
    const result = commit(",,a@x.com,", [], fakeCheck);
    expect(result).toEqual({ items: ["a@x.com"], draft: "", error: null });
  });

  it("stops on the first format error, keeping that segment in the draft", () => {
    // FRD F3 example: 3 good addresses already in, then an invalid 4th.
    const items = ["a@x.com", "b@y.com", "c@z.com"];
    const result = commit("abc@example,", items, fakeCheck);
    expect(result).toEqual({
      items, // unchanged: nothing new committed
      draft: "abc@example",
      error: "메일 주소 형식이 아닙니다. 예: name@company.com",
    });
  });

  it("keeps later segments and the tail in the draft after an error", () => {
    const result = commit("ok@x.com, bad, also@y.com, tail", [], fakeCheck);
    expect(result).toEqual({
      items: ["ok@x.com"],
      draft: "bad, also@y.com, tail",
      error: "메일 주소 형식이 아닙니다. 예: name@company.com",
    });
  });

  it("is a safe no-op on an empty draft (e.g. a spurious second Enter after compositionend)", () => {
    const result = commit(",", ["김민수"], nameCheck);
    expect(result).toEqual({ items: ["김민수"], draft: "", error: null });
  });

  it("clearing an error: typing again is handled by the caller, not commit() — commit() only runs on comma/forced-tail", () => {
    // Documents the division of labour: ChipInput.tsx clears `error` itself
    // on plain keystrokes (FRD F3), it does not call commit() for those.
    const check: ChipCheck = (value) => ({ ok: true, value });
    const result = commit("x,", [], check);
    expect(result.error).toBeNull();
  });
});
