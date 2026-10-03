import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same fake-client approach as gemini-files.test.ts, kept minimal here: this
// file only needs to force the Gemini section to fail so the "one section
// throwing doesn't stop the others" behavior can be checked end to end.
const genai = vi.hoisted(() => {
  const state = { listError: undefined as unknown };

  class FakeGoogleGenAI {
    files = {
      list: async () => {
        if (state.listError) throw state.listError;
        return { [Symbol.asyncIterator]: async function* () {} };
      },
      delete: async () => {},
    };
    constructor(_config: { apiKey: string }) {
      void _config;
    }
  }

  return { state, FakeGoogleGenAI };
});

vi.mock("@google/genai", () => ({ GoogleGenAI: genai.FakeGoogleGenAI }));

import { runCleanup } from "@/lib/cleanup/index";

const UPLOAD_DIR = path.join(process.cwd(), ".local-data", "test-cleanup-index-uploads");
const WORKFLOW_DIR = path.join(process.cwd(), ".local-data", "test-cleanup-index-workflow");

function touch(filePath: string, mtime: Date): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "x");
  fs.utimesSync(filePath, mtime, mtime);
}

beforeEach(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(WORKFLOW_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  vi.stubEnv("UPLOAD_DIR", UPLOAD_DIR);
  // No workflow data written for this run — exercises the "directory
  // doesn't exist yet" branch alongside the other sections.
  vi.stubEnv("WORKFLOW_LOCAL_DATA_DIR", WORKFLOW_DIR);
  vi.stubEnv("MAIL_PROVIDER", "fake");
  genai.state.listError = undefined;
});

afterEach(() => {
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  fs.rmSync(WORKFLOW_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("EPIC 9-1: runCleanup (lib/cleanup)", () => {
  it("한 항목(Gemini)이 오류가 나도 나머지 항목은 그대로 실행된다", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    genai.state.listError = new Error("network down");

    const now = new Date("2026-01-01T12:00:00Z");
    const oldUpload = path.join(UPLOAD_DIR, "job-old_meeting.mp3");
    touch(oldUpload, new Date(now.getTime() - 2 * 60 * 60 * 1000));

    const report = await runCleanup({ now, dryRun: false });

    expect(report.geminiFiles).toEqual({ deleted: 0, kept: 0, error: "GEMINI_LIST_FAILED" });
    // The other three sections ran normally despite the Gemini failure.
    expect(report.uploads).toEqual({ deleted: 1, kept: 0 });
    expect(fs.existsSync(oldUpload)).toBe(false);
    expect(report.workflowRuns).toEqual({ deleted: 0, kept: 0 });
    expect(report.mail).toEqual({ deleted: 0, kept: 0 });
  });

  it("dryRun이면 report.dryRun이 true이고 실제로는 아무것도 지우지 않는다", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("GEMINI_API_KEY", "");

    const now = new Date("2026-01-01T12:00:00Z");
    const oldUpload = path.join(UPLOAD_DIR, "job-old_meeting.mp3");
    touch(oldUpload, new Date(now.getTime() - 2 * 60 * 60 * 1000));

    const report = await runCleanup({ now, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.startedAt).toBe(now.toISOString());
    expect(report.uploads).toEqual({ deleted: 1, kept: 0 });
    expect(fs.existsSync(oldUpload)).toBe(true);
    expect(report.geminiFiles).toEqual({ deleted: 0, kept: 0 });
    expect(report.mail).toEqual({ deleted: 0, kept: 0 });
  });
});
