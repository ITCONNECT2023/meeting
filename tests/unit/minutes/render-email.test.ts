import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/minutes/render-email";
import type { MeetingMinutes } from "@/lib/minutes/types";

describe("renderEmail (PRD 5-4, FRD F10)", () => {
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
      { ts: "12:34", speaker: "김민수", text: "그럼 출시일은 10월 15일로 확정하겠습니다." },
    ],
  };

  it("제목에 회의 제목과 YYYY-MM-DD 날짜를 포함한다", () => {
    const res = renderEmail({ minutes: sampleMinutes });
    expect(res.subject).toBe("[회의록] 신규 기능 출시 일정 회의 (2026-09-22)");
  });

  it("일시가 미정이면 제목 끝이 (미정)이 된다", () => {
    const res = renderEmail({ minutes: { ...sampleMinutes, date: "미정" } });
    expect(res.subject).toBe("[회의록] 신규 기능 출시 일정 회의 (미정)");
  });

  it("본문에 제목, 일시, 참석자, 요약, 결정사항, 할 일, AI 안내문구가 포함된다", () => {
    const res = renderEmail({ minutes: sampleMinutes });
    // Text body
    expect(res.text).toContain("신규 기능 출시 일정 회의");
    expect(res.text).toContain("2026-09-22 14:00");
    expect(res.text).toContain("김민수, 이지은, 화자3");
    expect(res.text).toContain("신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.");
    expect(res.text).toContain("출시일을 10월 15일로 확정한다.");
    expect(res.text).toContain("[12:34]");
    expect(res.text).toContain("출시 공지 초안 작성");
    expect(res.text).toContain("이지은");
    expect(res.text).toContain("10월 8일");
    expect(res.text).toContain("[21:45]");
    expect(res.text).toContain("이 회의록은 녹음을 바탕으로 AI가 작성했습니다.");

    // HTML body
    expect(res.html).toContain("신규 기능 출시 일정 회의");
    expect(res.html).toContain("2026-09-22 14:00");
    expect(res.html).toContain("출시일을 10월 15일로 확정한다.");
  });

  it("본문(text, html)에는 전체 스크립트가 절대 포함되지 않는다", () => {
    const res = renderEmail({ minutes: sampleMinutes });
    expect(res.text).not.toContain("## 전체 스크립트");
    expect(res.text).not.toContain("시작하겠습니다.");
    expect(res.html).not.toContain("전체 스크립트");
    expect(res.html).not.toContain("시작하겠습니다.");
  });

  it("첨부 파일에 전체 회의록 .md가 첨부되며 전체 스크립트가 들어 있다", () => {
    const res = renderEmail({ minutes: sampleMinutes, createdAt: "2026-09-22" });
    expect(res.attachment.filename).toBe("회의록_2026-09-22.md");
    expect(res.attachment.contentType).toContain("text/markdown");
    expect(res.attachment.content).toContain("## 전체 스크립트");
    expect(res.attachment.content).toContain("시작하겠습니다.");
  });

  it("(수정됨) 항목이 있으면 본문과 첨부파일에 (수정됨) 및 면책 고지가 추가된다", () => {
    const editedMinutes: MeetingMinutes = {
      ...sampleMinutes,
      todos: [
        {
          task: "출시 공지 초안 작성",
          owner: "이지은",
          due: "10월 10일 (수정됨)",
          ts: "21:45",
        },
      ],
    };

    const res = renderEmail({ minutes: editedMinutes });
    expect(res.text).toContain("10월 10일 (수정됨)");
    expect(res.text).toContain("`(수정됨)` 표시는 검토자가 고친 부분입니다.");
    expect(res.html).toContain("10월 10일 (수정됨)");
    expect(res.html).toContain("<strong>(수정됨)</strong> 표시는 검토자가 고친 부분입니다.");
    expect(res.attachment.content).toContain("10월 10일 (수정됨)");
    expect(res.attachment.content).toContain("`(수정됨)` 표시는 검토자가 고친 부분입니다.");
  });

  it("결정사항이나 할 일이 비어있으면 '없음'으로 표시된다", () => {
    const emptyMinutes: MeetingMinutes = {
      title: "간단 회의",
      date: "미정",
      attendees: [],
      summary: [],
      decisions: [],
      todos: [],
      script: [],
    };
    const res = renderEmail({ minutes: emptyMinutes });
    expect(res.text).toContain("없음");
    expect(res.html).toContain("없음");
  });
});
