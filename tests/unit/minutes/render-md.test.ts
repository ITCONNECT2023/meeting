import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/lib/minutes/render-md";
import type { MeetingMinutes } from "@/lib/minutes/types";

describe("renderMarkdown", () => {
  const prdExampleMinutes: MeetingMinutes = {
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
      { ts: "00:00", speaker: "김민수", text: "시작하겠습니다. 오늘은 출시 일정 얘기부터 하죠." },
      { ts: "00:07", speaker: "이지은", text: "네, 개발 쪽 일정부터 공유드릴게요." },
      { ts: "00:15", speaker: "화자3", text: "..." },
    ],
  };

  const expectedPrd51Body = `# 신규 기능 출시 일정 회의

- **일시:** 2026-09-22 14:00
- **참석자:** 김민수, 이지은, 화자3

## 요약
- 신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.
- 마케팅 자료는 출시 1주 전까지 준비하기로 했다.

## 결정사항
1. 출시일을 10월 15일로 확정한다. \`[12:34]\`
2. QA 기간은 5일로 한다. \`[18:02]\`

## 할 일
| 할 일 | 담당자 | 기한 | 근거 |
|---|---|---|---|
| 출시 공지 초안 작성 | 이지은 | 10월 8일 | \`[21:45]\` |
| 보고서 정리 | 김민수 | 미정 | \`[23:10]\` |
| 테스트 계정 준비 | 미정 | 미정 | \`[25:31]\` |

## 전체 스크립트
[00:00] 김민수: 시작하겠습니다. 오늘은 출시 일정 얘기부터 하죠.
[00:07] 이지은: 네, 개발 쪽 일정부터 공유드릴게요.
[00:15] 화자3: ...`;

  it("matches PRD 5-1 example body character-for-character when disclaimer is omitted", () => {
    const md = renderMarkdown(prdExampleMinutes, { includeAiDisclaimer: false });
    expect(md).toBe(expectedPrd51Body);
  });

  it("appends default AI disclaimer at the end when unmodified", () => {
    const md = renderMarkdown(prdExampleMinutes);
    const expected = `${expectedPrd51Body}

이 회의록은 녹음을 바탕으로 AI가 작성했습니다.`;
    expect(md).toBe(expected);
  });

  it("appends modified notice to AI disclaimer when (수정됨) is present", () => {
    const editedMinutes: MeetingMinutes = {
      ...prdExampleMinutes,
      todos: [
        ...prdExampleMinutes.todos.slice(0, 1),
        { task: "보고서 정리", owner: "김민수", due: "10월 10일 (수정됨)", ts: "23:10" },
        ...prdExampleMinutes.todos.slice(2),
      ],
    };

    const md = renderMarkdown(editedMinutes);
    expect(md).toContain("10월 10일 (수정됨)");
    expect(md).toContain(
      "이 회의록은 녹음을 바탕으로 AI가 작성했습니다. `(수정됨)` 표시는 검토자가 고친 부분입니다."
    );
  });

  it("handles empty sections with '없음' or '미정'", () => {
    const emptyMinutes: MeetingMinutes = {
      title: "비어 있는 회의",
      date: "미정",
      attendees: ["화자1"],
      summary: [],
      decisions: [],
      todos: [],
      script: [],
    };

    const md = renderMarkdown(emptyMinutes, { includeAiDisclaimer: false });
    expect(md).toContain("- **일시:** 미정");
    expect(md).toContain("## 요약\n- 없음");
    expect(md).toContain("## 결정사항\n없음");
    expect(md).toContain("## 할 일\n없음");
  });
});
