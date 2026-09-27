import "server-only";

import { getJob, updateJob, lockJobSend, unlockJobSend } from "@/lib/store/jobs";
import { renderEmail } from "@/lib/minutes/render-email";
import { sendEmail } from "@/lib/mail/smtp";
import { checkBouncesForJob } from "@/lib/mail/bounce";
import type { JobRecord, RecipientResult } from "@/lib/minutes/types";

export interface SendWorkflowOptions {
  isRetry?: boolean;
  immediateResolve?: boolean;
}

export interface SendWorkflowResult {
  ok: boolean;
  job: JobRecord;
  recipientResults: RecipientResult[];
  error?: string;
}

/**
 * Orchestrates sending meeting minutes emails and tracking per-recipient bounce statuses.
 * Enforces single concurrency per job, allowlist guards, duplicate dispatch prevention,
 * and 2-minute bounce polling.
 */
export async function executeSendWorkflow(
  jobId: string,
  options: SendWorkflowOptions = {}
): Promise<SendWorkflowResult> {
  const { isRetry = false, immediateResolve = false } = options;

  // 1. Lock job send to prevent duplicate concurrent dispatches
  const locked = await lockJobSend(jobId);
  if (!locked) {
    throw new Error("이미 발송 중입니다.");
  }

  try {
    // 2. Fetch job from store
    const job = await getJob(jobId);
    if (!job) {
      throw new Error("작업을 찾을 수 없습니다.");
    }
    if (!job.minutes) {
      throw new Error("회의록이 준비되지 않았습니다.");
    }

    const existingResults = job.recipientResults || [];
    const alreadySent = new Set(
      existingResults
        .filter((r) => r.status === "sent")
        .map((r) => r.email.toLowerCase())
    );

    // 3. Determine target recipients
    let targetRecipients: string[] = [];

    if (isRetry) {
      // Only resend to recipients that failed previously
      targetRecipients = job.recipients.filter((r) => {
        const clean = r.toLowerCase();
        if (alreadySent.has(clean)) return false;
        return existingResults.some(
          (er) => er.email.toLowerCase() === clean && er.status === "failed"
        );
      });
    } else {
      // Normal send: exclude already sent addresses
      targetRecipients = job.recipients.filter(
        (r) => !alreadySent.has(r.toLowerCase())
      );
    }

    if (targetRecipients.length === 0) {
      // Nothing to send (e.g. all already sent)
      await unlockJobSend(jobId);
      return {
        ok: true,
        job,
        recipientResults: existingResults,
      };
    }

    // 4. Render email subject, body, attachment
    const emailData = renderEmail({ minutes: job.minutes, createdAt: job.createdAt });

    // 5. Initialize target recipient results with "pending" (확인 중)
    const pendingResults: RecipientResult[] = [...existingResults];
    for (const email of targetRecipients) {
      const idx = pendingResults.findIndex(
        (r) => r.email.toLowerCase() === email.toLowerCase()
      );
      if (idx >= 0) {
        pendingResults[idx] = { email, status: "pending" };
      } else {
        pendingResults.push({ email, status: "pending" });
      }
    }

    // 6. Attempt SMTP dispatch
    let sendResponse;
    try {
      sendResponse = await sendEmail({
        jobId,
        recipients: targetRecipients,
        subject: emailData.subject,
        text: emailData.text,
        html: emailData.html,
        attachments: [
          {
            filename: emailData.attachment.filename,
            content: emailData.attachment.content,
            contentType: emailData.attachment.contentType,
          },
        ],
      });
    } catch (smtpErr: unknown) {
      // Gmail refused outright (접수 거절) -> Stay on review screen for Mode A
      await unlockJobSend(jobId);
      const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
      throw new Error(msg || "메일을 보내지 못했습니다. 잠시 뒤 다시 보내 주세요.");
    }

    // 7. Update immediate results in store: job.status = "sent", recipientResults = pendingResults
    // Check if any recipient was blocked by allowlist or rejected immediately
    for (const res of sendResponse.results) {
      if (res.status === "failed") {
        const idx = pendingResults.findIndex(
          (r) => r.email.toLowerCase() === res.email.toLowerCase()
        );
        if (idx >= 0) {
          pendingResults[idx] = {
            email: res.email,
            status: "failed",
            errorReason: res.errorReason,
          };
        }
      }
    }

    const updatedJob = await updateJob(jobId, {
      status: "sent",
      recipientResults: pendingResults,
      steps: {
        ...job.steps,
        ...(job.mode === "B" || job.steps.send
          ? { send: { status: "completed", completedAt: Date.now() } }
          : {}),
      },
    });

    const finalJob = updatedJob || job;

    // 8. Bounce resolution (background or immediate)
    const resolveBounces = async () => {
      try {
        const bounceMap = await checkBouncesForJob({
          jobId,
          recipients: targetRecipients,
          messageId: sendResponse.messageId,
        });

        const currentJob = await getJob(jobId);
        if (!currentJob) return;

        const currentResults = currentJob.recipientResults || pendingResults;
        const finalized = currentResults.map((r) => {
          const bounce = bounceMap.get(r.email);
          if (bounce) {
            return {
              email: r.email,
              status: "failed" as const,
              errorReason: bounce.reason,
            };
          }
          if (r.status === "pending") {
            return {
              email: r.email,
              status: "sent" as const,
            };
          }
          return r;
        });

        await updateJob(jobId, {
          recipientResults: finalized,
        });
      } finally {
        await unlockJobSend(jobId);
      }
    };

    if (immediateResolve) {
      await resolveBounces();
      const resolvedJob = (await getJob(jobId)) || finalJob;
      return {
        ok: true,
        job: resolvedJob,
        recipientResults: resolvedJob.recipientResults || pendingResults,
      };
    } else {
      // In development / test, resolve after 1.5 seconds so "확인 중" is visible in UI,
      // or for real SMTP, run the full 2-minute IMAP polling cycle.
      const delayMs = process.env.MAIL_PROVIDER === "smtp" ? 15000 : 1500;
      setTimeout(() => {
        void resolveBounces();
      }, delayMs);

      return {
        ok: true,
        job: finalJob,
        recipientResults: pendingResults,
      };
    }
  } catch (err) {
    await unlockJobSend(jobId);
    throw err;
  }
}
