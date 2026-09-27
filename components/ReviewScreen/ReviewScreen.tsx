"use client";

import { useState } from "react";
import type { JobRecord, MeetingMinutes } from "@/lib/minutes/types";
import { formatMinutesFilename, formatMailSubject } from "@/lib/minutes/filename";
import {
  CloseIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  LockIcon,
  MailIcon,
  PlusIcon,
  TrashIcon,
} from "@/components/icons";
import styles from "./ReviewScreen.module.css";

interface ReviewScreenProps {
  job: JobRecord;
  onHome: () => void;
  onSendMail?: () => void;
  onUpdateJobMinutes?: (minutes: MeetingMinutes, maskedCount?: number) => void;
}

type EditSection = "meta" | "summary" | "decisions" | "todos" | null;

export function ReviewScreen({
  job,
  onHome,
  onSendMail,
  onUpdateJobMinutes,
}: ReviewScreenProps) {
  const [downloadToastOpen, setDownloadToastOpen] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [overrideMinutes, setOverrideMinutes] = useState<MeetingMinutes | null>(null);
  const minutes = overrideMinutes ?? job.minutes!;

  // Section editing state
  const [editingSection, setEditingSection] = useState<EditSection>(null);
  const [editError, setEditError] = useState<{
    field?: string;
    message?: string;
    index?: number;
  } | null>(null);

  // Draft states
  const [metaDraft, setMetaDraft] = useState({
    title: "",
    date: "",
    attendees: "",
  });
  const [summaryDraft, setSummaryDraft] = useState<string[]>([]);
  const [decisionsDraft, setDecisionsDraft] = useState<Array<{ text: string; ts: string }>>([]);
  const [todosDraft, setTodosDraft] = useState<
    Array<{ task: string; owner: string; due: string; ts: string }>
  >([]);

  if (!minutes) {
    return null;
  }

  const fileName = formatMinutesFilename(minutes.date, job.createdAt);
  const mailSubject = formatMailSubject(minutes.title, minutes.date);
  const recipients = job.recipients || [];
  const rcpCount = recipients.length;
  const maskedCount = job.maskedCount || 0;

  // Check if any item contains (수정됨)
  const allText = JSON.stringify(minutes);
  const hasModified = allText.includes("(수정됨)");

  // Filename preview for meta editing
  const metaDateInput = metaDraft.date.trim();
  const metaDatePart = metaDateInput && metaDateInput !== "미정"
    ? metaDateInput.replace(/\s*\(수정됨\)$/, "").split(" ")[0]
    : undefined;
  const previewFileName = formatMinutesFilename(metaDatePart, job.createdAt);

  function startEdit(section: "meta" | "summary" | "decisions" | "todos") {
    if (editingSection !== null) return;
    setEditError(null);

    if (section === "meta") {
      setMetaDraft({
        title: minutes.title || "",
        date: minutes.date === "미정" ? "" : (minutes.date || ""),
        attendees: minutes.attendees ? minutes.attendees.join(", ") : "",
      });
    } else if (section === "summary") {
      setSummaryDraft(minutes.summary ? [...minutes.summary] : []);
    } else if (section === "decisions") {
      setDecisionsDraft(
        minutes.decisions
          ? minutes.decisions.map((d) => ({ text: d.text, ts: d.ts || "" }))
          : [],
      );
    } else if (section === "todos") {
      setTodosDraft(
        minutes.todos
          ? minutes.todos.map((t) => ({
              task: t.task,
              owner: t.owner === "미정" ? "" : (t.owner || ""),
              due: t.due === "미정" ? "" : (t.due || ""),
              ts: t.ts === "근거 없음" ? "" : (t.ts || ""),
            }))
          : [],
      );
    }

    setEditingSection(section);
  }

  function cancelEdit() {
    setEditingSection(null);
    setEditError(null);
  }

  async function applyEdit(section: "meta" | "summary" | "decisions" | "todos") {
    setEditError(null);

    let data: unknown;
    if (section === "meta") {
      data = metaDraft;
    } else if (section === "summary") {
      data = summaryDraft;
    } else if (section === "decisions") {
      data = decisionsDraft;
    } else if (section === "todos") {
      data = todosDraft;
    }

    try {
      const res = await fetch(`/api/jobs/${job.id}/minutes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, data }),
      });

      if (res.status === 410) {
        setIsExpired(true);
        return;
      }

      const json = await res.json();
      if (!res.ok || !json.ok) {
        setEditError({
          field: json.field,
          message: json.message || "수정 사항을 적용하지 못했습니다.",
          index: json.index,
        });
        return;
      }

      setOverrideMinutes(json.minutes);
      onUpdateJobMinutes?.(json.minutes, json.maskedCount);
      setEditingSection(null);
    } catch {
      setEditError({ message: "네트워크 오류가 발생했습니다. 다시 시도해 주세요." });
    }
  }

  async function handleDownload() {
    try {
      const res = await fetch(`/api/jobs/${job.id}/download`);
      if (res.status === 410) {
        setIsExpired(true);
        return;
      }
      if (!res.ok) {
        throw new Error("다운로드에 실패했습니다.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setDownloadToastOpen(true);
    } catch (err) {
      console.error("다운로드 에러:", err);
    }
  }

  if (isExpired) {
    return (
      <div className={styles.expiredContainer}>
        <p className={styles.expiredMsg}>
          보관 시간(24시간)이 지나 회의록이 삭제되었습니다. 녹음을 다시 올려 주세요.
        </p>
        <button type="button" onClick={onHome} className={styles.homeBtn}>
          처음으로
        </button>
      </div>
    );
  }

  const canEdit = editingSection === null;

  return (
    <div className={styles.container}>
      <div className={styles.intro}>
        <h1 className={styles.title}>회의록을 확인하고, 필요하면 고친 뒤 보내세요</h1>
        <p className={styles.lead}>
          제목부터 할 일까지 고칠 수 있습니다. 전체 스크립트는 녹음 근거로 남겨 두기 때문에
          고칠 수 없습니다. 직접 고친 내용은 검토자 책임으로 봅니다.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          {/* Tablet & Mobile Top Mail Info Box */}
          <div className={styles.topMailBox}>
            <div className={styles.topMailHead}>
              <MailIcon size={18} strokeWidth={1.8} />
              <span>보낼 곳</span>
              <span className={styles.topMailCount}>받는 사람 {rcpCount}명</span>
            </div>
            {recipients.length > 0 && (
              <ul className={styles.rcpPills}>
                {recipients.map((r) => (
                  <li key={r} className={styles.rcpPill}>
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <dl className={styles.topMailDl}>
              <dt className={styles.topMailDt}>메일 제목</dt>
              <dd className={styles.topMailDd}>{mailSubject}</dd>
              <dt className={styles.topMailDt}>첨부</dt>
              <dd className={styles.topMailDd}>
                <code className={styles.tsTag}>{fileName}</code>
              </dd>
            </dl>
          </div>

          {/* Article: 회의록 본문 */}
          <article aria-label="회의록" className={styles.article}>
            {/* Header bar: File name and example badge */}
            <div className={styles.articleMetaBar}>
              <span className={styles.fileNameTag}>
                <FileIcon size={16} strokeWidth={1.8} />
                {fileName}
              </span>
              <span className={styles.exampleBadge}>예시 회의록</span>
            </div>

            {/* Meta Section: Title, Date, Attendees */}
            {editingSection !== "meta" ? (
              <div className={styles.section}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <h2 className={styles.h1Title}>
                    <span className={styles.hashTag} aria-hidden="true">
                      #
                    </span>
                    <span>{minutes.title}</span>
                  </h2>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => startEdit("meta")}
                      className={styles.editBtn}
                    >
                      <EditIcon size={16} strokeWidth={1.8} />
                      고치기
                    </button>
                  )}
                </div>
                <dl className={styles.metaDl}>
                  <dt className={styles.metaDt}>일시</dt>
                  <dd className={styles.metaDd}>
                    {!minutes.date || minutes.date === "미정" ? (
                      <span className={styles.dashedBadge}>미정</span>
                    ) : (
                      minutes.date
                    )}
                  </dd>
                  <dt className={styles.metaDt}>참석자</dt>
                  <dd className={styles.metaDd}>
                    {!minutes.attendees ||
                    minutes.attendees.length === 0 ||
                    (minutes.attendees.length === 1 && minutes.attendees[0] === "미정") ? (
                      <span className={styles.dashedBadge}>미정</span>
                    ) : (
                      minutes.attendees.join(", ")
                    )}
                  </dd>
                </dl>
              </div>
            ) : (
              <div className={styles.editBox}>
                <p className={styles.editBoxTitle}>제목 · 일시 · 참석자 고치는 중</p>
                <div className={styles.editField}>
                  <label htmlFor="ed-title" className={styles.editLabel}>
                    제목
                  </label>
                  <input
                    id="ed-title"
                    type="text"
                    value={metaDraft.title}
                    onChange={(e) => setMetaDraft({ ...metaDraft, title: e.target.value })}
                    className={styles.editInput}
                  />
                </div>
                <div className={styles.editField}>
                  <label htmlFor="ed-date" className={styles.editLabel}>
                    일시
                  </label>
                  <input
                    id="ed-date"
                    type="text"
                    value={metaDraft.date}
                    onChange={(e) => setMetaDraft({ ...metaDraft, date: e.target.value })}
                    placeholder="미정"
                    className={`${styles.editInput} ${editError?.field === "date" ? styles.editInputError : ""}`}
                  />
                  <p className={styles.editHelper}>
                    예: 2026-09-22 14:00 · 비우면 &apos;미정&apos; · 파일 이름{" "}
                    <code className={styles.tsTag}>{previewFileName}</code>
                  </p>
                </div>
                <div className={styles.editField}>
                  <label htmlFor="ed-att" className={styles.editLabel}>
                    참석자
                  </label>
                  <input
                    id="ed-att"
                    type="text"
                    value={metaDraft.attendees}
                    onChange={(e) => setMetaDraft({ ...metaDraft, attendees: e.target.value })}
                    placeholder="미정"
                    className={styles.editInput}
                  />
                  <p className={styles.editHelper}>
                    쉼표로 구분합니다. 확실하지 않은 사람은 &apos;화자N&apos;으로 둡니다.
                  </p>
                </div>
                {editError?.message && (
                  <p className={styles.editErrorText}>{editError.message}</p>
                )}
                <div className={styles.editActions}>
                  <button type="button" onClick={cancelEdit} className={styles.editCancelBtn}>
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEdit("meta")}
                    className={styles.editApplyBtn}
                  >
                    적용
                  </button>
                </div>
              </div>
            )}

            {/* Summary */}
            <section aria-labelledby="sec-summary" className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 id="sec-summary" className={styles.h2Title}>
                  <span className={styles.hashTag} aria-hidden="true">
                    ##
                  </span>
                  <span>요약</span>
                </h3>
                {canEdit && editingSection !== "summary" && (
                  <button
                    type="button"
                    onClick={() => startEdit("summary")}
                    className={styles.editBtn}
                  >
                    <EditIcon size={16} strokeWidth={1.8} />
                    고치기
                  </button>
                )}
              </div>
              {editingSection !== "summary" ? (
                !minutes.summary || minutes.summary.length === 0 ? (
                  <p style={{ margin: 0 }}>
                    <span className={styles.dashedBadge}>없음</span>
                  </p>
                ) : (
                  <ul className={styles.list}>
                    {minutes.summary.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                )
              ) : (
                <div className={styles.editBox}>
                  <p className={styles.editBoxTitle}>요약 고치는 중</p>
                  {summaryDraft.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        aria-label={`요약 ${idx + 1}번째 줄`}
                        value={item}
                        onChange={(e) => {
                          const next = [...summaryDraft];
                          next[idx] = e.target.value;
                          setSummaryDraft(next);
                        }}
                        className={styles.editInput}
                      />
                      <button
                        type="button"
                        aria-label="줄 지우기"
                        onClick={() => {
                          setSummaryDraft(summaryDraft.filter((_, i) => i !== idx));
                        }}
                        className={styles.delRowBtn}
                      >
                        <TrashIcon size={20} strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSummaryDraft([...summaryDraft, ""])}
                    className={styles.addRowBtn}
                  >
                    <PlusIcon size={16} strokeWidth={2} />
                    줄 추가
                  </button>
                  {editError?.message && (
                    <p className={styles.editErrorText}>{editError.message}</p>
                  )}
                  <div className={styles.editActions}>
                    <button type="button" onClick={cancelEdit} className={styles.editCancelBtn}>
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => applyEdit("summary")}
                      className={styles.editApplyBtn}
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Decisions */}
            <section aria-labelledby="sec-decisions" className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 id="sec-decisions" className={styles.h2Title}>
                  <span className={styles.hashTag} aria-hidden="true">
                    ##
                  </span>
                  <span>결정사항</span>
                </h3>
                {canEdit && editingSection !== "decisions" && (
                  <button
                    type="button"
                    onClick={() => startEdit("decisions")}
                    className={styles.editBtn}
                  >
                    <EditIcon size={16} strokeWidth={1.8} />
                    고치기
                  </button>
                )}
              </div>
              {editingSection !== "decisions" ? (
                !minutes.decisions || minutes.decisions.length === 0 ? (
                  <p style={{ margin: 0 }}>
                    <span className={styles.dashedBadge}>없음</span>
                  </p>
                ) : (
                  <ol className={styles.olList}>
                    {minutes.decisions.map((d, idx) => {
                      const cleanTs = d.ts?.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
                      return (
                        <li key={idx}>
                          <span>{d.text}</span>
                          {cleanTs && cleanTs === "근거 없음" && (
                            <span
                              className={styles.dashedBadge}
                              style={{ marginLeft: 8 }}
                            >
                              근거 없음
                            </span>
                          )}
                          {cleanTs && cleanTs !== "근거 없음" && (
                            <code className={styles.tsTag} style={{ marginLeft: 8 }}>
                              [{cleanTs}]
                            </code>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )
              ) : (
                <div className={styles.editBox}>
                  <p className={styles.editBoxTitle}>결정사항 고치는 중</p>
                  <div className={styles.decEditColsHeader}>
                    <span>결정사항</span>
                    <span>근거</span>
                    <span />
                  </div>
                  {decisionsDraft.map((item, idx) => (
                    <div key={idx} className={styles.decEditRow}>
                      <input
                        type="text"
                        aria-label={`결정사항 ${idx + 1}`}
                        value={item.text}
                        onChange={(e) => {
                          const next = [...decisionsDraft];
                          next[idx] = { ...next[idx], text: e.target.value };
                          setDecisionsDraft(next);
                        }}
                        placeholder="결정사항"
                        className={styles.editInput}
                      />
                      <input
                        type="text"
                        aria-label={`결정사항 ${idx + 1} 근거`}
                        value={item.ts}
                        onChange={(e) => {
                          const next = [...decisionsDraft];
                          next[idx] = { ...next[idx], ts: e.target.value };
                          setDecisionsDraft(next);
                        }}
                        placeholder="근거 mm:ss"
                        className={`${styles.editInput} ${styles.editInputMono} ${
                          editError?.field === "ts" && editError?.index === idx
                            ? styles.editInputError
                            : ""
                        }`}
                      />
                      <button
                        type="button"
                        aria-label="결정사항 지우기"
                        onClick={() => {
                          setDecisionsDraft(decisionsDraft.filter((_, i) => i !== idx));
                        }}
                        className={styles.delRowBtn}
                      >
                        <TrashIcon size={20} strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDecisionsDraft([...decisionsDraft, { text: "", ts: "" }])}
                    className={styles.addRowBtn}
                  >
                    <PlusIcon size={16} strokeWidth={2} />
                    결정사항 추가
                  </button>
                  <p className={styles.editHelper}>
                    근거는 녹음 속 위치입니다(예: 12:34). 모두 지우면 &apos;없음&apos;으로 표시됩니다.
                  </p>
                  {editError?.message && (
                    <p className={styles.editErrorText}>{editError.message}</p>
                  )}
                  <div className={styles.editActions}>
                    <button type="button" onClick={cancelEdit} className={styles.editCancelBtn}>
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => applyEdit("decisions")}
                      className={styles.editApplyBtn}
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Todos */}
            <section aria-labelledby="sec-todos" className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 id="sec-todos" className={styles.h2Title}>
                  <span className={styles.hashTag} aria-hidden="true">
                    ##
                  </span>
                  <span>할 일</span>
                </h3>
                {canEdit && editingSection !== "todos" && (
                  <button
                    type="button"
                    onClick={() => startEdit("todos")}
                    className={styles.editBtn}
                  >
                    <EditIcon size={16} strokeWidth={1.8} />
                    고치기
                  </button>
                )}
              </div>
              {editingSection !== "todos" ? (
                !minutes.todos || minutes.todos.length === 0 ? (
                  <p style={{ margin: 0 }}>
                    <span className={styles.dashedBadge}>없음</span>
                  </p>
                ) : (
                  <>
                    {/* PC & Tablet Table */}
                    <div className={styles.todoTable}>
                      <div className={styles.todoTableHead}>
                        <span>할 일</span>
                        <span>담당자</span>
                        <span>기한</span>
                        <span>근거</span>
                      </div>
                      {minutes.todos.map((t, idx) => {
                        const cleanTs = t.ts?.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
                        return (
                          <div key={idx} className={styles.todoTableRow}>
                            <span style={{ minWidth: 0 }}>{t.task}</span>
                            <span style={{ minWidth: 0 }}>
                              {t.owner === "미정" ? (
                                <span className={styles.dashedBadge}>미정</span>
                              ) : (
                                t.owner
                              )}
                            </span>
                            <span style={{ minWidth: 0 }}>
                              {t.due === "미정" ? (
                                <span className={styles.dashedBadge}>미정</span>
                              ) : (
                                t.due
                              )}
                            </span>
                            <span>
                              {cleanTs && cleanTs !== "근거 없음" ? (
                                <code className={styles.tsTag}>[{cleanTs}]</code>
                              ) : (
                                <span className={styles.dashedBadge}>근거 없음</span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Mobile Cards */}
                    <ul className={styles.todoCards}>
                      {minutes.todos.map((t, idx) => {
                        const cleanTs = t.ts?.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
                        return (
                          <li key={idx} className={styles.todoCard}>
                            <div className={styles.todoCardHead}>
                              <span className={styles.todoCardTask}>{t.task}</span>
                              {cleanTs && cleanTs !== "근거 없음" ? (
                                <code className={styles.tsTag}>[{cleanTs}]</code>
                              ) : (
                                <span className={styles.dashedBadge}>근거 없음</span>
                              )}
                            </div>
                            <dl className={styles.todoCardDl}>
                              <dt style={{ color: "#5E5A52" }}>담당자</dt>
                              <dd style={{ margin: 0 }}>
                                {t.owner === "미정" ? (
                                  <span className={styles.dashedBadge}>미정</span>
                                ) : (
                                  t.owner
                                )}
                              </dd>
                              <dt style={{ color: "#5E5A52" }}>기한</dt>
                              <dd style={{ margin: 0 }}>
                                {t.due === "미정" ? (
                                  <span className={styles.dashedBadge}>미정</span>
                                ) : (
                                  t.due
                                )}
                              </dd>
                            </dl>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              ) : (
                <div className={styles.editBox}>
                  <p className={styles.editBoxTitle}>할 일 고치는 중</p>
                  <div className={styles.todoEditColsHeader}>
                    <span>할 일</span>
                    <span>담당자</span>
                    <span>기한</span>
                    <span>근거</span>
                    <span />
                  </div>
                  {todosDraft.map((item, idx) => (
                    <div key={idx} className={styles.todoEditRow}>
                      <input
                        type="text"
                        aria-label={`할 일 ${idx + 1}`}
                        value={item.task}
                        onChange={(e) => {
                          const next = [...todosDraft];
                          next[idx] = { ...next[idx], task: e.target.value };
                          setTodosDraft(next);
                        }}
                        placeholder="할 일"
                        className={styles.editInput}
                      />
                      <input
                        type="text"
                        aria-label={`할 일 ${idx + 1} 담당자`}
                        value={item.owner}
                        onChange={(e) => {
                          const next = [...todosDraft];
                          next[idx] = { ...next[idx], owner: e.target.value };
                          setTodosDraft(next);
                        }}
                        placeholder="담당자 미정"
                        className={styles.editInput}
                      />
                      <input
                        type="text"
                        aria-label={`할 일 ${idx + 1} 기한`}
                        value={item.due}
                        onChange={(e) => {
                          const next = [...todosDraft];
                          next[idx] = { ...next[idx], due: e.target.value };
                          setTodosDraft(next);
                        }}
                        placeholder="기한 미정"
                        className={styles.editInput}
                      />
                      <input
                        type="text"
                        aria-label={`할 일 ${idx + 1} 근거`}
                        value={item.ts}
                        onChange={(e) => {
                          const next = [...todosDraft];
                          next[idx] = { ...next[idx], ts: e.target.value };
                          setTodosDraft(next);
                        }}
                        placeholder="근거 mm:ss"
                        className={`${styles.editInput} ${styles.editInputMono} ${
                          editError?.field === "ts" && editError?.index === idx
                            ? styles.editInputError
                            : ""
                        }`}
                      />
                      <button
                        type="button"
                        aria-label="할 일 지우기"
                        onClick={() => {
                          setTodosDraft(todosDraft.filter((_, i) => i !== idx));
                        }}
                        className={styles.delRowBtn}
                      >
                        <TrashIcon size={20} strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setTodosDraft([
                        ...todosDraft,
                        { task: "", owner: "", due: "", ts: "" },
                      ])
                    }
                    className={styles.addRowBtn}
                  >
                    <PlusIcon size={16} strokeWidth={2} />
                    할 일 추가
                  </button>
                  <p className={styles.editHelper}>
                    담당자나 기한을 비우면 &apos;미정&apos;으로 표시됩니다. 모두 지우면 &apos;없음&apos;으로 표시됩니다.
                  </p>
                  {editError?.message && (
                    <p className={styles.editErrorText}>{editError.message}</p>
                  )}
                  <div className={styles.editActions}>
                    <button type="button" onClick={cancelEdit} className={styles.editCancelBtn}>
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => applyEdit("todos")}
                      className={styles.editApplyBtn}
                    >
                      적용
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Script */}
            <section aria-labelledby="sec-script" className={styles.section}>
              <div className={styles.sectionHead}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <h3 id="sec-script" className={styles.h2Title}>
                    <span className={styles.hashTag} aria-hidden="true">
                      ##
                    </span>
                    <span>전체 스크립트</span>
                  </h3>
                  {maskedCount > 0 && (
                    <span className={styles.maskedBadge}>
                      개인정보 번호 {maskedCount}건을 가렸습니다
                    </span>
                  )}
                </div>
                <span className={styles.lockBadge}>
                  <LockIcon size={14} strokeWidth={2} />
                  고칠 수 없음
                </span>
              </div>
              <p className={styles.scriptSubtext}>
                녹음을 글로 옮긴 원본을 그대로 둡니다. 발언마다 [타임스탬프] 이름(또는 화자N): 내용 순서로 적습니다.
              </p>
              <div className={styles.scriptBox}>
                {minutes.script.map((line, idx) => {
                  const cleanTs = line.ts.replace(/^[`[\s]+/, "").replace(/[`\]\s]+$/, "");
                  return (
                    <div key={idx} className={styles.scriptLine}>
                      <code className={styles.scriptTs}>[{cleanTs}]</code>
                      <span className={styles.scriptSpeaker}>{line.speaker}:</span>
                      <span className={styles.scriptText}>{line.text}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* AI Disclaimer */}
            <p className={styles.aiDisclaimer}>
              이 회의록은 녹음을 바탕으로 AI가 작성했습니다.
              {hasModified && " `(수정됨)` 표시는 검토자가 고친 부분입니다."}
            </p>
          </article>
        </div>

        {/* Desktop Sticky Aside */}
        <aside aria-label="메일 정보" className={styles.aside}>
          <div className={styles.asideCard}>
            <h2 className={styles.asideTitle}>
              <MailIcon size={18} strokeWidth={1.8} />
              <span>보낼 곳</span>
              <span style={{ fontWeight: 500, color: "#5E5A52" }}>{rcpCount}명</span>
            </h2>
            {recipients.length > 0 && (
              <ul className={styles.asideRcpList}>
                {recipients.map((r) => (
                  <li key={r} className={styles.asideRcpItem}>
                    {r}
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.asideNote}>올릴 때 입력한 주소입니다.</p>
          </div>

          <div className={styles.asideCard}>
            <h2 className={styles.asideTitle}>메일 구성</h2>
            <dl className={styles.asideDl}>
              <div className={styles.asideDlRow}>
                <dt className={styles.asideDlDt}>제목</dt>
                <dd className={styles.asideDlDd}>{mailSubject}</dd>
              </div>
              <div className={styles.asideDlRow}>
                <dt className={styles.asideDlDt}>본문</dt>
                <dd className={styles.asideDlDd}>
                  제목, 일시, 참석자, 요약, 결정사항, 할 일 · 전체 스크립트는 넣지 않습니다
                </dd>
              </div>
              <div className={styles.asideDlRow}>
                <dt className={styles.asideDlDt}>첨부</dt>
                <dd className={styles.asideDlDd}>
                  <code className={styles.tsTag}>{fileName}</code>
                </dd>
              </div>
            </dl>
          </div>

          <button
            type="button"
            onClick={onSendMail}
            disabled={!canEdit}
            className={`${styles.sendButton} ${!canEdit ? styles.sendButtonDisabled : ""}`}
          >
            <MailIcon size={20} strokeWidth={1.8} />
            <span>메일 보내기</span>
          </button>
          {!canEdit && (
            <p className={styles.sendWarning}>고치는 중인 항목을 먼저 적용하거나 취소하세요.</p>
          )}

          <button
            type="button"
            onClick={handleDownload}
            className={styles.downloadButton}
          >
            <DownloadIcon size={20} strokeWidth={1.8} />
            <span>.md 내려받기</span>
          </button>
        </aside>
      </div>

      {/* Tablet & Mobile Bottom Fixed Bar */}
      <div className={styles.bottomFixedBar}>
        {!canEdit && (
          <p className={styles.barEditWarning}>고치는 중인 항목을 먼저 적용하거나 취소하세요.</p>
        )}
        <div style={{ display: "flex", gap: 10, width: "100%" }}>
          <button
            type="button"
            onClick={handleDownload}
            className={styles.barDownloadBtn}
          >
            <DownloadIcon size={20} strokeWidth={1.8} />
            <span>.md 내려받기</span>
          </button>
          <button
            type="button"
            onClick={onSendMail}
            disabled={!canEdit}
            className={`${styles.barSendBtn} ${!canEdit ? styles.sendButtonDisabled : ""}`}
          >
            <MailIcon size={20} strokeWidth={1.8} />
            <span>메일 보내기</span>
          </button>
        </div>
      </div>

      {/* Download Toast */}
      {downloadToastOpen && (
        <div role="status" className={styles.downloadToast}>
          <DownloadIcon size={22} strokeWidth={1.8} />
          <div className={styles.toastContent}>
            <span className={styles.toastTitle}>{fileName} 내려받기</span>
            <span className={styles.toastDetail}>전체 스크립트까지 담긴 파일입니다.</span>
          </div>
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setDownloadToastOpen(false)}
            className={styles.toastClose}
          >
            <CloseIcon size={18} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
