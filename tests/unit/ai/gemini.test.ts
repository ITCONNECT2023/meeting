import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptLine } from "@/lib/minutes/types";

// Fake @google/genai client whose models.generateContent returns a canned
// response, in the same vi.hoisted + vi.mock style as
// tests/unit/cleanup/gemini-files.test.ts.
const genai = vi.hoisted(() => {
  const state = {
    minutesResponseText: undefined as string | undefined,
  };

  class FakeGoogleGenAI {
    models: {
      generateContent: (args: unknown) => Promise<{
        text: string;
        usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
      }>;
    };

    constructor() {
      this.models = {
        generateContent: async () => ({
          text: state.minutesResponseText ?? "",
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        }),
      };
    }
  }

  return { state, FakeGoogleGenAI };
});

vi.mock("@google/genai", () => ({ GoogleGenAI: genai.FakeGoogleGenAI }));

// geminiWriteMinutes also records usage to the real Gemini spend-tracking
// file (.local-data/gemini-budget.md). Stub it out so this unit test never
// writes fabricated token counts into that real, cost-tracking file.
vi.mock("@/lib/ai/budget", () => ({
  assertWithinGeminiBudget: vi.fn(async () => {}),
  recordGeminiUsage: vi.fn(async () => ({ costKrw: 0, totalCostKrw: 0 })),
}));

import { geminiTranscribe, geminiWriteMinutes } from "@/lib/ai/gemini";

describe("EPIC 5: Gemini AI 연결 단위 검사 (lib/ai/gemini)", () => {
  it("존재하지 않거나 손상된 오디오 파일은 FILE_CORRUPT 오류를 던진다", async () => {
    await expect(
      geminiTranscribe({
        filePath: "non-existent-file.mp3",
        fileName: "non-existent-file.mp3",
      }),
    ).rejects.toThrow("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
  });

  it("API 키가 없으면 TRANSCRIBE_FAILED 오류를 던진다", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      await expect(
        geminiWriteMinutes({
          script: [{ ts: "00:00", speaker: "화자1", text: "테스트" }],
        }),
      ).rejects.toThrow("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  describe("회의록 생성: 일부 결정사항/할 일의 근거 줄 번호가 잘못된 경우 (버그 회귀 방지)", () => {
    // Approximates the real transcript of the EPIC 5-6 synthetic sample
    // (.local-data/synthetic-audio/sample_meeting.mp3 / ground-truth.json):
    // 9 lines, 1 decision (line 5) and 3 todos (lines 6-8), plus a phone
    // number on the last line that must stay masked.
    const script: ScriptLine[] = [
      { ts: "00:00", speaker: "화자1", text: "안녕하세요. 신규 기능 출시 회의를 시작하겠습니다." },
      { ts: "00:05", speaker: "화자1", text: "지은 님 오셨나요?" },
      { ts: "00:10", speaker: "이지은", text: "네 민수 님, 개발 일정 준비되었습니다." },
      { ts: "00:16", speaker: "화자3", text: "화자3도 참석했습니다." },
      { ts: "00:22", speaker: "김민수", text: "그럼 출시일은 10월 15일로 확정하겠습니다." },
      { ts: "00:30", speaker: "이지은", text: "마케팅 공지 초안은 10월 8일까지 제가 준비할게요." },
      { ts: "00:40", speaker: "김민수", text: "보고서 정리는 제가 맡겠습니다. 기한은 미정으로 하죠." },
      { ts: "00:50", speaker: "화자3", text: "테스트 계정 준비도 누군가 해야 합니다. 담당자는 미정입니다." },
      { ts: "01:00", speaker: "김민수", text: "문의사항은 010-1234-5678로 연락 주세요. 회의를 마칩니다." },
    ];

    beforeEach(() => {
      process.env.GEMINI_API_KEY = "test-key";
      // Recorded-shape raw Gemini response (synthetic meeting content) where
      // one decision (line: 0) and one todo (line: 99) carry an
      // out-of-range/invalid evidence line — a realistic model slip. Before
      // the fix, a single bad "line" wiped every decision/todo in the whole
      // response (lib/ai/validate.ts convertLineNumbersToTimestamps early-
      // returning `items: []`), even though the other two todos and the
      // summary were perfectly valid.
      genai.state.minutesResponseText = JSON.stringify({
        title: "신규 기능 출시 회의",
        summary: [
          "신규 기능의 출시일을 10월 15일로 확정하였습니다.",
          "마케팅 공지 초안 작성, 보고서 정리, 테스트 계정 준비 등 향후 작업에 대해 논의하였습니다.",
        ],
        decisions: [{ text: "신규 기능 출시일을 10월 15일로 확정함", line: 0 }],
        todos: [
          { task: "마케팅 공지 초안 준비", owner: "이지은", due: "10월 8일", line: 6 },
          { task: "보고서 정리", owner: "김민수", due: "미정", line: 7 },
          { task: "테스트 계정 준비", owner: "미정", due: "미정", line: 99 },
        ],
      });
    });

    afterEach(() => {
      genai.state.minutesResponseText = undefined;
    });

    it("근거 줄 번호가 잘못된 항목만 '근거 없음'으로 처리하고, 나머지 결정사항/할 일은 그대로 보존한다", async () => {
      const res = await geminiWriteMinutes({
        script,
        title: "신규 기능 출시 회의",
        attendees: ["김민수", "이지은", "화자3"],
      });

      // 결정사항: 줄 번호(0)가 잘못됐어도 항목 자체는 사라지지 않는다.
      expect(res.minutes.decisions).toHaveLength(1);
      expect(res.minutes.decisions[0].text).toBe("신규 기능 출시일을 10월 15일로 확정함");
      expect(res.minutes.decisions[0].ts).toBe("근거 없음");

      // 할 일: 3건 모두 보존되고, 유효한 줄 번호만 올바른 시각으로 변환된다.
      expect(res.minutes.todos).toHaveLength(3);
      expect(res.minutes.todos[0].ts).toBe(script[5].ts);
      expect(res.minutes.todos[1].ts).toBe(script[6].ts);
      expect(res.minutes.todos[1].due).toBe("미정");
      expect(res.minutes.todos[2].ts).toBe("근거 없음");
      expect(res.minutes.todos[2].owner).toBe("미정");

      // 요약은 영향받지 않는다.
      expect(res.minutes.summary).toHaveLength(2);

      // 전화번호는 회의록 재생성 시에도 다시 마스킹된다 (FRD F12, 3-2).
      const lastScriptLine = res.minutes.script[res.minutes.script.length - 1];
      expect(lastScriptLine.text).not.toContain("010-1234-5678");
      expect(lastScriptLine.text).toContain("***");
    });
  });
});
