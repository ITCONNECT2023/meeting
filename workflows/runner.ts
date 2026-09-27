import { lockJobStart } from "@/lib/store/jobs";
import { processMeetingWorkflow } from "./process-meeting";

export async function startProcessMeeting(jobId: string): Promise<boolean> {
  const acquired = await lockJobStart(jobId);
  if (!acquired) {
    // Already started once
    return false;
  }

  if (process.env.NODE_ENV === "test" || process.env.WORKFLOW_RUNNER === "in-process") {
    void processMeetingWorkflow(jobId);
    return true;
  }

  try {
    const { start } = await import("workflow/api");
    await start(processMeetingWorkflow, [jobId]);
  } catch {
    // Fallback to in-process execution for environments without a running workflow queue
    void processMeetingWorkflow(jobId);
  }

  return true;
}
