import "server-only";

import { getStore } from "./index";
import type { JobInput } from "@/lib/validation/input";
import type { JobRecord } from "@/lib/minutes/types";

export function getJobTtlSeconds(): number {
  const envVal = process.env.JOB_TTL_SECONDS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return 24 * 60 * 60; // 24 hours
}

function jobKey(id: string): string {
  return `job:${id}`;
}

function startLockKey(id: string): string {
  return `job:lock:start:${id}`;
}

export async function createJob(input: JobInput): Promise<JobRecord> {
  const store = getStore();
  const id = crypto.randomUUID();
  const now = Date.now();
  const mode = input.mode.toUpperCase() as "A" | "B";

  const record: JobRecord = {
    id,
    mode,
    fileName: input.audio.name,
    fileSize: input.audio.size,
    durationSeconds: input.audio.durationSec ?? undefined,
    createdAt: now,
    updatedAt: now,
    inputTitle: input.meetingInfo?.title,
    inputDate: input.meetingInfo?.date,
    inputAttendees: input.meetingInfo?.attendees,
    recipients: input.recipients,
    status: "processing",
    steps: {
      upload: { status: "pending" },
      transcribe: { status: "pending" },
      minutes: { status: "pending" },
      ...(mode === "B" ? { send: { status: "pending" } } : {}),
    },
  };

  await store.set(jobKey(id), record, { ttlSeconds: getJobTtlSeconds() });
  return record;
}

export async function getJob(id: string): Promise<JobRecord | null> {
  const store = getStore();
  return store.get<JobRecord>(jobKey(id));
}

export async function updateJob(
  id: string,
  updates: Partial<JobRecord>,
): Promise<JobRecord | null> {
  const store = getStore();
  const existing = await store.get<JobRecord>(jobKey(id));
  if (!existing) return null;

  const merged: JobRecord = {
    ...existing,
    ...updates,
    steps: {
      ...existing.steps,
      ...(updates.steps ?? {}),
    },
    updatedAt: Date.now(),
  };

  await store.set(jobKey(id), merged, { ttlSeconds: getJobTtlSeconds() });
  return merged;
}

export async function deleteJob(id: string): Promise<boolean> {
  const store = getStore();
  const existing = await store.get<JobRecord>(jobKey(id));
  await store.del(jobKey(id));
  await store.del(startLockKey(id));
  return existing !== null;
}

/**
 * Ensures a job is only started once.
 * Returns true if this is the first start request, false if already started.
 */
export async function lockJobStart(id: string): Promise<boolean> {
  const store = getStore();
  return store.setIfAbsent(startLockKey(id), true, {
    ttlSeconds: getJobTtlSeconds(),
  });
}
