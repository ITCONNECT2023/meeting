import { describe, expect, it } from "vitest";
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
});
