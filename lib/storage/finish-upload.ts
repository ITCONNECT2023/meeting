import "server-only";

import { getJob, updateJob } from "@/lib/store/jobs";
import { startProcessMeeting } from "@/workflows/runner";

/**
 * Marks a job's upload as done and starts processing. Two paths call this
 * for the same upload (the Blob completion callback and the browser's own
 * "I'm done" request, EPIC 10-3), so it is safe to call more than once:
 * the start lock in `startProcessMeeting` lets only the first one through.
 */
export async function finishUpload(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  if (!job) return false;

  if (job.steps.upload?.status !== "completed") {
    await updateJob(jobId, {
      steps: {
        ...job.steps,
        upload: {
          status: "completed",
          startedAt: job.steps.upload?.startedAt ?? job.createdAt,
          completedAt: Date.now(),
        },
      },
    });
  }

  await startProcessMeeting(jobId);
  return true;
}
