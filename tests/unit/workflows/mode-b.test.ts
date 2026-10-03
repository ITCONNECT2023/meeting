import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeSendWorkflow } from "@/workflows/send-mail";
import { stepSaveMinutesToJob, stepSendMail } from "@/workflows/steps";
import { getStore } from "@/lib/store";
import { createJob, getJob, updateJob } from "@/lib/store/jobs";
import * as jobsModule from "@/lib/store/jobs";
import { clearFakeSentEmails, getFakeSentEmails } from "@/lib/mail/smtp";
import * as smtpModule from "@/lib/mail/smtp";
import type { MeetingMinutes } from "@/lib/minutes/types";
import { POST as handleJobPost } from "@/app/api/jobs/[id]/route";
import { NextRequest } from "next/server";

const sampleMinutes: MeetingMinutes = {
  title: "바로 보내기 테스트 회의",
  date: "2026-09-27",
  attendees: ["팀원1", "팀원2"],
  summary: ["바로 보내기 흐름 검증"],
  decisions: [{ text: "자동 발송 규칙 적용", ts: "05:10" }],
  todos: [{ task: "자동화 테스트 확인", owner: "팀원1", due: "오늘", ts: "08:20" }],
  script: [{ ts: "00:00", speaker: "팀원1", text: "테스트를 시작합니다." }],
};

describe("EPIC 8: Mode B (바로 보내기) Unit Tests", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_DRIVER", "memory");
    vi.stubEnv("MAIL_PROVIDER", "fake");
    vi.stubEnv("MAIL_ALLOWLIST", "");
    clearFakeSentEmails();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stepSaveMinutesToJob sets status to processing and send step to running for Mode B", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });

    await stepSaveMinutesToJob(job.id, sampleMinutes, 0);

    const updated = await getJob(job.id);
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe("processing");
    expect(updated?.steps.minutes?.status).toBe("completed");
    expect(updated?.steps.send?.status).toBe("running");
  });

  it("executeSendWorkflow marks send step completed on success in Mode B", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });

    await updateJob(job.id, {
      status: "processing",
      minutes: sampleMinutes,
      steps: {
        ...job.steps,
        minutes: { status: "completed" },
        send: { status: "running" },
      },
    });

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(true);
    expect(res.job.status).toBe("sent");
    expect(res.job.steps.send?.status).toBe("completed");
    expect(res.recipientResults[0].status).toBe("sent");
  });

  it("deletes job automatically when clientLeft is true upon send completion", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });

    await updateJob(job.id, {
      status: "processing",
      minutes: sampleMinutes,
      clientLeft: true,
    });

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(true);

    // Job should be deleted from store
    const jobAfter = await getJob(job.id);
    expect(jobAfter).toBeNull();
  });

  it("handles outright refusal (접수 거절) in Mode B by setting status to sent with all recipients failed", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user1@company.com", "user2@company.com"],
    });

    await updateJob(job.id, {
      status: "processing",
      minutes: sampleMinutes,
    });

    // Mock sendEmail to throw an outright refusal error
    vi.spyOn(smtpModule, "sendEmail").mockRejectedValueOnce(
      new Error("SMTP Connection refused"),
    );

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(false);
    expect(res.job.status).toBe("sent");
    expect(res.job.steps.send?.status).toBe("completed");
    expect(res.recipientResults).toHaveLength(2);
    expect(res.recipientResults.every((r) => r.status === "failed")).toBe(true);
    expect(res.recipientResults[0].errorReason).toBe("서비스 일시 장애");

    const savedJob = await getJob(job.id);
    expect(savedJob?.status).toBe("sent");
    expect(savedJob?.recipientResults?.every((r) => r.status === "failed")).toBe(true);
  });

  it("POST /api/jobs/[id]?clientLeft=1 updates clientLeft: true for Mode B without deleting", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}?clientLeft=1`, {
      method: "POST",
    });

    const res = await handleJobPost(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.clientLeft).toBe(true);

    const currentJob = await getJob(job.id);
    expect(currentJob).not.toBeNull();
    expect(currentJob?.clientLeft).toBe(true);
  });

  it("POST /api/jobs/[id]?clientLeft=1 deletes right away when the B job already finished (sent)", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });
    await updateJob(job.id, {
      status: "sent",
      minutes: sampleMinutes,
      recipientResults: [{ email: "user@company.com", status: "sent" }],
      steps: { ...job.steps, send: { status: "completed" } },
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}?clientLeft=1`, {
      method: "POST",
    });
    const res = await handleJobPost(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(true);

    expect(await getJob(job.id)).toBeNull();
  });

  it("POST /api/jobs/[id]?clientLeft=1 deletes right away when the B job already finished (failed)", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });
    await updateJob(job.id, {
      status: "failed",
      error: "TRANSCRIBE_FAILED",
      errorMessage: "스크립트를 만들지 못했습니다.",
    });

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}?clientLeft=1`, {
      method: "POST",
    });
    const res = await handleJobPost(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(true);

    expect(await getJob(job.id)).toBeNull();
  });

  it("POST /api/jobs/[id]?clientLeft=1 closes the race: deletes if the job finishes between marking clientLeft and the recheck", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "test_b.mp3", size: 2048 },
      meetingInfo: { title: "Mode B Test" },
      recipients: ["user@company.com"],
    });

    // Route's first read sees the job still in flight; by the time it
    // re-reads (right after marking clientLeft), the workflow's own final
    // write has landed — simulating the send finishing in that gap.
    const getJobSpy = vi.spyOn(jobsModule, "getJob");
    getJobSpy.mockImplementationOnce(async () => ({ ...job, status: "processing" }));
    getJobSpy.mockImplementationOnce(async () => ({
      ...job,
      status: "sent",
      clientLeft: true,
    }));

    const req = new NextRequest(`http://localhost/api/jobs/${job.id}?clientLeft=1`, {
      method: "POST",
    });
    const res = await handleJobPost(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(true);

    // Real store underneath: the job is actually gone, not just flagged.
    getJobSpy.mockRestore();
    expect(await getJob(job.id)).toBeNull();
  });

  it("발송 단계가 다시 실행돼도(서버 재시작·Workflow 재시도) 메일은 한 통만 나간다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const job = await createJob({
        mode: "b",
        audio: { name: "test_b.mp3", size: 2048 },
        meetingInfo: { title: "Mode B Test" },
        recipients: ["user1@company.com", "user2@company.com"],
      });
      await stepSaveMinutesToJob(job.id, sampleMinutes, 0);

      await stepSendMail(job.id);
      expect(getFakeSentEmails()).toHaveLength(1);

      // 첫 실행을 돌리던 서버가 반송 확인 전에 멈췄다: 잠금은 만료되어 사라지고
      // 주소는 "확인 중"으로 남아 있다. Workflow가 같은 단계를 다시 실행한다.
      await getStore().del(`job:lock:send:${job.id}`);
      await stepSendMail(job.id);

      expect(getFakeSentEmails()).toHaveLength(1);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });
});
