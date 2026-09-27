import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { assertWithinGeminiBudget, recordGeminiUsage } from "./budget.ts";
import { buildDiarizationPrompt, buildMinutesPrompt, buildTranscriptionPrompt } from "./prompts.ts";
import {
  convertLineNumbersToTimestamps,
  fillMinutesDefaults,
  validateTranscript,
} from "./validate.ts";
import type { TranscribeInput, TranscribeOutput, WriteMinutesInput, WriteMinutesOutput } from "./fake.ts";
import type { ScriptLine } from "../minutes/types.ts";
import { maskMinutes, maskScript } from "../privacy/mask.ts";

function getModelName(): string {
  return process.env.GEMINI_MODEL || "gemini-3.8-flash";
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const error = new Error("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    (error as { code?: string }).code = "TRANSCRIBE_FAILED";
    throw error;
  }
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 180_000 } });
}

export async function listGeminiFiles(): Promise<{ name: string; uri?: string }[]> {
  const ai = getGeminiClient();
  const pager = await ai.files.list();
  const files: { name: string; uri?: string }[] = [];
  for await (const file of pager) {
    if (file.name) {
      files.push({ name: file.name, uri: file.uri ?? undefined });
    }
  }
  return files;
}

async function callGeminiWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 4,
  baseDelayMs = 3000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes("503") ||
        msg.includes("429") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("high demand") ||
        msg.includes("RESOURCE_EXHAUSTED");
      if (isTransient && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(
          `[Gemini] 일시적인 사용량 급증/서비스 지연(503/429) 감지. ${delay}ms 후 재시도 (${attempt + 1}/${maxRetries})...`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

function getMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

export async function geminiTranscribe(input: TranscribeInput): Promise<TranscribeOutput> {
  const stepStart = Date.now();

  if (!fs.existsSync(input.filePath)) {
    const error = new Error("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
    (error as { code?: string }).code = "FILE_CORRUPT";
    throw error;
  }

  const model = getModelName();
  const ai = getGeminiClient();

  // Budget assertion: check before invoking real API
  await assertWithinGeminiBudget(100);

  const mimeType = getMimeType(input.fileName || input.filePath);
  let uploadedFileName: string | null = null;
  let filePart: { fileData: { fileUri: string; mimeType: string } } | null = null;

  try {
    // 5-1: Upload audio file to Gemini Files API
    try {
      const uploadResp = await ai.files.upload({
        file: input.filePath,
        config: { mimeType },
      });
      uploadedFileName = uploadResp.name ?? null;
      filePart = {
        fileData: {
          fileUri: uploadResp.uri ?? "",
          mimeType: uploadResp.mimeType || mimeType,
        },
      };
    } catch {
      const error = new Error("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
      (error as { code?: string }).code = "FILE_CORRUPT";
      throw error;
    }

    if (!filePart) {
      const error = new Error("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
      (error as { code?: string }).code = "FILE_CORRUPT";
      throw error;
    }

    // 5-2: Speaker diarization
    let speakerContext = "";
    try {
      const diarizationPrompt = buildDiarizationPrompt(input.attendees);
      const diarizationResp = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model,
          contents: [
            filePart!,
            diarizationPrompt,
          ],
          config: { responseMimeType: "application/json" },
        }),
      );

      const inputTokens = diarizationResp.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = diarizationResp.usageMetadata?.candidatesTokenCount ?? 0;
      await recordGeminiUsage({
        jobId: input.jobId,
        model,
        inputTokens,
        outputTokens,
      });

      const text = diarizationResp.text?.trim();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed.speakers && Array.isArray(parsed.speakers)) {
            speakerContext = parsed.speakers
              .map((s: { id: string; name: string }) => `${s.id} = ${s.name}`)
              .join("\n");
          }
        } catch {
          // Non-critical, fall back to empty speaker context
        }
      }
    } catch {
      // Continue to transcription even if diarization failed
    }

    // 5-3: Transcription with validation and retry
    const maxRetries = 2;
    let finalScript: ScriptLine[] = [];
    let transcribeSuccess = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const prompt = buildTranscriptionPrompt(speakerContext);
      const resp = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model,
          contents: [
            filePart!,
            prompt,
          ],
        }),
      );

      const inputTokens = resp.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;
      await recordGeminiUsage({
        jobId: input.jobId,
        model,
        inputTokens,
        outputTokens,
      });

      const rawText = resp.text?.trim() ?? "";
      if (!rawText || rawText === "NO_SPEECH") {
        const error = new Error("녹음에서 말소리를 찾지 못했습니다. 파일을 확인해 주세요.");
        (error as { code?: string }).code = "NO_SPEECH";
        throw error;
      }

      // Parse lines
      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
      const parsedScript: ScriptLine[] = [];
      const lineRegex = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s*(.*)$/;

      for (const line of lines) {
        const match = line.match(lineRegex);
        if (match) {
          parsedScript.push({
            ts: match[1],
            speaker: match[2].trim(),
            text: match[3].trim(),
          });
        }
      }

      if (parsedScript.length === 0) {
        if (attempt === maxRetries) {
          const error = new Error("녹음에서 말소리를 찾지 못했습니다. 파일을 확인해 주세요.");
          (error as { code?: string }).code = "NO_SPEECH";
          throw error;
        }
        continue;
      }

      const validation = validateTranscript(
        parsedScript,
        0,
        input.durationSeconds || 7200,
        input.durationSeconds,
      );

      if (validation.valid) {
        finalScript = parsedScript;
        transcribeSuccess = true;
        break;
      } else if (validation.reason === "NO_SPEECH") {
        const error = new Error("녹음에서 말소리를 찾지 못했습니다. 파일을 확인해 주세요.");
        (error as { code?: string }).code = "NO_SPEECH";
        throw error;
      }
    }

    if (!transcribeSuccess) {
      const error = new Error("스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      (error as { code?: string }).code = "TRANSCRIBE_FAILED";
      throw error;
    }

    // 5-3 e: Mask sensitive personal data
    const { script: maskedScript } = maskScript(finalScript);

    const elapsed = Date.now() - stepStart;
    if (elapsed > 240_000) {
      console.warn(`[Warning] Job ${input.jobId || "unknown"} transcribe took longer than 4 minutes: ${Math.round(elapsed / 1000)}s`);
    }

    return {
      script: maskedScript,
      durationSeconds: input.durationSeconds || 1500,
    };
  } finally {
    // 5-3: Gemini 녹음 파일은 성공·실패와 관계없이 항상 삭제
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName });
      } catch {
        // Ignore deletion errors on cleanup
      }
    }
  }
}

