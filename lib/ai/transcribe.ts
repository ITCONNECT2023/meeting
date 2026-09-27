import { fakeTranscribe, type TranscribeInput, type TranscribeOutput } from "./fake";

export type { TranscribeInput, TranscribeOutput };

export async function transcribeAudio(input: TranscribeInput): Promise<TranscribeOutput> {
  const provider = process.env.AI_PROVIDER?.toLowerCase() ?? "fake";

  if (provider === "fake") {
    return fakeTranscribe(input);
  }

  if (provider === "gemini") {
    // EPIC 5 will implement the real Gemini transcribe
    const { geminiTranscribe } = await import("./gemini");
    return geminiTranscribe(input);
  }

  throw new Error(`Unknown AI_PROVIDER: ${provider}`);
}
