import Link from "next/link";

import { Header } from "@/components/Header/Header";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  ClockCircleIcon,
  DeleteIcon,
  InfoCircleIcon,
  LockIcon,
  ReviewModeIcon,
  SendModeIcon,
} from "@/components/icons";

import styles from "./page.module.css";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className={styles.main}>
        <div className={styles.intro}>
          <h1 className={styles.title}>
            회의 녹음을 올리면, 녹음에 근거한 회의록을 만들어 팀원에게
            보냅니다
          </h1>
          <p className={styles.lead}>
            먼저 보내는 방식을 고르세요. 어느 방식이든 만들어진 회의록을
            화면에서 보고 .md 파일로 내려받을 수 있습니다.
          </p>
        </div>

        <div className={styles.cards}>
          <Link
            href="/new?mode=a"
            className={`${styles.card} ${styles.cardA}`}
          >
            <span className={styles.cardHead}>
              <span className={`${styles.cardIcon} ${styles.cardIconA}`}>
                <ReviewModeIcon size={24} />
              </span>
              <span className={styles.cardHeadText}>
                <span className={`${styles.cardEyebrow} ${styles.cardEyebrowA}`}>
                  방식 A
                </span>
                <span className={styles.cardTitle}>검토 후 보내기</span>
              </span>
            </span>
            <p className={styles.cardDesc}>
              AI가 만든 회의록을 화면에서 확인하고, 필요하면 고친 뒤 직접
              메일로 보냅니다.
            </p>
            <span className={`${styles.steps} ${styles.stepsA}`}>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumA}`}>
                  1
                </span>
                녹음 올리기 · 받는 주소 입력
              </span>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumA}`}>
                  2
                </span>
                화면에서 회의록 확인 · 고치기
              </span>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumA}`}>
                  3
                </span>
                메일 보내기 · .md 내려받기
              </span>
            </span>
            <span className={`${styles.cta} ${styles.ctaA}`}>
              검토 후 보내기로 시작
              <ArrowRightIcon />
            </span>
          </Link>

          <Link
            href="/new?mode=b"
            className={`${styles.card} ${styles.cardB}`}
          >
            <span className={styles.cardHead}>
              <span className={`${styles.cardIcon} ${styles.cardIconB}`}>
                <SendModeIcon size={24} />
              </span>
              <span className={styles.cardHeadText}>
                <span className={`${styles.cardEyebrow} ${styles.cardEyebrowB}`}>
                  방식 B
                </span>
                <span className={styles.cardTitle}>바로 보내기</span>
              </span>
            </span>
            <p className={styles.cardDesc}>
              회의록이 만들어지면 사람의 검토 없이 곧바로 메일을 보냅니다.
              보낸 결과는 화면에서 볼 수 있습니다.
            </p>
            <span className={`${styles.steps} ${styles.stepsB}`}>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumB}`}>
                  1
                </span>
                녹음 올리기 · 받는 주소 입력
              </span>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumB}`}>
                  2
                </span>
                올리기 전에 받는 주소 확인
              </span>
              <span className={styles.step}>
                <span className={`${styles.stepNum} ${styles.stepNumB}`}>
                  3
                </span>
                자동 발송 · 결과 보기 · .md 내려받기
              </span>
            </span>
            <span className={styles.warning}>
              <span className={styles.warningIcon}>
                <AlertCircleIcon />
              </span>
              <span>
                사람이 확인하지 않고 보내기 때문에, 올리기 전에 받는 주소를
                한 번 더 보여 드립니다.
              </span>
            </span>
            <span className={`${styles.cta} ${styles.ctaB}`}>
              바로 보내기로 시작
              <ArrowRightIcon />
            </span>
          </Link>
        </div>

        <section className={styles.howSection} aria-labelledby="how-heading">
          <h2 id="how-heading" className={styles.howTitle}>
            회의록은 이렇게 만듭니다
          </h2>
          <div className={styles.howGrid}>
            <div className={styles.howItem}>
              <span className={styles.howIcon}>
                <InfoCircleIcon />
              </span>
              <p className={styles.howText}>
                녹음에서 확인되지 않는 내용은 지어내지 않고{" "}
                <span className={styles.chipDashed}>미정</span>으로 둡니다.
              </p>
            </div>
            <div className={styles.howItem}>
              <span className={styles.howIcon}>
                <ClockCircleIcon />
              </span>
              <p className={styles.howText}>
                결정사항과 할 일에는 녹음 속 위치{" "}
                <code className={styles.chipMono}>[12:34]</code>를 붙여
                원래 발언을 찾을 수 있게 합니다.
              </p>
            </div>
            <div className={styles.howItem}>
              <span className={styles.howIcon}>
                <DeleteIcon />
              </span>
              <p className={styles.howText}>
                녹음은 Google AI(Gemini)로 처리한 뒤 바로 삭제하고, 회의록도
                서비스에 쌓아 두지 않습니다.
              </p>
            </div>
            <div className={styles.howItem}>
              <span className={styles.howIcon}>
                <LockIcon />
              </span>
              <p className={styles.howText}>
                주민등록번호·전화번호·계좌번호·카드번호는 ***로 가립니다.
                이름, 주소, 말로 풀어 읽은 번호(예: “공일공 일이삼사”)는
                가리지 못할 수 있습니다.
              </p>
            </div>
          </div>
          <p className={styles.formats}>지원 형식: mp3 · m4a · wav</p>
        </section>
      </main>
    </>
  );
}
