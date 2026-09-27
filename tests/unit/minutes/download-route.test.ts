import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/jobs/[id]/download/route";
import { createJob, updateJob } from "@/lib/store/jobs";
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

describe("GET /api/jobs/[id]/download", () => {
  it("returns 410 EXPIRED when job does not exist or has expired", async () => {
    const req = new NextRequest("http://localhost:3000/api/jobs/non-existent-id/download");
    const res = await GET(req, { params: Promise.resolve({ id: "non-existent-id" }) });

    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.code).toBe("EXPIRED");
    expect(data.message).toBe("보관 시간(24시간)이 지나 회의록이 삭제되었습니다. 녹음을 다시 올려 주세요.");
  });

  it("returns 400 when minutes are not ready yet", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "test.mp3", size: 1000 },
      meetingInfo: {},
      recipients: ["user@example.com"],
    });

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}/download`);
    const res = await GET(req, { params: Promise.resolve({ id: job.id }) });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe("JOB_NOT_READY");
  });

  it("returns 200 with markdown file and attachment header when job is completed", async () => {
    const job = await createJob({
      mode: "a",
      audio: { name: "test.mp3", size: 1000 },
      meetingInfo: {},
      recipients: ["user@example.com"],
    });

    await updateJob(job.id, {
      status: "review",
      minutes: sampleMinutes,
    });

    const req = new NextRequest(`http://localhost:3000/api/jobs/${job.id}/download`);
    const res = await GET(req, { params: Promise.resolve({ id: job.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const disposition = res.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(decodeURIComponent(disposition || "")).toContain("회의록_2026-09-22.md");

    const text = await res.text();
    expect(text).toContain("# 신규 기능 출시 일정 회의");
    expect(text).toContain("- **일시:** 2026-09-22 14:00");
    expect(text).toContain("이 회의록은 녹음을 바탕으로 AI가 작성했습니다.");
  });
});
