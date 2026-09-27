"use client";

import { useState } from "react";
import type { JobRecord } from "@/lib/minutes/types";
import { formatMinutesFilename, formatMailSubject } from "@/lib/minutes/filename";
import {
  CloseIcon,
  DownloadIcon,
  FileIcon,
  LockIcon,
  MailIcon,
} from "@/components/icons";
import styles from "./ReviewScreen.module.css";

interface ReviewScreenProps {
  job: JobRecord;
  onHome: () => void;
  onSendMail?: () => void;
}

export function ReviewScreen({ job, onHome, onSendMail }: ReviewScreenProps) {
  const [downloadToastOpen, setDownloadToastOpen] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  const minutes = job.minutes;
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
            <div className={styles.section}>
              <h2 className={styles.h1Title}>
                <span className={styles.hashTag} aria-hidden="true">
                  #
                </span>
                <span>{minutes.title}</span>
              </h2>
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

            {/* Summary */}
            <section aria-labelledby="sec-summary" className={styles.section}>
              <div className={styles.sectionHead}>
                <h3 id="sec-summary" className={styles.h2Title}>
                  <span className={styles.hashTag} aria-hidden="true">
                    ##
                  </span>
                  <span>요약</span>
                </h3>
              </div>
              {!minutes.summary || minutes.summary.length === 0 ? (
                <p style={{ margin: 0 }}>
                  <span className={styles.dashedBadge}>없음</span>
                </p>
              ) : (
                <ul className={styles.list}>
                  {minutes.summary.map((s, idx) => (
                    <li key={idx}>{s}</li>
                  ))}
                </ul>
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
              </div>
              {!minutes.decisions || minutes.decisions.length === 0 ? (
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
              </div>
              {!minutes.todos || minutes.todos.length === 0 ? (
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
                          <span>{t.task}</span>
                          <span>
                            {t.owner === "미정" ? (
                              <span className={styles.dashedBadge}>미정</span>
                            ) : (
                              t.owner
                            )}
                          </span>
                          <span>
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
                            <span>{t.task}</span>
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
            className={styles.sendButton}
          >
            <MailIcon size={20} strokeWidth={1.8} />
            <span>메일 보내기</span>
          </button>
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
          className={styles.barSendBtn}
        >
          <MailIcon size={20} strokeWidth={1.8} />
          <span>메일 보내기</span>
        </button>
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
