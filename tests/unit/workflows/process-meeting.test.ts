import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET } from "@/app/api/jobs/[id]/route";
import { POST as uploadPOST } from "@/app/api/upload/route";
import { LocalStorageDriver } from "@/lib/storage/local";
import { createJob, getJob } from "@/lib/store/jobs";
import type { JobInput } from "@/lib/validation/input";
import { processMeetingWorkflow } from "@/workflows/process-meeting";
import { startProcessMeeting } from "@/workflows/runner";

const TEST_UPLOAD_DIR = path.join(process.cwd(), ".local-data", "test-wf-uploads");

const testJobInput: JobInput = {
  mode: "a",
  audio: {
    name: "test_meeting.mp3",
    size: 1024,
  },
  meetingInfo: {
    title: "스프린트 회의",
    date: "2026-09-22T14:00",
    attendees: ["김민수", "이지은"],
  },
  recipients: ["user@example.com"],
};

beforeEach(() => {
  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true });
  vi.stubEnv("UPLOAD_DIR", TEST_UPLOAD_DIR);
  vi.stubEnv("STORE_DRIVER", "memory");
  vi.stubEnv("AI_PROVIDER", "fake");
});

afterEach(() => {
  if (fs.existsSync(TEST_UPLOAD_DIR)) {
    fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
});

describe("processMeetingWorkflow", () => {
  it("processes meeting successfully and deletes audio file immediately after transcribe", async () => {
    const job = await createJob(testJobInput);
    const storage = new LocalStorageDriver(TEST_UPLOAD_DIR);

    // Save audio file
    await storage.saveAudio(job.id, job.fileName, Buffer.from("dummy audio"));
    expect(await storage.countUploads()).toBe(1);

    // Run workflow
    const result = await processMeetingWorkflow(job.id);
    expect(result.ok).toBe(true);

    // Verify audio file is deleted immediately (0 files remaining)
    expect(await storage.countUploads()).toBe(0);

    // Verify job status and generated minutes
    const finishedJob = await getJob(job.id);
    expect(finishedJob?.status).toBe("review");
    expect(finishedJob?.steps.transcribe.status).toBe("completed");
    expect(finishedJob?.steps.minutes.status).toBe("completed");
    expect(finishedJob?.minutes).toBeDefined();
    expect(finishedJob?.minutes?.title).toBe("스프린트 회의");
    expect(finishedJob?.minutes?.script.length).toBeGreaterThan(0);
  });

  it("handles _fail file by marking transcribe step failed and deleting audio", async () => {
    const job = await createJob({
      ...testJobInput,
      audio: { name: "meeting_fail.mp3", size: 1024 },
    });
    const storage = new LocalStorageDriver(TEST_UPLOAD_DIR);

    await storage.saveAudio(job.id, "meeting_fail.mp3", Buffer.from("dummy audio"));
    expect(await storage.countUploads()).toBe(1);

    const result = await processMeetingWorkflow(job.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("TRANSCRIBE_FAILED");

    // Audio file must still be deleted
    expect(await storage.countUploads()).toBe(0);

    const failedJob = await getJob(job.id);
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.steps.transcribe.status).toBe("failed");
    expect(failedJob?.steps.transcribe.errorMessage).toBe(
      "스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  });

  it("prevents double execution with startProcessMeeting", async () => {
    const job = await createJob(testJobInput);
    const first = await startProcessMeeting(job.id);
    expect(first).toBe(true);

    const second = await startProcessMeeting(job.id);
    expect(second).toBe(false);
  });
});

describe("API /api/upload and /api/jobs/[id]", () => {
  it("POST /api/upload handles multipart upload and updates job", async () => {
    const job = await createJob(testJobInput);

    const formData = new FormData();
    formData.append("jobId", job.id);
    formData.append(
      "file",
      new File([Buffer.from("dummy content")], "meeting.mp3", { type: "audio/mpeg" }),
    );

    const req = new NextRequest("http://localhost:3000/api/upload", {
      method: "POST",
      body: formData,
    });

    const res = await uploadPOST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);

    // Job upload step must be completed
    const updated = await getJob(job.id);
    expect(updated?.steps.upload.status).toBe("completed");
  });

  it("GET /api/jobs/[id] returns job record and 410 when not found", async () => {
    const job = await createJob(testJobInput);

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}`);
    const res = await GET(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.job.id).toBe(job.id);

    const missingReq = new NextRequest("http://localhost:3000/api/jobs/nonexistent");
    const missingRes = await GET(missingReq, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(missingRes.status).toBe(410);
  });

  it("DELETE /api/jobs/[id] deletes job and audio", async () => {
    const job = await createJob(testJobInput);

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}`, { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);

    const fetched = await getJob(job.id);
    expect(fetched).toBeNull();
  });
});
