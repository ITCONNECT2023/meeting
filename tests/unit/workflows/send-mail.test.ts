import os from "node:os";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Real SMTP / IMAP are never contacted: both libraries are replaced.
const real = vi.hoisted(() => ({
  sendMail: vi.fn(async (opts: { messageId?: string }) => ({ messageId: opts.messageId })),
  imapConstructed: vi.fn(),
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: real.sendMail }) },
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor() {
      real.imapConstructed();
    }
    async connect() {
      throw new Error("no network in unit tests");
    }
  },
}));

import { executeSendWorkflow } from "@/workflows/send-mail";
import { createJob, deleteJob, getJob, updateJob } from "@/lib/store/jobs";
import { getStore } from "@/lib/store";
import * as smtpModule from "@/lib/mail/smtp";
import { clearFakeSentEmails, getFakeSentEmails } from "@/lib/mail/smtp";
import * as bounceModule from "@/lib/mail/bounce";
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

  it("background bounce resolution tolerates the job being deleted mid-flight, without throwing or recreating it", async () => {
    const job = await createJob({
      mode: "b",
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients: ["user@company.com"],
    });
    await updateJob(job.id, {
      status: "processing",
      minutes: sampleMinutes,
    });

    // Simulates app/api/jobs/[id]/route.ts deleting an already-finished B
    // job the instant its clientLeft signal arrives — right while this
    // in-flight bounce check is still running.
    vi.spyOn(bounceModule, "checkBouncesForJob").mockImplementation(async () => {
      await deleteJob(job.id);
      return new Map();
    });

    await expect(
      executeSendWorkflow(job.id, { immediateResolve: true }),
    ).resolves.toMatchObject({ ok: true });

    // Must not have been resurrected by the write that follows the bounce
    // check (lib/store/jobs.ts updateJob on a missing job returns null).
    expect(await getJob(job.id)).toBeNull();
  });
});

