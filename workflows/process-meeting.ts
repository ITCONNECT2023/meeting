import type { ScriptLine } from "@/lib/minutes/types";
import {
  stepCleanupAudio,
  stepFailJob,
  stepGetJob,
  stepPrepareAudio,
  stepSaveMinutesToJob,
  stepTranscribeAudio,
  stepUpdateMinutesStarted,
  stepUpdateTranscribeStarted,
  stepVerifyMinutes,
  stepVerifyTranscript,
  stepWriteMinutes,
} from "./steps";

export interface ProcessMeetingResult {
  ok: boolean;
  jobId: string;
  error?: string;
  errorMessage?: string;
}

export async function processMeetingWorkflow(jobId: string): Promise<ProcessMeetingResult> {
  "use workflow";

  const initialJob = await stepGetJob(jobId);
  if (!initialJob) {
    return { ok: false, jobId, error: "JOB_NOT_FOUND" };
  }

  try {
    const transcribeStartTime = Date.now();
    await stepUpdateTranscribeStarted(jobId, transcribeStartTime);

    // Step A: Prepare audio
    let audioPrep;
    try {
      audioPrep = await stepPrepareAudio(jobId);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err.code || "FILE_CORRUPT";
      const msg =
        err.message ||
        "녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.";
      await stepFailJob(jobId, "transcribe", code, msg);
      return { ok: false, jobId, error: code, errorMessage: msg };
    }

    // Step B & C: Transcribe
    let script: ScriptLine[] = [];
    let durationSeconds = 0;
    let transcribeMaskedCount = 0;
    try {
      const transcribed = await stepTranscribeAudio(
        audioPrep.audioPath,
        audioPrep.fileName,
        audioPrep.attendees,
      );
      script = transcribed.script;
      durationSeconds = transcribed.durationSeconds;
      transcribeMaskedCount = transcribed.maskedCount ?? 0;
      await stepVerifyTranscript(script);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err.code || "TRANSCRIBE_FAILED";
      const msg = err.message || "스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
      await stepFailJob(jobId, "transcribe", code, msg);
      return { ok: false, jobId, error: code, errorMessage: msg };
    } finally {
      // Audio must be deleted immediately after transcribe
      await stepCleanupAudio(jobId);
    }

    // Step F: Write meeting minutes
    const minutesStartTime = Date.now();
    await stepUpdateMinutesStarted(jobId, minutesStartTime, durationSeconds);

    let minutesResult;
    try {
      minutesResult = await stepWriteMinutes(
        script,
        initialJob.inputTitle,
        initialJob.inputDate,
        initialJob.inputAttendees,
        initialJob.fileName,
      );
      await stepVerifyMinutes(minutesResult.minutes);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const code = err.code || "MINUTES_FAILED";
      const msg = err.message || "회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
      await stepFailJob(jobId, "minutes", code, msg);
      return { ok: false, jobId, error: code, errorMessage: msg };
    }

    // Step G: Save minutes & update status to review
    await stepSaveMinutesToJob(jobId, minutesResult.minutes, transcribeMaskedCount);

    return { ok: true, jobId };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const code = err.code || "TRANSCRIBE_FAILED";
    const msg = err.message || "스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
    await stepFailJob(jobId, "transcribe", code, msg);
    return { ok: false, jobId, error: code, errorMessage: msg };
  }
}
