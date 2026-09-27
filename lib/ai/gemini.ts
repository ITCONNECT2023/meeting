import type { TranscribeInput, TranscribeOutput, WriteMinutesInput, WriteMinutesOutput } from "./fake";

export async function geminiTranscribe(_input: TranscribeInput): Promise<TranscribeOutput> {
  void _input;
  throw new Error("Gemini AI provider will be implemented in EPIC 5");
}

export async function geminiWriteMinutes(_input: WriteMinutesInput): Promise<WriteMinutesOutput> {
  void _input;
  throw new Error("Gemini AI provider will be implemented in EPIC 5");
}
