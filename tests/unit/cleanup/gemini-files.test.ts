import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake @google/genai Files API that records what the code under test does
// with it, in the same vi.hoisted style as tests/unit/mail/retention.test.ts.
const genai = vi.hoisted(() => {
  interface FakeFile {
    name: string;
    createTime?: string;
  }

  const state = {
    files: [] as FakeFile[],
    deleted: [] as string[],
    listError: undefined as unknown,
    constructedApiKeys: [] as string[],
  };

  class FakeGoogleGenAI {
    files: {
      list: () => Promise<AsyncIterable<FakeFile>>;
      delete: (args: { name: string }) => Promise<void>;
    };

    constructor(config: { apiKey: string }) {
      state.constructedApiKeys.push(config.apiKey);
      this.files = {
        list: async () => {
          if (state.listError) throw state.listError;
          const items = [...state.files];
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const item of items) yield item;
            },
          };
        },
        delete: async ({ name }) => {
          state.deleted.push(name);
        },
      };
    }
  }

  return { state, FakeGoogleGenAI };
});

vi.mock("@google/genai", () => ({ GoogleGenAI: genai.FakeGoogleGenAI }));

import { cleanupGeminiFiles } from "@/lib/cleanup/gemini-files";

beforeEach(() => {
  genai.state.files = [];
  genai.state.deleted = [];
  genai.state.listError = undefined;
  genai.state.constructedApiKeys = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EPIC 9-1: Gemini 파일 저장소 청소 (lib/cleanup/gemini-files)", () => {
  it("AI_PROVIDER=fake이면 목록도 조회하지 않고 건드리지 않는다", async () => {
    vi.stubEnv("AI_PROVIDER", "fake");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    genai.state.files = [{ name: "files/a", createTime: new Date(0).toISOString() }];

    const result = await cleanupGeminiFiles(new Date(), false);

    expect(result).toEqual({ deleted: 0, kept: 0 });
    expect(genai.state.constructedApiKeys).toEqual([]);
  });

  it("GEMINI_API_KEY가 비어 있으면 건드리지 않는다", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "");

    const result = await cleanupGeminiFiles(new Date(), false);

    expect(result).toEqual({ deleted: 0, kept: 0 });
    expect(genai.state.constructedApiKeys).toEqual([]);
  });

  it("1시간이 지난 파일만 지우고, 안 지난 파일은 남긴다", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const now = new Date("2026-01-01T12:00:00Z");
    genai.state.files = [
      {
        name: "files/old",
        createTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      },
      {
        name: "files/new",
        createTime: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      },
    ];

    const result = await cleanupGeminiFiles(now, false);

    expect(result).toEqual({ deleted: 1, kept: 1 });
    expect(genai.state.deleted).toEqual(["files/old"]);
  });

  it("dryRun에서는 개수만 세고 실제로는 지우지 않는다", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const now = new Date("2026-01-01T12:00:00Z");
    genai.state.files = [
      {
        name: "files/old",
        createTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];

    const result = await cleanupGeminiFiles(now, true);

    expect(result).toEqual({ deleted: 1, kept: 0 });
    expect(genai.state.deleted).toEqual([]);
  });

  it("목록을 가져오지 못하면 GEMINI_LIST_FAILED 오류 코드만 남긴다", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    genai.state.listError = new Error("some internal detail that must never leak");

    const result = await cleanupGeminiFiles(new Date(), false);

    expect(result).toEqual({ deleted: 0, kept: 0, error: "GEMINI_LIST_FAILED" });
  });
});
