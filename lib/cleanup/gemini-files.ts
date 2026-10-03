/**
 * EPIC 9-1: Gemini file-store cleanup (TRD 4 "어디에 얼마나 남는가").
 *
 * `lib/ai/gemini.ts` already deletes each recording right after it's used
 * (success or failure); this is the backstop for the case that never runs
 * (a crashed process, EPIC 5's own retry giving up mid-way). Gemini itself
 * auto-deletes files after 48 hours, but the TRD asks for 1 hour here so
 * leftovers don't sit around that long.
 *
 * Self-contained on purpose: builds its own tiny Gemini client instead of
 * importing `lib/ai/gemini.ts`, which EPIC 5 may still be changing, and
 * which pulls in "@/lib/minutes/types" etc. via "@/" aliases that plain
 * Node (this runs under `npm run cleanup`, no Next bundler) can't resolve.
 * Relative ".ts" imports only, no "@/" alias, no "server-only".
 */

import { GoogleGenAI } from "@google/genai";

import type { CleanupSectionResult } from "./types.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface GeminiFileInfo {
  name: string;
  createTime?: string;
}

function isFakeProvider(): boolean {
  return (process.env.AI_PROVIDER ?? "").trim().toLowerCase() === "fake";
}

function getApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? "").trim();
}

function getClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: 30_000 } });
}

/** Lists every file currently in the Gemini file store for this API key. */
export async function listGeminiFiles(apiKey: string): Promise<GeminiFileInfo[]> {
  const ai = getClient(apiKey);
  const pager = await ai.files.list();
  const files: GeminiFileInfo[] = [];
  for await (const file of pager) {
    if (file.name) {
      files.push({ name: file.name, createTime: file.createTime ?? undefined });
    }
  }
  return files;
}

export async function deleteGeminiFile(apiKey: string, name: string): Promise<void> {
  const ai = getClient(apiKey);
  await ai.files.delete({ name });
}

export async function cleanupGeminiFiles(now: Date, dryRun: boolean): Promise<CleanupSectionResult> {
  const apiKey = getApiKey();
  if (isFakeProvider() || apiKey === "") {
    return { deleted: 0, kept: 0 };
  }

  let files: GeminiFileInfo[];
  try {
    files = await listGeminiFiles(apiKey);
  } catch {
    return { deleted: 0, kept: 0, error: "GEMINI_LIST_FAILED" };
  }

  let deleted = 0;
  let kept = 0;

  for (const file of files) {
    const createdAt = file.createTime ? new Date(file.createTime).getTime() : NaN;
    if (!Number.isFinite(createdAt) || now.getTime() - createdAt <= ONE_HOUR_MS) {
      kept++;
      continue;
    }

    if (dryRun) {
      deleted++;
      continue;
    }

    try {
      await deleteGeminiFile(apiKey, file.name);
      deleted++;
    } catch {
      // Still there — don't count it as gone.
      kept++;
    }
  }

  return { deleted, kept };
}
