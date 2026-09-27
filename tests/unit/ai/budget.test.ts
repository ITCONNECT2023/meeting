import { describe, expect, it } from "vitest";
import {
  calculateGeminiCost,
  COST_PER_INPUT_TOKEN_KRW,
  COST_PER_OUTPUT_TOKEN_KRW,
  MAX_GEMINI_BUDGET_KRW,
} from "@/lib/ai/budget";

describe("EPIC 5: Gemini 비용 및 한도 추적 (lib/ai/budget)", () => {
  it("최대 한도는 3,000원이다", () => {
    expect(MAX_GEMINI_BUDGET_KRW).toBe(3000);
  });

  it("입력 토큰과 출력 토큰에 기반해 비용을 정확히 계산한다", () => {
    const inputTokens = 10000;
    const outputTokens = 2000;
    const expected =
      inputTokens * COST_PER_INPUT_TOKEN_KRW + outputTokens * COST_PER_OUTPUT_TOKEN_KRW;
    const cost = calculateGeminiCost(inputTokens, outputTokens);
    expect(cost).toBeCloseTo(expected, 1);
  });
});
