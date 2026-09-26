import { describe, expect, it } from "vitest";

describe("sanity", () => {
  it("runs unit tests in a plain Node environment (no DOM global)", () => {
    expect(typeof window).toBe("undefined");
  });

  it("does basic arithmetic", () => {
    expect(1 + 1).toBe(2);
  });
});