export async function geminiWriteMinutes(input: WriteMinutesInput): Promise<WriteMinutesOutput> {
  const stepStart = Date.now();
  const model = getModelName();
  const ai = getGeminiClient();

  await assertWithinGeminiBudget(50);

  // Number the script lines
  const numberedScript = input.script
    .map((line, idx) => {
      const numStr = `L${String(idx + 1).padStart(4, "0")}`;
      return `${numStr} [${line.ts}] ${line.speaker}: ${line.text}`;
    })
    .join("\n");

  const prompt = buildMinutesPrompt({
    title: input.title,
    attendees: input.attendees,
    numberedScript,
  });

  let rawMinutesData: {
    title?: string;
    summary?: string[];
    decisions?: { text: string; line: number }[];
    todos?: { task: string; owner: string; due: string; line: number }[];
  } | null = null;

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: "application/json" },
        }),
      );

      const inputTokens = resp.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;
      await recordGeminiUsage({
        jobId: input.jobId,
        model,
        inputTokens,
        outputTokens,
      });

      const text = resp.text?.trim();
      if (!text) continue;

      const parsed = JSON.parse(text);
      rawMinutesData = parsed;
      break;
    } catch {
      if (attempt === maxRetries) {
        const error = new Error("회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        (error as { code?: string }).code = "MINUTES_FAILED";
        throw error;
      }
    }
  }

  if (!rawMinutesData) {
    const error = new Error("회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    (error as { code?: string }).code = "MINUTES_FAILED";
    throw error;
  }

  // Convert line numbers to timestamps
  const decisionsRes = convertLineNumbersToTimestamps(
    rawMinutesData.decisions || [],
    input.script,
  );
  const todosRes = convertLineNumbersToTimestamps(
    rawMinutesData.todos || [],
    input.script,
  );

  const decisions = decisionsRes.items.map((d) => ({
    text: (d as { text?: string }).text || "",
    ts: d.ts || "근거 없음",
  }));

  const todos = todosRes.items.map((t) => ({
    task: (t as { task?: string }).task || "",
    owner: (t as { owner?: string }).owner || "미정",
    due: (t as { due?: string }).due || "미정",
    ts: t.ts || "근거 없음",
  }));

  // Fill defaults
  const filled = fillMinutesDefaults(
    {
      title: rawMinutesData.title,
      summary: rawMinutesData.summary || [],
      decisions,
      todos,
      script: input.script,
    },
    {
      title: input.title,
      date: input.date,
      attendees: input.attendees,
      recordedAt: input.recordedAt,
    },
  );

  // Apply privacy mask once more
  const { minutes: maskedMinutes } = maskMinutes(filled);

  const elapsed = Date.now() - stepStart;
  if (elapsed > 240_000) {
    console.warn(`[Warning] Job ${input.jobId || "unknown"} minutes took longer than 4 minutes: ${Math.round(elapsed / 1000)}s`);
  }

  return { minutes: maskedMinutes };
}
