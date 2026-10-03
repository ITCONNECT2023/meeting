import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanupWorkflowRuns } from "@/lib/cleanup/workflow-runs";

const TEST_DIR = path.join(process.cwd(), ".local-data", "test-cleanup-workflow-data");

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

beforeEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  vi.stubEnv("WORKFLOW_LOCAL_DATA_DIR", TEST_DIR);
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("EPIC 9-1: Workflow 진행 기록 청소 (lib/cleanup/workflow-runs)", () => {
  it("끝난 지 1일이 지난 실행은 실행+단계+이벤트+잠금 기록을 모두 지운다", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const runId = "wrun_old";
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const runPath = path.join(TEST_DIR, "runs", `${runId}.json`);
    writeJson(runPath, {
      runId,
      status: "completed",
      completedAt: twoDaysAgo,
      updatedAt: twoDaysAgo,
      createdAt: twoDaysAgo,
    });
    const stepPath = path.join(TEST_DIR, "steps", `${runId}-step_1.json`);
    writeJson(stepPath, { runId, stepId: "step_1", status: "completed" });
    const eventPath = path.join(TEST_DIR, "events", `${runId}-evnt_1.json`);
    writeJson(eventPath, { runId, eventId: "evnt_1" });
    const lockPath = path.join(TEST_DIR, ".locks", "steps", `${runId}-step_1.terminal`);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "");

    const result = await cleanupWorkflowRuns(now, false);

    expect(result).toEqual({ deleted: 1, kept: 0 });
    expect(fs.existsSync(runPath)).toBe(false);
    expect(fs.existsSync(stepPath)).toBe(false);
    expect(fs.existsSync(eventPath)).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("실행 중이거나 끝난 지 1일이 안 된 실행은 남긴다", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const runningPath = path.join(TEST_DIR, "runs", "wrun_running.json");
    writeJson(runningPath, {
      runId: "wrun_running",
      status: "running",
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    });
    const recentPath = path.join(TEST_DIR, "runs", "wrun_recent.json");
    writeJson(recentPath, {
      runId: "wrun_recent",
      status: "completed",
      completedAt: oneHourAgo,
      createdAt: oneHourAgo,
      updatedAt: oneHourAgo,
    });

    const result = await cleanupWorkflowRuns(now, false);

    expect(result).toEqual({ deleted: 0, kept: 2 });
    expect(fs.existsSync(runningPath)).toBe(true);
    expect(fs.existsSync(recentPath)).toBe(true);
  });

  it("데이터 폴더가 아직 없으면 오류 없이 0건/0건 (Vercel에서는 이 상태로 고정)", async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });

    const result = await cleanupWorkflowRuns(new Date(), false);

    expect(result).toEqual({ deleted: 0, kept: 0 });
  });

  it("dryRun에서는 개수만 세고 실제로는 지우지 않는다", async () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const runPath = path.join(TEST_DIR, "runs", "wrun_old2.json");
    writeJson(runPath, { runId: "wrun_old2", status: "failed", completedAt: twoDaysAgo });

    const result = await cleanupWorkflowRuns(now, true);

    expect(result).toEqual({ deleted: 1, kept: 0 });
    expect(fs.existsSync(runPath)).toBe(true);
  });
});
