import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/jobs/route";
import {
  SEND_LOCK_TTL_SECONDS,
  createJob,
  deleteJob,
  getJob,
  lockJobSend,
  lockJobStart,
  unlockJobSend,
  updateJob,
} from "@/lib/store/jobs";
import { getStore } from "@/lib/store";
import type { JobInput } from "@/lib/validation/input";

const validJobInput: JobInput = {
  mode: "a",
  audio: {
    name: "meeting.mp3",
    size: 1024 * 1024,
    durationSec: 1800,
  },
  meetingInfo: {
    title: "기능 회의",
    date: "2026-09-22T14:00",
    attendees: ["김민수", "이지은"],
  },
  recipients: ["minsu@example.com", "jieun@example.com"],
};

beforeEach(() => {
  vi.stubEnv("STORE_DRIVER", "memory");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lib/store/jobs", () => {
  it("creates a job with unguessable random ID and initial state", async () => {
    const job = await createJob(validJobInput);

    expect(job.id).toBeDefined();
    expect(job.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(job.mode).toBe("A");
    expect(job.fileName).toBe("meeting.mp3");
    expect(job.fileSize).toBe(1024 * 1024);
    expect(job.status).toBe("processing");
    expect(job.steps.upload.status).toBe("pending");
    expect(job.steps.transcribe.status).toBe("pending");
    expect(job.steps.minutes.status).toBe("pending");
    expect(job.steps.send).toBeUndefined(); // Mode A has no send step in processing screen

    const fetched = await getJob(job.id);
    expect(fetched).toEqual(job);
  });

  it("creates mode B job with send step", async () => {
    const job = await createJob({ ...validJobInput, mode: "b" });
    expect(job.mode).toBe("B");
    expect(job.steps.send).toBeDefined();
    expect(job.steps.send?.status).toBe("pending");
  });

  it("updates job record and steps", async () => {
    const job = await createJob(validJobInput);
    const updated = await updateJob(job.id, {
      status: "review",
      steps: {
        ...job.steps,
        upload: { status: "completed" },
      },
    });

    expect(updated?.status).toBe("review");
    expect(updated?.steps.upload.status).toBe("completed");

    const fetched = await getJob(job.id);
    expect(fetched?.status).toBe("review");
  });

  it("deletes a job cleanly", async () => {
    const job = await createJob(validJobInput);
    const deleted = await deleteJob(job.id);
    expect(deleted).toBe(true);

    const fetched = await getJob(job.id);
    expect(fetched).toBeNull();
  });

  it("does not resurrect a deleted job via updateJob (F11/TRD4 cleanup race)", async () => {
    const job = await createJob(validJobInput);
    await deleteJob(job.id);

    const result = await updateJob(job.id, { status: "sent" });
    expect(result).toBeNull();

    // A late write (e.g. background bounce resolution racing a client-left
    // delete) must not bring the job back.
    const fetched = await getJob(job.id);
    expect(fetched).toBeNull();
  });

  it("locks job start so it only starts once", async () => {
    const job = await createJob(validJobInput);

    const first = await lockJobStart(job.id);
    expect(first).toBe(true);

    const second = await lockJobStart(job.id);
    expect(second).toBe(false);
  });
});

describe("POST /api/jobs route", () => {
  it("rejects non-JSON requests with 415", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("rejects invalid JSON with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ invalid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects schema validation errors with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "a",
        audio: { name: "invalid.mp4", size: 100 },
        recipients: ["not-an-email"],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_FAILED");
  });

  it("creates a job on valid input and returns 201 with job", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validJobInput),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.job).toBeDefined();
    expect(json.job.id).toBeDefined();
    expect(json.job.fileName).toBe("meeting.mp3");
  });
});

describe("send lock (FRD 3-4, EPIC 7-4)", () => {
  it("gives each holder its own token; a second request can't take a held lock", async () => {
    const job = await createJob(validJobInput);
    const first = await lockJobSend(job.id);
    expect(typeof first).toBe("string");
    await expect(lockJobSend(job.id)).resolves.toBeNull();
    await unlockJobSend(job.id, first!);
    await expect(lockJobSend(job.id)).resolves.toEqual(expect.any(String));
  });

  it("a stale holder whose lock expired can't release the next holder's lock", async () => {
    const job = await createJob(validJobInput);

    const stale = await lockJobSend(job.id);
    expect(stale).toBeTruthy();

    // The first send took longer than its lock: the lock expired (same as
    // the key disappearing) and a second send took over.
    await getStore().del(`job:lock:send:${job.id}`);
    const current = await lockJobSend(job.id);
    expect(current).toBeTruthy();

    // The slow first send finally finishes and "releases" its lock — this
    // must not open the door for a third, concurrent send.
    await unlockJobSend(job.id, stale!);
    await expect(lockJobSend(job.id)).resolves.toBeNull();

    await unlockJobSend(job.id, current!);
    await expect(lockJobSend(job.id)).resolves.toEqual(expect.any(String));
  });

  it("keeps the send lock long enough to cover the 2-minute bounce check", () => {
    expect(SEND_LOCK_TTL_SECONDS).toBeGreaterThanOrEqual(15 + 120 + 60);
  });
});
