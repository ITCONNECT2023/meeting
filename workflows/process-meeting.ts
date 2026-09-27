import { transcribeAudio } from "@/lib/ai/transcribe";
import { writeMeetingMinutes } from "@/lib/ai/write-minutes";
import { getStorage } from "@/lib/storage";
import { getJob, updateJob } from "@/lib/store/jobs";
import type { JobRecord, ScriptLine } from "@/lib/minutes/types";

export interface ProcessMeetingResult {
  ok: boolean;
  jobId: string;
  error?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Step functions
// ---------------------------------------------------------------------------

export async function stepA_prepareAudio(job: JobRecord): Promise<{ audioPath: string }> {
  "use step";
  const storage = getStorage();
  const audioPath = await storage.getAudioPath(job.id);
  if (!audioPath) {
    const err = new Error("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
    (err as { code?: string }).code = "FILE_CORRUPT";
    throw err;
  }
  return { audioPath };
}

export async function stepB_identifySpeakers(job: JobRecord): Promise<{ speakers: string[] }> {
  "use step";
  // In EPIC 3 (fake AI), speaker identification uses the input attendees or default speakers
  const speakers = job.inputAttendees && job.inputAttendees.length > 0
    ? [...job.inputAttendees, "화자3"]
    : ["김민수", "이지은", "화자3"];
  return { speakers };
}

export async function stepC_transcribeAudio(
  job: JobRecord,
  audioPath: string,
): Promise<{ script: ScriptLine[]; durationSeconds: number }> {
  "use step";
  const result = await transcribeAudio({
    filePath: audioPath,
    fileName: job.fileName,
    attendees: job.inputAttendees,
  });

  return result;
}

export async function stepD_verifyTranscript(
  script: ScriptLine[],
): Promise<void> {
  "use step";
  if (!script || script.length === 0) {
    const err = new Error("녹음에서 말소리를 찾지 못했습니다. 파일을 확인해 주세요.");
    (err as { code?: string }).code = "NO_SPEECH";
    throw err;
  }
}

export async function stepE_cleanupAudio(jobId: string): Promise<void> {
  "use step";
  const storage = getStorage();
  await storage.deleteAudio(jobId);
}

export async function stepF_writeMinutes(
  job: JobRecord,
  script: ScriptLine[],
) {
  "use step";
  try {
    const result = await writeMeetingMinutes({
      script,
      title: job.inputTitle,
      date: job.inputDate,
      attendees: job.inputAttendees,
      fileName: job.fileName,
    });
    return result;
  } catch {
    const err = new Error("회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    (err as { code?: string }).code = "MINUTES_FAILED";
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main workflow orchestration
// ---------------------------------------------------------------------------

export async function processMeetingWorkflow(jobId: string): Promise<ProcessMeetingResult> {
  "use workflow";

  const initialJob = await getJob(jobId);
  if (!initialJob) {
    return { ok: false, jobId, error: "JOB_NOT_FOUND" };
  }

  // Helper to fail job cleanly and delete audio
  const failJob = async (stepName: "transcribe" | "minutes", code: string, message: string) => {
    const storage = getStorage();
    await storage.deleteAudio(jobId);
    await updateJob(jobId, {
      status: "failed",
      error: code,
      errorMessage: message,
      steps: {
        ...initialJob.steps,
        [stepName]: {
          status: "failed",
          completedAt: Date.now(),
          error: code,
          errorMessage: message,
        },
      },
    });
    return { ok: false, jobId, error: code, errorMessage: message };
  };

  try {
    // 1. Start transcribe step
    const transcribeStartTime = Date.now();
    await updateJob(jobId, {
      steps: {
        ...initialJob.steps,
        transcribe: { status: "running", startedAt: transcribeStartTime },
      },
    });

    // Step A: Prepare audio
    let audioPath = "";
    try {
      const prep = await stepA_prepareAudio(initialJob);
      audioPath = prep.audioPath;
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      return await failJob(
        "transcribe",
        err.code || "FILE_CORRUPT",
        err.message || "녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.",
      );
    }

    // Step B & C: Transcribe
    let script: ScriptLine[] = [];
    try {
      await stepB_identifySpeakers(initialJob);
      const transcribed = await stepC_transcribeAudio(initialJob, audioPath);
      script = transcribed.script;
      await stepD_verifyTranscript(script);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      return await failJob(
        "transcribe",
        err.code || "TRANSCRIBE_FAILED",
        err.message || "스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      );
    } finally {
      // Step E: Audio origin MUST be deleted immediately after transcribe
      await stepE_cleanupAudio(jobId);
    }

    // Finish transcribe step
    const transcribeEndTime = Date.now();
    const minutesStartTime = Date.now();
    await updateJob(jobId, {
      audioDeleted: true,
      steps: {
        ...initialJob.steps,
        transcribe: {
          status: "completed",
          startedAt: transcribeStartTime,
          completedAt: transcribeEndTime,
        },
        minutes: { status: "running", startedAt: minutesStartTime },
      },
    });

    // Step F: Write meeting minutes
    let minutesResult;
    try {
      minutesResult = await stepF_writeMinutes(initialJob, script);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      return await failJob(
        "minutes",
        err.code || "MINUTES_FAILED",
        err.message || "회의록을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      );
    }

    // Step G: Save minutes & update status
    const minutesEndTime = Date.now();
    await updateJob(jobId, {
      status: initialJob.mode === "B" ? "processing" : "review",
      minutes: minutesResult.minutes,
      steps: {
        ...initialJob.steps,
        transcribe: {
          status: "completed",
          startedAt: transcribeStartTime,
          completedAt: transcribeEndTime,
        },
        minutes: {
          status: "completed",
          startedAt: minutesStartTime,
          completedAt: minutesEndTime,
        },
      },
    });

    // If Mode B, the next step (send mail) will be triggered in EPIC 8
    return { ok: true, jobId };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    return await failJob(
      "transcribe",
      err.code || "TRANSCRIBE_FAILED",
      err.message || "스크립트를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
    );
  }
}