describe("workflows/send-mail — 중복 발송 막기 (FRD 3-4)", () => {
  beforeEach(() => {
    vi.stubEnv("STORE_DRIVER", "memory");
    vi.stubEnv("MAIL_PROVIDER", "fake");
    vi.stubEnv("MAIL_ALLOWLIST", "");
    clearFakeSentEmails();
    real.sendMail.mockClear();
    real.imapConstructed.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function readyJob(recipients: string[], mode: "a" | "b" = "a") {
    const job = await createJob({
      mode,
      audio: { name: "meeting.mp3", size: 1024 },
      meetingInfo: {},
      recipients,
    });
    await updateJob(job.id, { status: "review", minutes: sampleMinutes });
    return job;
  }

  it("'확인 중'(Gmail이 이미 접수) 주소에는 잠금이 풀린 뒤 다시 요청이 와도 보내지 않는다", async () => {
    const job = await readyJob(["a@test.com", "b@test.com"]);
    // 첫 발송은 접수됐지만 반송 확인이 끝나지 않은 채(서버 멈춤·잠금 만료) 남아 있다.
    await updateJob(job.id, {
      status: "sent",
      recipientResults: [
        { email: "a@test.com", status: "pending" },
        { email: "b@test.com", status: "pending" },
      ],
    });

    // 두 번째 탭이 검토 화면에서 「보내기」를 누른다.
    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(res.ok).toBe(true);
    expect(getFakeSentEmails()).toHaveLength(0);
  });

  it("Gmail이 접수한 직후 서버가 끊겨도, 다시 시도할 때 보낸편지함의 고유 번호를 보고 다시 보내지 않는다 (7-4)", async () => {
    const job = await readyJob(["a@test.com", "b@test.com"]);

    // 접수 결과("확인 중")를 저장하려는 순간 서버가 죽는다.
    const store = getStore();
    const originalSet = store.set.bind(store);
    let crashed = false;
    vi.spyOn(store, "set").mockImplementation(async (key, value, opts) => {
      const v = value as { recipientResults?: { status: string }[] };
      if (!crashed && key === `job:${job.id}` && v.recipientResults?.some((r) => r.status === "pending")) {
        crashed = true;
        throw new Error("process died");
      }
      return originalSet(key, value, opts);
    });

    await expect(executeSendWorkflow(job.id, { immediateResolve: true })).rejects.toThrow("process died");
    expect(getFakeSentEmails()).toHaveLength(1);
    vi.mocked(store.set).mockRestore();

    // 다시 시도 (사용자가 다시 누르거나 Workflow가 단계를 다시 실행)
    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(getFakeSentEmails()).toHaveLength(1);
    expect(res.recipientResults.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect((await getJob(job.id))?.status).toBe("sent");
  });

  it("접수 응답을 받지 못한 오류(실제로는 나감) 뒤 다시 보내도 한 통만 나간다 (A)", async () => {
    const job = await readyJob(["a@test.com"]);
    const realSend = smtpModule.sendEmail;
    vi.spyOn(smtpModule, "sendEmail").mockImplementationOnce(async (opts) => {
      await realSend(opts); // Gmail accepted it...
      throw new Error("Gmail 접수 실패: connection reset"); // ...but the reply was lost.
    });

    await expect(executeSendWorkflow(job.id, { immediateResolve: true })).rejects.toThrow();
    expect((await getJob(job.id))?.status).toBe("review");
    expect(getFakeSentEmails()).toHaveLength(1);

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });
    expect(getFakeSentEmails()).toHaveLength(1);
    expect(res.recipientResults).toEqual([{ email: "a@test.com", status: "sent" }]);
  });

  it("두 탭에서 동시에 「실패한 주소에 다시 보내기」를 눌러도 한 통만 나간다", async () => {
    const job = await readyJob(["ok@test.com", "retry@test.com"]);
    await updateJob(job.id, {
      status: "sent",
      recipientResults: [
        { email: "ok@test.com", status: "sent" },
        { email: "retry@test.com", status: "failed", errorReason: "일시적인 메일 서비스 문제" },
      ],
    });

    const results = await Promise.allSettled([
      executeSendWorkflow(job.id, { isRetry: true, immediateResolve: true }),
      executeSendWorkflow(job.id, { isRetry: true, immediateResolve: true }),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const sent = getFakeSentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["retry@test.com"]);

    // 뒤이어 한 번 더 눌러도 이미 "보냄"이 된 주소에는 보내지 않는다.
    await executeSendWorkflow(job.id, { isRetry: true, immediateResolve: true });
    expect(getFakeSentEmails()).toHaveLength(1);
  });

  it("로컬 실제 SMTP에서 허용 목록이 비어 있으면 모두 '보내지 못함'이고 Gmail 접수로 치지 않는다", async () => {
    vi.stubEnv("MAIL_PROVIDER", "smtp");
    vi.stubEnv("GMAIL_USER", "bot@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "not-a-real-password");
    vi.stubEnv("VERCEL_ENV", "");
    vi.spyOn(process, "cwd").mockReturnValue(os.tmpdir());
    const job = await readyJob(["a@test.com", "b@test.com"]);

    const res = await executeSendWorkflow(job.id, { immediateResolve: true });

    expect(real.sendMail).not.toHaveBeenCalled();
    expect(real.imapConstructed).not.toHaveBeenCalled(); // 반송을 찾을 메일이 없다
    expect(res.recipientResults).toHaveLength(2);
    for (const r of res.recipientResults) {
      expect(r.status).toBe("failed");
      expect(r.errorReason).toContain("MAIL_ALLOWLIST");
    }
    const saved = await getJob(job.id);
    expect(saved?.recipientResults?.every((r) => r.status === "failed")).toBe(true);
    expect(saved?.sendAttempt).toBeUndefined();

    // 「실패한 주소에 다시 보내기」도 같은 이유로 막히고, 잠금은 풀려 있다.
    const retry = await executeSendWorkflow(job.id, { isRetry: true, immediateResolve: true });
    expect(real.sendMail).not.toHaveBeenCalled();
    expect(retry.recipientResults.every((r) => r.status === "failed")).toBe(true);
  });
});
