import { fakeWriteMinutes, type WriteMinutesInput, type WriteMinutesOutput } from "./fake";

export type { WriteMinutesInput, WriteMinutesOutput };

export async function writeMeetingMinutes(input: WriteMinutesInput): Promise<WriteMinutesOutput> {
  const provider = process.env.AI_PROVIDER?.toLowerCase() ?? "fake";

  if (provider === "fake") {
    return fakeWriteMinutes(input);
  }

  if (provider === "gemini") {
    // EPIC 5 will implement the real Gemini write minutes
    const { geminiWriteMinutes } = await import("./gemini");
    return geminiWriteMinutes(input);
  }

  throw new Error(`Unknown AI_PROVIDER: ${provider}`);
}
