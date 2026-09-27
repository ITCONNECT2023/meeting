"use client";

// EPIC 2-4/2-5/2-6: 회의 녹음 올리기 screen — assembles the reusable parts
// (FilePicker, ChipInput, Dialog, Toast, Header) around the form state kept
// in useUploadForm. FRD refs: F1-F4, F14. Mockup: design/01_PC.html lines
// 110-250 (form), 568-578 (bottom bar), 607-700 (dialogs).

import { useRouter } from "next/navigation";
import { useRef } from "react";

import { ChipInput } from "@/components/ChipInput/ChipInput";
import { Button, Dialog, DialogActions } from "@/components/Dialog/Dialog";
import { FilePicker } from "@/components/FilePicker/FilePicker";
import { Header } from "@/components/Header/Header";
import { MailIcon, ReviewModeIcon, SendModeIcon } from "@/components/icons";
import { ProcessingScreen } from "@/components/ProcessingScreen/ProcessingScreen";
import { ReviewScreen } from "@/components/ReviewScreen/ReviewScreen";
import { Toast } from "@/components/Toast/Toast";
import { MAX_ATTENDEE_NAME_LENGTH, MAX_TITLE_LENGTH } from "@/lib/validation/input";

import { attendeeChipCheck, recipientChipCheck } from "./chipAdapters";
import styles from "./UploadScreen.module.css";
import { useUploadForm, type UploadMode } from "./useUploadForm";

type UploadScreenProps = {
  initialMode: UploadMode;
};

/** F14: nothing entered yet — 처음으로 skips the confirm dialog. */
function isFormEmpty(
  s: ReturnType<typeof useUploadForm>["state"],
): boolean {
  return (
    !s.fileState &&
    s.title.trim() === "" &&
    s.date === "" &&
    s.attendees.length === 0 &&
    s.recipients.length === 0 &&
    s.attendeeDraft.trim() === "" &&
    s.recipientDraft.trim() === ""
  );
}

