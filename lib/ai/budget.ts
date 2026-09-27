import fs from "node:fs";
import path from "node:path";

export const MAX_GEMINI_BUDGET_KRW = 3000;

// Gemini Flash 3.8 / Flash models pricing estimate
// ~ $1.00 / 1M input tokens (0.0014 KRW/token at 1400 KRW/USD)
// ~ $0.40 / 1M output tokens (0.00056 KRW/token)
export const COST_PER_INPUT_TOKEN_KRW = 0.0014;
export const COST_PER_OUTPUT_TOKEN_KRW = 0.0006;

export function calculateGeminiCost(inputTokens: number, outputTokens: number): number {
  const cost =
    inputTokens * COST_PER_INPUT_TOKEN_KRW + outputTokens * COST_PER_OUTPUT_TOKEN_KRW;
  return Math.round(cost * 10) / 10;
}

const BUDGET_FILE_PATH = path.join(process.cwd(), ".local-data", "gemini-budget.md");

export async function getAccumulatedGeminiCost(): Promise<number> {
  if (!fs.existsSync(BUDGET_FILE_PATH)) {
    return 0;
  }
  const content = fs.readFileSync(BUDGET_FILE_PATH, "utf-8");
  const match = content.match(/현재 실제 Gemini 호출 누적 비용:\*\*\s*([\d,.]+)\s*원/);
  if (match) {
    const val = parseFloat(match[1].replace(/,/g, ""));
    return Number.isNaN(val) ? 0 : val;
  }
  return 0;
}

export async function assertWithinGeminiBudget(estimatedCostKrw: number = 20): Promise<void> {
  const current = await getAccumulatedGeminiCost();
  if (current + estimatedCostKrw > MAX_GEMINI_BUDGET_KRW) {
    throw new Error(
      `Gemini 호출 누적 예상 비용(${current + estimatedCostKrw}원)이 한도(${MAX_GEMINI_BUDGET_KRW}원)를 초과합니다.`,
    );
  }
}

export interface UsageRecordEntry {
  jobId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function recordGeminiUsage(entry: UsageRecordEntry): Promise<{
  costKrw: number;
  totalCostKrw: number;
}> {
  const costKrw = calculateGeminiCost(entry.inputTokens, entry.outputTokens);
  const currentTotal = await getAccumulatedGeminiCost();
  const totalCostKrw = Math.round((currentTotal + costKrw) * 10) / 10;

  if (fs.existsSync(BUDGET_FILE_PATH)) {
    let content = fs.readFileSync(BUDGET_FILE_PATH, "utf-8");
    // Update header total
    content = content.replace(
      /(\*\*현재 실제 Gemini 호출 누적 비용:\*\*\s*)([\d,.]+)(\s*원)/,
      `$1${totalCostKrw.toLocaleString("ko-KR")}$3`,
    );

    const nowStr = new Date().toISOString().replace("T", " ").substring(0, 19);
    const row = `| ${nowStr} | ${entry.jobId || "-"} | ${entry.model} | ${entry.inputTokens} | ${entry.outputTokens} | ${costKrw} | ${totalCostKrw} |\n`;

    // Append to table
    if (content.includes("## Gemini 호출 기록")) {
      content = content.trimEnd() + "\n" + row;
    }
    fs.writeFileSync(BUDGET_FILE_PATH, content, "utf-8");
  }

  return { costKrw, totalCostKrw };
}
