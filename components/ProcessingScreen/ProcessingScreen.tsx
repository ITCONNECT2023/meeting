"use client";

import type { JobRecord, StepStatus } from "@/lib/minutes/types";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  EmptyCircleIcon,
  InfoCircleIcon,
  MailIcon,
  StepSpinnerIcon,
} from "@/components/icons";
import { AudioFileIcon } from "@/components/FilePicker/icons";
import styles from "./ProcessingScreen.module.css";

interface ProcessingScreenProps {
  mode: "a" | "b";
  fileName: string;
  recipients: string[];
  job: JobRecord | null;
  onRetry: () => void;
  onHome: () => void;
}

export function ProcessingScreen({
  mode,
  fileName,
  recipients,
  job,
  onRetry,
  onHome,
}: ProcessingScreenProps) {
  const isA = mode === "a";
  const isB = mode === "b";

  const uploadStep = job?.steps.upload ?? { status: "running" as StepStatus };
  const transcribeStep = job?.steps.transcribe ?? { status: "pending" as StepStatus };
  const minutesStep = job?.steps.minutes ?? { status: "pending" as StepStatus };
  const sendStep = job?.steps.send ?? { status: "pending" as StepStatus };

  const isFailed = job?.status === "failed";

  function renderStepBadge(status: StepStatus) {
    if (status === "completed") {
      return <span className={`${styles.badge} ${styles.badgeCompleted}`}>완료</span>;
    }
    if (status === "running") {
      return (
        <span
          className={`${styles.badge} ${isA ? styles.badgeRunningA : styles.badgeRunningB}`}
        >
          진행 중
        </span>
      );
    }
    if (status === "failed") {
      return <span className={`${styles.badge} ${styles.badgeFailed}`}>실패</span>;
    }
    return <span className={`${styles.badge} ${styles.badgePending}`}>대기</span>;
  }

  function renderStepIcon(status: StepStatus) {
    if (status === "completed") {
      return (
        <span className={`${styles.stepIcon} ${styles.iconCompleted}`}>
          <CheckCircleIcon size={22} />
        </span>
      );
    }
    if (status === "running") {
      return (
        <span
          className={`${styles.stepIcon} ${isA ? styles.iconRunningA : styles.iconRunningB}`}
        >
          <StepSpinnerIcon size={22} />
        </span>
      );
    }
    if (status === "failed") {
      return (
        <span className={`${styles.stepIcon} ${styles.iconFailed}`}>
          <AlertCircleIcon size={22} />
        </span>
      );
    }
    return (
      <span className={`${styles.stepIcon} ${styles.iconPending}`}>
        <EmptyCircleIcon size={22} />
      </span>
    );
  }

  function getStepRowClass(status: StepStatus) {
    if (status === "failed") return `${styles.stepItem} ${styles.stepFailed}`;
    if (status === "running") {
      return `${styles.stepItem} ${isA ? styles.stepRunningA : styles.stepRunningB}`;
    }
    return styles.stepItem;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {isA ? "회의록을 만들고 있습니다" : "회의록을 만든 뒤 바로 보냅니다"}
        </h1>
        <p className={styles.fileLine}>
          <AudioFileIcon size={18} strokeWidth={1.8} />
          <span>{fileName}</span>
        </p>
      </div>

      <ol aria-label="진행 단계" className={styles.stepList}>
        {/* Step 1: Upload */}
        <li className={getStepRowClass(uploadStep.status)}>
          {renderStepIcon(uploadStep.status)}
          <div className={styles.stepBody}>
            <span className={styles.stepName}>녹음 파일 올리기</span>
            {uploadStep.errorMessage && (
              <span className={styles.stepErrorText}>{uploadStep.errorMessage}</span>
            )}
          </div>
          {renderStepBadge(uploadStep.status)}
        </li>

        {/* Step 2: Transcribe */}
        <li className={getStepRowClass(transcribeStep.status)}>
          {renderStepIcon(transcribeStep.status)}
          <div className={styles.stepBody}>
            <span className={styles.stepName}>스크립트 만들기</span>
            <span className={styles.stepDesc}>
              음성 인식 · 목소리로 말한 사람 나누기 · 발언마다 타임스탬프
            </span>
            {transcribeStep.errorMessage && (
              <span className={styles.stepErrorText}>{transcribeStep.errorMessage}</span>
            )}
          </div>
          {renderStepBadge(transcribeStep.status)}
        </li>

        {/* Step 3: Minutes */}
        <li className={getStepRowClass(minutesStep.status)}>
          {renderStepIcon(minutesStep.status)}
          <div className={styles.stepBody}>
            <span className={styles.stepName}>회의록 만들기</span>
            <span className={styles.stepDesc}>
              요약 · 결정사항 · 할 일 정리, 녹음에서 확인되지 않는 내용은 &apos;미정&apos;
            </span>
            {minutesStep.errorMessage && (
              <span className={styles.stepErrorText}>{minutesStep.errorMessage}</span>
            )}
          </div>
          {renderStepBadge(minutesStep.status)}
        </li>

        {/* Step 4 (Mode B only): Send Mail */}
        {isB && (
          <li className={getStepRowClass(sendStep.status)}>
            {renderStepIcon(sendStep.status)}
            <div className={styles.stepBody}>
              <span className={styles.stepName}>메일 보내기</span>
              <span className={styles.stepDesc}>
                검토 없이 받는 사람 {recipients.length}명에게 · 본문에 요약·결정사항·할 일, .md 파일 첨부
              </span>
              {sendStep.errorMessage && (
                <span className={styles.stepErrorText}>{sendStep.errorMessage}</span>
              )}
            </div>
            {renderStepBadge(sendStep.status)}
          </li>
        )}
      </ol>

      {/* Mode B recipients box */}
      {isB && (
        <div className={styles.recipientsBox}>
          <p className={styles.recipientsTitle}>
            회의록이 만들어지면 이 주소로 검토 없이 보냅니다
          </p>
          <ul className={styles.recipientsList}>
            {recipients.map((email) => (
              <li key={email} className={styles.recipientItem}>
                <span className={styles.recipientIcon}>
                  <MailIcon size={18} />
                </span>
                <span>{email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className={styles.noticeLine}>
        <span className={styles.noticeIcon}>
          <InfoCircleIcon size={18} />
        </span>
        <span>녹음 파일은 처리가 끝나면 서비스에서 삭제됩니다.</span>
      </p>

      {isA && (
        <p className={styles.infoLine}>
          회의록이 만들어지면 확인 화면이 열립니다. 메일은 아직 보내지 않습니다.
        </p>
      )}

      {isB && (
        <p className={styles.infoLine}>
          올리기가 끝나면 창을 닫아도 메일이 나갑니다. 다만 창을 닫으면 실패했을 때 알려 드릴 수 없습니다.
        </p>
      )}

      {/* Action buttons shown on failure */}
      {isFailed && (
        <div className={styles.actionButtons}>
          <button
            type="button"
            onClick={onRetry}
            className={`${styles.retryButton} ${isB ? styles.retryButtonB : ""}`}
          >
            다시 시도
          </button>
          <button type="button" onClick={onHome} className={styles.homeButton}>
            처음으로
          </button>
        </div>
      )}
    </div>
  );
}