export function UploadScreen({ initialMode }: UploadScreenProps) {
  const router = useRouter();
  const {
    state,
    pickFile,
    removeFile,
    setMode,
    setTitle,
    setDate,
    onAttendeeChange,
    onRecipientChange,
    openLeaveDialog,
    closeDialog,
    closeToast,
    confirmBGo,
    submit,
    retry,
    cancelAndHome,
  } = useUploadForm(initialMode);

  const fileSectionRef = useRef<HTMLElement>(null);
  const rcpSectionRef = useRef<HTMLElement>(null);

  const {
    mode,
    fileState,
    fileError,
    title,
    date,
    attendees,
    attendeeDraft,
    attendeeError,
    recipients,
    recipientDraft,
    recipientError,
    dialog,
    toastOpen,
  } = state;

  const isA = mode === "a";
  const recipientCount = recipients.length;
  const rcpSummary = recipientCount > 0 ? `${recipientCount}명` : "아직 없습니다";

  function handleHome() {
    if (state.screen === "form" && isFormEmpty(state)) {
      router.push("/");
      return;
    }
    openLeaveDialog();
  }

  async function handleSubmit() {
    const result = await submit();
    if (result.ok) return;
    const target = result.failedSection === "file" ? fileSectionRef.current : rcpSectionRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (result.failedSection === "file") {
      target?.querySelector<HTMLElement>("button, input")?.focus();
    } else {
      document.getElementById("in-rcp")?.focus();
    }
  }

  const submitLabel = isA ? "회의록 만들기" : "올리고 바로 보내기";
  const submitClass = `${styles.submitButton} ${isA ? styles.submitA : styles.submitB}`;

  if (state.screen === "processing") {
    return (
      <>
        <Header mode={mode} showHome onHome={handleHome} />
        <main className={styles.screen}>
          <ProcessingScreen
            mode={mode}
            fileName={fileState?.file.name ?? ""}
            recipients={recipients}
            job={state.job}
            onRetry={retry}
            onHome={async () => {
              await cancelAndHome();
              router.push("/");
            }}
          />
        </main>
        <Dialog open={dialog === "leave"} onClose={closeDialog} title="처음 화면으로 갈까요?">
          <p>고른 녹음 파일과 입력한 회의 정보, 받는 주소가 모두 지워집니다.</p>
          <DialogActions>
            <Button variant="secondary" autoFocus onClick={closeDialog}>
              머무르기
            </Button>
            <Button
              variant="primary-dark"
              onClick={async () => {
                await cancelAndHome();
                router.push("/");
              }}
            >
              처음으로
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  if (state.screen === "review" && state.job?.minutes) {
    return (
      <>
        <Header mode={mode} showHome onHome={handleHome} />
        <main className={styles.screen}>
          <ReviewScreen
            job={state.job}
            onHome={handleHome}
            onSendMail={() => {
              // EPIC 7 will wire actual mail send confirmation dialog
            }}
          />
        </main>
        <Dialog open={dialog === "leave"} onClose={closeDialog} title="처음 화면으로 갈까요?">
          <p>
            회의록은 서비스에 보관되지 않습니다. 메일을 보내거나 .md 파일로 내려받지 않고 나가면
            이 회의록을 다시 볼 수 없습니다.
          </p>
          <DialogActions>
            <Button variant="secondary" autoFocus onClick={closeDialog}>
              머무르기
            </Button>
            <Button
              variant="primary-dark"
              onClick={() => {
                router.push("/");
              }}
            >
              처음으로
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Header mode={mode} showHome onHome={handleHome} />
      <main className={styles.screen}>
        <div className={styles.formArea}>
          <div className={styles.intro}>
            <h1 className={styles.title}>회의 녹음 올리기</h1>
            <p className={styles.lead}>
              녹음 파일과 받는 메일 주소는 꼭 입력해야 합니다. 회의 정보는
              비워 두어도 됩니다.
            </p>
          </div>

          <div role="group" aria-label="보내는 방식" className={styles.tabs}>
            <button
              type="button"
              aria-pressed={isA}
              onClick={() => setMode("a")}
              className={`${styles.tab} ${isA ? styles.tabActiveA : ""}`}
            >
              <ReviewModeIcon size={20} strokeWidth={1.8} />
              <span className={styles.tabText}>
                <span className={styles.tabTitle}>검토 후 보내기</span>
                <span className={styles.tabSub}>확인하고 고친 뒤 직접 보냅니다</span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={!isA}
              onClick={() => setMode("b")}
              className={`${styles.tab} ${!isA ? styles.tabActiveB : ""}`}
            >
              <SendModeIcon size={20} strokeWidth={1.8} />
              <span className={styles.tabText}>
                <span className={styles.tabTitle}>바로 보내기</span>
                <span className={styles.tabSub}>검토 없이 곧바로 보냅니다</span>
              </span>
            </button>
          </div>

          {isA ? (
            <p className={`${styles.notice} ${styles.noticeA}`}>
              <span className={styles.noticeIcon}>
                <ReviewModeIcon size={20} strokeWidth={1.8} />
              </span>
              <span>
                <strong>검토 후 보내기</strong> · 회의록이 만들어지면 확인
                화면이 열립니다. 내용을 확인하고 필요하면 고친 뒤 직접
                보냅니다.
              </span>
            </p>
          ) : (
            <p className={`${styles.notice} ${styles.noticeB}`}>
              <span className={styles.noticeIcon}>
                <SendModeIcon size={20} strokeWidth={1.8} />
              </span>
              <span>
                <strong>바로 보내기</strong> · 회의록이 만들어지면 사람의
                검토 없이 곧바로 메일이 나갑니다. 올리기 전에 받는 주소를
                한 번 더 보여 드립니다.
              </span>
            </p>
          )}

          <section aria-labelledby="sec-file" ref={fileSectionRef} className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.stepNum}>1</span>
              <h2 id="sec-file" className={styles.sectionTitle}>
                녹음 파일
              </h2>
              <span className={styles.tagRequired}>필수</span>
            </div>
            <FilePicker
              file={fileState ? { name: fileState.file.name, ext: fileState.ext } : null}
              error={fileError}
              onPick={pickFile}
              onRemove={removeFile}
            />
          </section>

          <section aria-labelledby="sec-info" className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.stepNum}>2</span>
              <h2 id="sec-info" className={styles.sectionTitle}>
                회의 정보
              </h2>
              <span className={styles.tagOptional}>선택</span>
            </div>
            <div className={styles.infoGrid}>
              <div className={styles.field}>
                <label htmlFor="in-title" className={styles.label}>
                  제목
                </label>
                <input
                  id="in-title"
                  type="text"
                  value={title}
                  maxLength={MAX_TITLE_LENGTH}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 신규 기능 출시 일정 회의"
                  className={styles.input}
                />
                <p className={styles.hint}>비우면 AI가 녹음 내용을 바탕으로 짓습니다.</p>
              </div>
              <div className={styles.field}>
                <label htmlFor="in-date" className={styles.label}>
                  일시
                </label>
                <input
                  id="in-date"
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={styles.input}
                />
                <p className={styles.hint}>
                  비우면 녹음 파일에 담긴 시각을 씁니다. 그 시각도 없으면
                  &apos;미정&apos;으로 둡니다.
                </p>
              </div>
            </div>
            <div className={styles.attendeeField}>
              <label htmlFor="in-att" className={styles.label}>
                참석자 이름
              </label>
              <ChipInput
                inputId="in-att"
                listLabel="입력한 참석자"
                items={attendees}
                draft={attendeeDraft}
                error={attendeeError}
                onChange={onAttendeeChange}
                check={attendeeChipCheck}
                placeholder="이름을 쓰고 Enter"
                maxLength={MAX_ATTENDEE_NAME_LENGTH}
                describedBy="att-hint"
              />
              <p id="att-hint" className={styles.hint}>
                녹음 속 호칭과 연결합니다. 확실하지 않은 사람은 &apos;화자1,
                화자2&apos;로 남습니다.
              </p>
            </div>
          </section>

          <section
            aria-labelledby="sec-rcp"
            ref={rcpSectionRef}
            className={`${styles.section} ${!isA ? styles.sectionModeB : ""}`}
          >
            <div className={styles.sectionHead}>
              <span className={styles.stepNum}>3</span>
              <h2 id="sec-rcp" className={styles.sectionTitle}>
                받는 메일 주소
              </h2>
              <span className={styles.tagRequired}>필수</span>
            </div>
            {!isA && (
              <p className={styles.rcpNoticeB}>
                <span className={styles.rcpNoticeIcon}>
                  <SendModeIcon size={18} strokeWidth={1.8} />
                </span>
                <span>
                  바로 보내기에서는 회의록이 만들어지면 이 주소로 검토 없이
                  곧바로 보냅니다.
                </span>
              </p>
            )}
            <ChipInput
              inputId="in-rcp"
              listLabel="받는 사람"
              items={recipients}
              draft={recipientDraft}
              error={recipientError}
              onChange={onRecipientChange}
              check={recipientChipCheck}
              placeholder="name@company.com"
              inputMode="email"
              labelSlot={
                <label htmlFor="in-rcp" className={styles.label}>
                  받는 사람 추가
                </label>
              }
              describedBy="rcp-hint"
            />
            <p id="rcp-hint" className={styles.hint}>
              여러 명에게 보낼 수 있습니다. 주소를 쓰고 Enter나 쉼표를
              누르면 추가됩니다.
            </p>
          </section>
        </div>

        <aside aria-label="보내기 전 확인" className={styles.aside}>
          <h2 className={styles.asideTitle}>보내기 전 확인</h2>
          <dl className={styles.asideList}>
            <div className={styles.asideRow}>
              <dt className={styles.asideDt}>보내는 방식</dt>
              <dd className={styles.asideDd}>
                {isA ? (
                  <span className={`${styles.miniBadge} ${styles.miniBadgeA}`}>
                    검토 후 보내기
                  </span>
                ) : (
                  <span className={`${styles.miniBadge} ${styles.miniBadgeB}`}>
                    바로 보내기 · 검토 없이 발송
                  </span>
                )}
              </dd>
            </div>
            <div className={styles.asideRow}>
              <dt className={styles.asideDt}>녹음 파일</dt>
              <dd className={styles.asideDdStrong}>
                {fileState ? fileState.file.name : "아직 고르지 않았습니다"}
              </dd>
            </div>
            <div className={styles.asideRow}>
              <dt className={styles.asideDt}>받는 사람 {recipientCount}명</dt>
              <dd className={styles.asideDd}>
                {recipientCount > 0 ? (
                  <ul className={styles.asideRcpList}>
                    {recipients.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.textMuted}>아직 없습니다</span>
                )}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={handleSubmit}
            className={`${submitClass} ${styles.submitFull}`}
          >
            {submitLabel}
          </button>
          <p className={styles.hint}>
            {isA
              ? "회의록이 만들어지면 확인 화면이 열립니다. 메일은 확인한 뒤에 보냅니다."
              : "누르면 받는 주소를 한 번 더 보여 드립니다. 확인해야 업로드가 시작됩니다."}
          </p>
        </aside>
      </main>

      <div className={styles.bottomBar} role="group" aria-label="받는 사람">
        <div className={styles.bottomBarInfo}>
          <span className={styles.bottomBarLabel}>받는 사람</span>
          <span className={styles.bottomBarValue}>{rcpSummary}</span>
        </div>
        <button type="button" onClick={handleSubmit} className={submitClass}>
          {submitLabel}
        </button>
      </div>

      <Toast
        open={toastOpen}
        onClose={closeToast}
        title="입력 확인을 마쳤습니다"
        detail={
          isA
            ? "실제 올리기는 다음 단계(EPIC 3)에서 연결합니다."
            : "실제 올리기와 발송은 다음 단계에서 연결합니다."
        }
        autoHideMs={6000}
      />

      <Dialog open={dialog === "leave"} onClose={closeDialog} title="처음 화면으로 갈까요?">
        <p>고른 녹음 파일과 입력한 회의 정보, 받는 주소가 모두 지워집니다.</p>
        <DialogActions>
          <Button variant="secondary" autoFocus onClick={closeDialog}>
            머무르기
          </Button>
          <Button variant="primary-dark" onClick={() => router.push("/")}>
            처음으로
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={dialog === "confirmB"}
        onClose={closeDialog}
        eyebrow={<span className={styles.confirmBEyebrow}>바로 보내기 · 검토 없이 발송</span>}
        title="올리기 전에 받는 주소를 확인하세요"
      >
        <p>
          회의록이 만들어지면 <strong>사람의 검토 없이</strong> 아래 주소로
          곧바로 보냅니다. 주소가 맞는지 확인한 뒤 올리세요.
        </p>
        <div className={styles.confirmBBox}>
          <p className={styles.confirmBCount}>받는 사람 {recipientCount}명</p>
          <ul className={styles.confirmBList}>
            {recipients.map((r) => (
              <li key={r}>
                <MailIcon size={18} strokeWidth={1.8} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <dl className={styles.confirmBDl}>
          <dt>녹음 파일</dt>
          <dd>{fileState ? fileState.file.name : ""}</dd>
          <dt>메일 구성</dt>
          <dd>본문에 요약 · 결정사항 · 할 일, 전체 회의록 .md 파일 첨부</dd>
        </dl>
        <DialogActions>
          <Button variant="secondary" autoFocus onClick={closeDialog}>
            주소 고치기
          </Button>
          <Button variant="primary-b" onClick={confirmBGo}>
            이 주소로 올리고 보내기
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
