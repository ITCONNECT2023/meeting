import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { executeSendWorkflow } from "@/workflows/send-mail";
import { createJob, getJob, updateJob } from "@/lib/store/jobs";
import { clearFakeSentEmails, getFakeSentEmails } from "@/lib/mail/smtp";
import type { MeetingMinutes } from "@/lib/minutes/types";

const sampleMinutes: MeetingMinutes = {
  title: "기능 개발 회의",
  date: "2026-09-22",
  attendees: ["김민수", "이지은"],
  summary: ["신규 기능 범위 논의"],
  decisions: [{ text: "MVP 범위 확정", ts: "12:34" }],
  todos: [{ task: "API 문서 작성", owner: "김민수", due: "10월 10일", ts: "15:20" }],
  script: [{ ts: "00:00", speaker: "김민수", text: "시작합시다." }],
};

describe("workflows/send-mail", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_DRIVER", "memory");
    vi.stubEnv("MAIL_PROVIDER", "fake");
    vi.stubEnv("MAIL_ALLOWLIST", "");
    clearFakeSentEmails();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends email to all recipients and resolves status", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["user1@test.com", "user2@test.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(true);
    expect(res.job.status).toBe("sent");
    expect(res.recipientResults).toHaveLength(2);
    expect(res.recipientResults.every((r) => r.status === "sent")).toBe(true);

    const sent = getFakeSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["user1@test.com", "user2@test.com"]);
    expect(sent[0].subject).toBe("[회의록] 기능 개발 회의 (2026-09-22)");
    expect(sent[0].attachments?.[0].filename).toBe("회의록_2026-09-22.md");
  });

  it("handles partial failure and records bounce reasons", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["ok@test.com", "fail@test.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(true);

    const okResult = res.recipientResults.find((r) => r.email === "ok@test.com");
    expect(okResult?.status).toBe("sent");

    const failResult = res.recipientResults.find((r) => r.email === "fail@test.com");
    expect(failResult?.status).toBe("failed");
    expect(failResult?.errorReason).toBe("주소를 찾을 수 없음");
  });

  it("retries ONLY failed recipients without duplicate dispatch to sent recipients", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["ok@test.com", "fail@test.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    // First send
    await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(getFakeSentEmails()).toHaveLength(1);
    expect(getFakeSentEmails()[0].to).toEqual(["ok@test.com", "fail@test.com"]);

    clearFakeSentEmails();

    // Retry send
    const retryRes = await executeSendWorkflow(job.id, {
      isRetry: true,
      immediateResolve: true,
    });

    expect(retryRes.ok).toBe(true);
    // Only fail@test.com was targeted on retry!
    const sent = getFakeSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["fail@test.com"]);
  });

  it("prevents concurrent dispatches using lockJobSend", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["user@test.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    // Launch two sends simultaneously
    const p1 = executeSendWorkflow(job.id, { immediateResolve: true });
    const p2 = executeSendWorkflow(job.id, { immediateResolve: true });

    const results = await Promise.allSettled([p1, p2]);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason.message).toContain("이미 발송 중입니다");
    }
  });

  it("handles outright SMTP rejection by keeping review status and releasing lock", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["smtp-reject@test.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    await expect(
      executeSendWorkflow(job.id, { immediateResolve: true })
    ).rejects.toThrow("Gmail 접수 거절");

    // Check that job status remained "review"
    const currentJob = await getJob(job.id);
    expect(currentJob?.status).toBe("review");

    // Verify lock was released so user can retry
    const res = await executeSendWorkflow(job.id, {
      immediateResolve: true,
    }).catch((e) => e);
    // It should not throw "이미 발송 중입니다"
    expect(res.message).not.toContain("이미 발송 중입니다");
  });
});
