"use client";

import type { MeetingMinutes } from "@/lib/minutes/types";
import styles from "./ReviewScreen.module.css";

interface ReviewScreenProps {
  minutes: MeetingMinutes;
}

export function ReviewScreen({ minutes }: ReviewScreenProps) {
  return (
    <div className={styles.container}>
      <div className={styles.intro}>
        <h1 className={styles.title}>회의록을 확인하고, 필요하면 고친 뒤 보내세요</h1>
        <p className={styles.lead}>
          제목부터 할 일까지 고칠 수 있습니다. 전체 스크립트는 녹음 근거로 남겨 두기 때문에
          고칠 수 없습니다. 직접 고친 내용은 검토자 책임으로 봅니다.
        </p>
      </div>

      <article aria-label="회의록" className={styles.card}>
        {/* Title, Date, Attendees */}
        <div className={styles.section}>
          <h2 className={styles.metaHeader}>
            <span className={styles.hashTag}>#</span>
            <span>{minutes.title}</span>
          </h2>
          <dl className={styles.metaGrid}>
            <dt>일시</dt>
            <dd>{minutes.date}</dd>
            <dt>참석자</dt>
            <dd>{minutes.attendees.join(", ")}</dd>
          </dl>
        </div>

        {/* Summary */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.hashTag}>##</span>
            <span>요약</span>
          </h3>
          <ul className={styles.list}>
            {minutes.summary.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        </div>

        {/* Decisions */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.hashTag}>##</span>
            <span>결정사항</span>
          </h3>
          <ol className={styles.list}>
            {minutes.decisions.map((dec, idx) => (
              <li key={idx}>
                <span>{dec.text}</span>
                {dec.ts && <code className={styles.tsTag}>[{dec.ts}]</code>}
              </li>
            ))}
          </ol>
        </div>

        {/* Todos */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.hashTag}>##</span>
            <span>할 일</span>
          </h3>
          <ul className={styles.list}>
            {minutes.todos.map((todo, idx) => (
              <li key={idx}>
                <strong>{todo.task}</strong> ({todo.owner} · {todo.due})
                {todo.ts && <code className={styles.tsTag}>[{todo.ts}]</code>}
              </li>
            ))}
          </ul>
        </div>

        {/* Script */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            <span className={styles.hashTag}>##</span>
            <span>전체 스크립트</span>
          </h3>
          <div className={styles.scriptBox}>
            {minutes.script.map((line, idx) => (
              <div key={idx} className={styles.scriptLine}>
                <code className={styles.scriptTs}>[{line.ts}]</code>
                <span className={styles.scriptSpeaker}>{line.speaker}:</span>
                <span className={styles.scriptText}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}
