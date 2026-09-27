import { describe, expect, it } from "vitest";
import {
  applyMetaEdits,
  applySummaryEdits,
  applyDecisionsEdits,
  applyTodosEdits,
  applyMinutesEdits,
} from "@/lib/minutes/apply-edits";
import type { MeetingMinutes } from "@/lib/minutes/types";

const BASE_MINUTES: MeetingMinutes = {
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
    { ts: "12:34", speaker: "김민수", text: "출시일 확정" },
  ],
};

const DURATION_SECONDS = 1800; // 30 minutes (30:00)

describe("6-1 apply-edits: 기본 정보(Meta) 편집", () => {
  it("제목을 비우면 원래 제목을 유지한다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "   ",
      date: "2026-09-22 14:00",
      attendees: "김민수, 이지은, 화자3",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.title).toBe("신규 기능 출시 일정 회의");
  });

  it("제목을 바꾸면 (수정됨)을 붙인다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "출시 일정 변경 회의",
      date: "2026-09-22 14:00",
      attendees: "김민수, 이지은, 화자3",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.title).toBe("출시 일정 변경 회의 (수정됨)");
  });

  it("일시를 비우면 '미정'으로 설정한다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "신규 기능 출시 일정 회의",
      date: "",
      attendees: "김민수, 이지은, 화자3",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.date).toBe("미정");
  });

  it("일시를 바꾸면 (수정됨)을 붙인다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "신규 기능 출시 일정 회의",
      date: "2026-09-30 10:00",
      attendees: "김민수, 이지은, 화자3",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.date).toBe("2026-09-30 10:00 (수정됨)");
  });

  it("일시 형식이 틀리면 에러를 반환한다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "신규 기능 출시 일정 회의",
      date: "2026-99-99 10:00",
      attendees: "김민수, 이지은, 화자3",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.field).toBe("date");
    expect(res.message).toBe("일시는 2026-09-22 14:00처럼 적어 주세요. 모르면 비워 두세요.");
  });

  it("참석자를 비우면 ['미정']으로 설정한다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "신규 기능 출시 일정 회의",
      date: "2026-09-22 14:00",
      attendees: "",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.attendees).toEqual(["미정"]);
  });

  it("참석자 목록을 바꾸면 마지막 항목에 (수정됨)을 붙여 전체 줄이 수정됨을 나타낸다", () => {
    const res = applyMetaEdits(BASE_MINUTES, {
      title: "신규 기능 출시 일정 회의",
      date: "2026-09-22 14:00",
      attendees: "김민수, 이지은, 박영희",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.attendees).toEqual(["김민수", "이지은", "박영희 (수정됨)"]);
  });
});

describe("6-1 apply-edits: 요약(Summary) 편집", () => {
  it("내용이 빈 줄은 버리고, 줄이 하나도 안 남으면 빈 배열(['없음'])로 처리한다", () => {
    const res = applySummaryEdits(BASE_MINUTES, ["   ", ""]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.summary).toEqual([]);
  });

  it("바뀐 줄과 추가된 줄에 (수정됨)을 붙인다", () => {
    const res = applySummaryEdits(BASE_MINUTES, [
      "신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.", // 원래 내용 동일
      "마케팅 자료는 출시 3일 전까지 준비하기로 했다.", // 변경됨
      "추가된 요약 줄입니다.", // 신규 추가
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.summary[0]).toBe("신규 기능 출시일을 두고 개발 일정과 QA 기간을 논의했다.");
    expect(res.minutes.summary[1]).toBe("마케팅 자료는 출시 3일 전까지 준비하기로 했다. (수정됨)");
    expect(res.minutes.summary[2]).toBe("추가된 요약 줄입니다. (수정됨)");
  });
});

describe("6-1 apply-edits: 결정사항(Decisions) 편집", () => {
  it("결정사항을 모두 지우면 빈 배열로 처리된다", () => {
    const res = applyDecisionsEdits(BASE_MINUTES, [], DURATION_SECONDS);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.decisions).toEqual([]);
  });

  it("근거가 99:99처럼 틀린 형식이면 에러를 반환한다", () => {
    const res = applyDecisionsEdits(
      BASE_MINUTES,
      [{ text: "새 결정사항", ts: "99:99" }],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toBe("근거는 12:34 또는 1:02:03처럼 적어 주세요.");
  });

  it("근거가 녹음 길이를 넘으면 에러를 반환한다", () => {
    // 30분 = 1800초, 35:00 = 2100초
    const res = applyDecisionsEdits(
      BASE_MINUTES,
      [{ text: "새 결정사항", ts: "35:00" }],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toBe("녹음 길이(30:00)보다 뒤의 위치입니다.");
  });

  it("근거의 대괄호와 백틱을 제거하고, 비어 있으면 '근거 없음'으로 둔다", () => {
    const res = applyDecisionsEdits(
      BASE_MINUTES,
      [
        { text: "첫 번째 결정사항", ts: "`[12:34]`" },
        { text: "두 번째 결정사항", ts: "" },
      ],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.decisions[0].ts).toBe("12:34");
    expect(res.minutes.decisions[1].ts).toBe("근거 없음");
  });
});

describe("6-1 apply-edits: 할 일(Todos) 편집", () => {
  it("담당자를 비우고 적용하면 '미정'이 된다", () => {
    const res = applyTodosEdits(
      BASE_MINUTES,
      [
        { task: "출시 공지 초안 작성", owner: "", due: "10월 8일", ts: "21:45" },
      ],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.todos[0].owner).toBe("미정");
  });

  it("할 일 기한을 '10월 10일'로 고치고 적용하면 '10월 10일 (수정됨)'이 된다", () => {
    const res = applyTodosEdits(
      BASE_MINUTES,
      [
        { task: "출시 공지 초안 작성", owner: "이지은", due: "10월 10일", ts: "21:45" },
      ],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.todos[0].due).toBe("10월 10일 (수정됨)");
  });

  it("새로운 할 일 항목을 추가하면 task에 (수정됨)이 붙는다", () => {
    const res = applyTodosEdits(
      BASE_MINUTES,
      [
        ...BASE_MINUTES.todos,
        { task: "추가 과업", owner: "박영희", due: "10월 20일", ts: "10:00" },
      ],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.todos[3].task).toBe("추가 과업 (수정됨)");
  });
});

describe("6-1 apply-edits: 전화번호 마스킹 재적용", () => {
  it("편집으로 직접 넣은 전화번호도 ***로 가려진다", () => {
    const res = applyMinutesEdits(
      BASE_MINUTES,
      "summary",
      ["문의전화는 010-9876-5432로 주세요."],
      DURATION_SECONDS
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.minutes.summary[0]).toContain("***");
    expect(res.minutes.summary[0]).not.toContain("010-9876-5432");
  });
});
