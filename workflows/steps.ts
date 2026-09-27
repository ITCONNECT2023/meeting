import { transcribeAudio } from "@/lib/ai/transcribe";
import { writeMeetingMinutes } from "@/lib/ai/write-minutes";
import { getStorage } from "@/lib/storage";
import { getJob, updateJob } from "@/lib/store/jobs";
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
): Promise<{ audioPath: string; fileName: string; attendees?: string[] }> {
  "use step";
  const job = await getJob(jobId);
  if (!job) {
    throw new Error("작업을 찾을 수 없습니다.");
  }
  const storage = getStorage();
  const audioPath = await storage.getAudioPath(jobId);
  if (!audioPath) {
    const err = new Error("녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.");
    (err as { code?: string }).code = "FILE_CORRUPT";
    throw err;
  }
  return { audioPath, fileName: job.fileName, attendees: job.inputAttendees };
}

export async function stepTranscribeAudio(
  audioPath: string,
  fileName: string,
  attendees?: string[],
): Promise<{ script: ScriptLine[]; durationSeconds: number }> {
  "use step";
  return transcribeAudio({
    filePath: audioPath,
    fileName,
    attendees,
  });
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
): Promise<{ minutes: MeetingMinutes }> {
  "use step";
  return writeMeetingMinutes({
    script,
    title,
    date,
    attendees,
    fileName,
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
): Promise<void> {
  "use step";
  const job = await getJob(jobId);
  if (!job) return;
  await updateJob(jobId, {
    status: "review",
    minutes,
    steps: {
      ...job.steps,
      minutes: {
        status: "completed",
        startedAt: job.steps.minutes?.startedAt ?? Date.now(),
        completedAt: Date.now(),
      },
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
