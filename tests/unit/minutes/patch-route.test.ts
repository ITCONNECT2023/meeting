import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "@/app/api/jobs/[id]/minutes/route";
import { createJob, getJob, updateJob } from "@/lib/store/jobs";
import type { MeetingMinutes } from "@/lib/minutes/types";

beforeEach(() => {
  vi.stubEnv("STORE_DRIVER", "memory");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const sampleMinutes: MeetingMinutes = {
  title: "신규 기능 출시 일정 회의",
  date: "2026-09-22 14:00",
  attendees: ["김민수", "이지은", "화자3"],
  summary: [
    "신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.",
    "마케팅 자료는 출시 1주 전까지 준비하기로 했다.",
  ],
  decisions: [
    { text: "출시일을 10월 15일로 확정한다.", ts: "12:34" },
    { text: "QA 기간은 5일로 한다.", ts: "18:02" },
  ],
  todos: [
    { task: "출시 공지 초안 작성", owner: "이지은", due: "10월 8일", ts: "21:45" },
    { task: "보고서 정리", owner: "김민수", due: "미정", ts: "23:10" },
    { task: "테스트 계정 준비", owner: "미정", due: "미정", ts: "25:31" },
  ],
  script: [
    { ts: "00:00", speaker: "김민수", text: "시작하겠습니다." },
  ],
};

describe("PATCH /api/jobs/[id]/minutes", () => {
  it("존재하지 않는 작업 ID는 410 EXPIRED를 반환한다", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs/missing-job-id/minutes", {
      method: "PATCH",
      body: JSON.stringify({ section: "summary", data: ["새 요약"] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "missing-job-id" }) });
    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.code).toBe("EXPIRED");
  });

  it("잘못된 구역 이름은 400을 반환한다", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "test.mp3", size: 1000 },
      meetingInfo: {},
      recipients: ["user@example.com"],
    });
    await updateJob(job.id, { minutes: sampleMinutes });

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}/minutes`, {
      method: "PATCH",
      body: JSON.stringify({ section: "invalid-section", data: {} }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_SECTION");
  });

  it("형식이 잘못된 일시는 400을 반환한다", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "test.mp3", size: 1000 },
      meetingInfo: {},
      recipients: ["user@example.com"],
    });
    await updateJob(job.id, { minutes: sampleMinutes });

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}/minutes`, {
      method: "PATCH",
      body: JSON.stringify({
        section: "meta",
        data: { title: "새 제목", date: "2026-99-99 10:00", attendees: "김민수" },
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_DATE");
    expect(data.message).toBe("일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.");
  });

  it("정상적인 할 일 편집 후 단일 저장소에 저장되고 (수정됨)이 반영된다", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "test.mp3", size: 1000 },
      meetingInfo: {},
      recipients: ["user@example.com"],
    });
    await updateJob(job.id, { minutes: sampleMinutes, durationSeconds: 1800 });

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}/minutes`, {
      method: "PATCH",
      body: JSON.stringify({
        section: "todos",
        data: [
          { task: "출시 공지 초안 작성", owner: "이지은", due: "10월 10일", ts: "21:45" },
        ],
      }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: job.id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.minutes.todos[0].due).toBe("10월 10일 (수정됨)");

    // Verify stored job
    const stored = await getJob(job.id);
    expect(stored?.minutes?.todos[0].due).toBe("10월 10일 (수정됨)");
  });
});
