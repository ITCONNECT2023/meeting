import { transcribeAudio } from "@/lib/ai/transcribe";
import { writeMeetingMinutes } from "@/lib/ai/write-minutes";
import { maskMinutes, maskScript } from "@/lib/privacy/mask";
import { getStorage } from "@/lib/storage";
import { missingAudioError } from "@/lib/storage/types";
import { deleteJob, getJob, updateJob } from "@/lib/store/jobs";
import { executeSendWorkflow } from "./send-mail";
import type { JobRecord, MeetingMinutes, ScriptLine } from "@/lib/minutes/types";

export async function stepGetJob(jobId: string): Promise<JobRecord | null> {
  "use step";
  return getJob(jobId);
}

export async function stepUpdateTranscribeStarted(
  jobId: string,
  startedAt: number,
): Promise<void> {
  "use step";
  const job = await getJob(jobId);
  if (!job) return;
  await updateJob(jobId, {
    steps: {
      ...job.steps,
      transcribe: { status: "running", startedAt },
    },
  });
}

export async function stepPrepareAudio(
  jobId: string,
): Promise<{
  fileName: string;
  attendees?: string[];
  durationSeconds?: number;
  recordedAt?: string;
}> {
  "use step";
  const job = await getJob(jobId);
  if (!job) {
    throw new Error("작업을 찾을 수 없습니다.");
  }
  // Only checks that the recording is there. The file itself is read in
  // stepTranscribeAudio, because on Vercel each step can run on a different
  // machine and a temporary file would not survive to the next step (EPIC 10-3).
  if (!(await getStorage().hasAudio(jobId))) {
    throw missingAudioError();
  }
  return {
    fileName: job.fileName,
    attendees: job.inputAttendees,
    durationSeconds: job.durationSeconds,
    recordedAt: job.recordedAt,
  };
}

export async function stepTranscribeAudio(
  jobId: string,
  fileName: string,
  attendees?: string[],
  durationSeconds?: number,
): Promise<{ script: ScriptLine[]; durationSeconds: number; maskedCount: number }> {
  "use step";
  const result = await getStorage().withAudioFile(jobId, (audioPath) =>
    transcribeAudio({
      filePath: audioPath,
      fileName,
      attendees,
      jobId,
      durationSeconds,
    }),
  );
  const { script: maskedScript, count: maskedCount } = maskScript(result.script);
  return {
    ...result,
    script: maskedScript,
    maskedCount,
  };
}

export async function stepVerifyTranscript(
  script: ScriptLine[],
): Promise<void> {
  "use step";
  if (!script || script.length === 0) {
    const err = new Error("녹음에서 말소리를 찾지 못했습니다. 파일을 확인해 주세요.");
    (err as { code?: string }).code = "NO_SPEECH";
    throw err;
  }
}

export async function stepCleanupAudio(jobId: string): Promise<void> {
  "use step";
  const storage = getStorage();
  await storage.deleteAudio(jobId);
  await updateJob(jobId, { audioDeleted: true });
}

export async function stepUpdateMinutesStarted(
  jobId: string,
  startedAt: number,
  transcribeDuration: number,
): Promise<void> {
  "use step";
  const job = await getJob(jobId);
  if (!job) return;
  await updateJob(jobId, {
    steps: {
      ...job.steps,
      transcribe: {
        status: "completed",
        startedAt: job.steps.transcribe?.startedAt ?? Date.now(),
        completedAt: Date.now(),
      },
      minutes: { status: "running", startedAt },
    },
    durationSeconds: transcribeDuration,
  });
}

export async function stepWriteMinutes(
  script: ScriptLine[],
  title?: string,
  date?: string,
  attendees?: string[],
  fileName?: string,
  jobId?: string,
  recordedAt?: string,
): Promise<{ minutes: MeetingMinutes }> {
  "use step";
  return writeMeetingMinutes({
    script,
    title,
    date,
    attendees,
    fileName,
    jobId,
    recordedAt,
  });
}

export async function stepVerifyMinutes(
  minutes: MeetingMinutes,
): Promise<void> {
  "use step";
  if (!minutes || !minutes.title || !minutes.script) {
    const err = new Error("회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    (err as { code?: string }).code = "MINUTES_FAILED";
    throw err;
  }
}

export async function stepSaveMinutesToJob(
  jobId: string,
  minutes: MeetingMinutes,
  transcribeMaskedCount?: number,
): Promise<void> {
  "use step";
  const job = await getJob(jobId);
  if (!job) return;
  const { minutes: maskedMinutes, count: minutesMaskedCount } = maskMinutes(minutes);
  const totalMasked = (transcribeMaskedCount ?? 0) + minutesMaskedCount;
  const isModeB = job.mode === "B";
  await updateJob(jobId, {
    status: isModeB ? "processing" : "review",
    minutes: maskedMinutes,
    maskedCount: totalMasked,
    steps: {
      ...job.steps,
      minutes: {
        status: "completed",
        startedAt: job.steps.minutes?.startedAt ?? Date.now(),
        completedAt: Date.now(),
      },
      ...(isModeB
        ? {
            send: {
              status: "running",
              startedAt: Date.now(),
            },
          }
        : {}),
    },
  });
}

export async function stepFailJob(
  jobId: string,
  stepName: "transcribe" | "minutes",
  code: string,
  message: string,
): Promise<void> {
  "use step";
  const storage = getStorage();
  await storage.deleteAudio(jobId);
  const job = await getJob(jobId);
  if (!job) return;
  await updateJob(jobId, {
    status: "failed",
    error: code,
    errorMessage: message,
    steps: {
      ...job.steps,
      [stepName]: {
        status: "failed",
        completedAt: Date.now(),
        error: code,
        errorMessage: message,
      },
    },
  });
}

export async function stepSendMail(jobId: string): Promise<void> {
  "use step";
  try {
    await executeSendWorkflow(jobId);
  } catch (sendErr: unknown) {
    // Log policy (TRD 5): job id + error code only. `sendErr` may be an
    // SMTP/IMAP error whose message can embed a recipient address, so it
    // must never be passed to the logger.
    const code = (sendErr as { code?: string } | undefined)?.code ?? "SEND_FAILED";
    console.error(`[send] job=${jobId} step=send-mail error=${code}`);
  }
}

export async function stepCheckClientLeftAndCleanup(jobId: string): Promise<void> {
  "use step";
  const checkJob = await getJob(jobId);
  if (checkJob?.clientLeft) {
    await deleteJob(jobId);
  }
}
