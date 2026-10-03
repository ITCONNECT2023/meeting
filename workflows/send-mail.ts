import "server-only";

import { getJob, updateJob, deleteJob, lockJobSend, unlockJobSend } from "@/lib/store/jobs";
import { renderEmail } from "@/lib/minutes/render-email";
import {
  createMessageId,
  sendEmail,
  wasMessageSent,
  type SendEmailResponse,
} from "@/lib/mail/smtp";
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
 * EPIC 7-4 / TRD ④-7: if the previous attempt was written down but its
 * outcome never saved (server stopped, reply from Gmail lost, workflow step
 * re-run), look for its Message-ID in Sent Mail. Returns the addresses that
 * attempt already delivered to (and that aren't recorded as accepted yet).
 * Throws if Sent Mail can't be checked: re-sending blind could duplicate.
 */
async function findInterruptedDelivery(
  job: JobRecord,
  alreadyAccepted: Set<string>,
): Promise<string[]> {
  const attempt = job.sendAttempt;
  if (!attempt) return [];

  let delivered: boolean;
  try {
    delivered = await wasMessageSent(attempt.messageId);
  } catch {
    const err = new Error(
      "앞서 보낸 메일이 나갔는지 확인하지 못했습니다. 잠시 뒤 다시 보내 주세요.",
    );
    (err as { code?: string }).code = "SENT_CHECK_FAILED";
    throw err;
  }
  if (!delivered) return [];

  return attempt.recipients.filter((e) => !alreadyAccepted.has(e.toLowerCase()));
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

  // 1. Lock job send to prevent duplicate concurrent dispatches. The token
  // makes sure we only ever release our own lock.
  const lockToken = await lockJobSend(jobId);
  if (!lockToken) {
    throw new Error("이미 발송 중입니다.");
  }
  const releaseLock = () => unlockJobSend(jobId, lockToken);

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
    // "보냄" and "확인 중" both mean Gmail already accepted the mail for that
    // address — "확인 중" is only written after Gmail's acceptance. Neither
    // may be handed to Gmail again (FRD 3-4), even if the bounce check never
    // finished (server stopped, lock expired) and someone sends again.
    const alreadyAccepted = new Set(
      existingResults
        .filter((r) => r.status === "sent" || r.status === "pending")
        .map((r) => r.email.toLowerCase())
    );

    const recovered = await findInterruptedDelivery(job, alreadyAccepted);

    // 3. Determine target recipients and hand them to Gmail
    let targetRecipients: string[] = [];
    let sendResponse: SendEmailResponse;
    let sentAt: number;

    if (recovered.length > 0 && job.sendAttempt) {
      // The interrupted attempt did reach Gmail: finish recording it instead
      // of sending again.
      const { messageId } = job.sendAttempt;
      targetRecipients = recovered;
      sentAt = job.sendAttempt.startedAt;
      sendResponse = {
        ok: true,
        messageId,
        results: recovered.map((email) => ({ email, status: "pending", messageId })),
      };
    } else {
      if (isRetry) {
        // Only resend to recipients that failed previously
        targetRecipients = job.recipients.filter((r) => {
          const clean = r.toLowerCase();
          if (alreadyAccepted.has(clean)) return false;
          return existingResults.some(
            (er) => er.email.toLowerCase() === clean && er.status === "failed"
          );
        });
      } else {
        // Normal send: exclude addresses Gmail already accepted
        targetRecipients = job.recipients.filter(
          (r) => !alreadyAccepted.has(r.toLowerCase())
        );
      }

      if (targetRecipients.length === 0) {
        // Nothing to send (e.g. all already sent)
        if (job.sendAttempt) {
          await updateJob(jobId, { sendAttempt: undefined });
        }
        await releaseLock();
        return {
          ok: true,
          job,
          recipientResults: existingResults,
        };
      }

      // 4. Render email subject, body, attachment
      const emailData = renderEmail({ minutes: job.minutes, createdAt: job.createdAt });

      // 5. Write the attempt down BEFORE Gmail gets it, so an interrupted
      // attempt can be found in Sent Mail by this exact Message-ID (7-4).
      const messageId = createMessageId(jobId);
      sentAt = Date.now();
      await updateJob(jobId, {
        sendAttempt: { messageId, recipients: targetRecipients, startedAt: sentAt },
      });

      // 6. Attempt SMTP dispatch
      try {
        sendResponse = await sendEmail({
          jobId,
          recipients: targetRecipients,
          subject: emailData.subject,
          text: emailData.text,
          html: emailData.html,
          messageId,
          attachments: [
            {
              filename: emailData.attachment.filename,
              content: emailData.attachment.content,
              contentType: emailData.attachment.contentType,
            },
          ],
        });
      } catch (smtpErr: unknown) {
        // `sendAttempt` is deliberately kept: the error may have come after
        // Gmail took the mail (lost reply), so the next try checks Sent Mail
        // before sending again.
        if (job.mode === "B") {
          const mergedResults: RecipientResult[] = [...existingResults];
          for (const email of targetRecipients) {
            const idx = mergedResults.findIndex(
              (r) => r.email.toLowerCase() === email.toLowerCase()
            );
            const item: RecipientResult = {
              email,
              status: "failed",
              errorReason: "서비스 일시 장애",
            };
            if (idx >= 0) {
              mergedResults[idx] = item;
            } else {
              mergedResults.push(item);
            }
          }
          const updatedJob = await updateJob(jobId, {
            status: "sent",
            recipientResults: mergedResults,
            steps: {
              ...job.steps,
              send: { status: "completed", completedAt: Date.now() },
            },
          });
          await releaseLock();
          return {
            ok: false,
            job: updatedJob || job,
            recipientResults: mergedResults,
            error: "메일을 보내지 못했습니다.",
          };
        }

        // Gmail refused outright (접수 거절) -> Stay on review screen for Mode A
        await releaseLock();
        const msg = smtpErr instanceof Error ? smtpErr.message : String(smtpErr);
        throw new Error(msg || "메일을 보내지 못했습니다. 잠시 뒤 다시 보내 주세요.");
      }
    }

    // 7. Initialize target recipient results with "pending" (확인 중), then
    // apply addresses blocked by the allowlist or rejected immediately.
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

    // Results and the cleared attempt marker land in one write.
    const updatedJob = await updateJob(jobId, {
      status: "sent",
      recipientResults: pendingResults,
      sendAttempt: undefined,
      steps: {
        ...job.steps,
        ...(job.mode === "B" || job.steps.send
          ? { send: { status: "completed", completedAt: Date.now() } }
          : {}),
      },
    });

    const finalJob = updatedJob || job;

    // Only addresses Gmail accepted can bounce. A fully blocked send (e.g.
    // empty allowlist) has nothing to look for.
    const acceptedRecipients = sendResponse.results
      .filter((r) => r.status === "pending")
      .map((r) => r.email);

    // 8. Bounce resolution (background or immediate)
    const resolveBounces = async () => {
      try {
        const bounceMap =
          acceptedRecipients.length > 0
            ? await checkBouncesForJob({
                jobId,
                recipients: acceptedRecipients,
                messageId: sendResponse.messageId,
                sentAt,
              })
            : new Map<string, { status: "failed"; reason: string }>();

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
        const checkJob = await getJob(jobId);
        if (checkJob?.clientLeft) {
          await deleteJob(jobId);
        }
        await releaseLock();
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
        resolveBounces().catch((err: unknown) => {
          // Log policy (TRD 5): job id + error code only.
          const code = (err as { code?: string } | undefined)?.code ?? "BOUNCE_RESOLVE_FAILED";
          console.error(`[send] job=${jobId} step=bounce-resolve error=${code}`);
        });
      }, delayMs);

      return {
        ok: true,
        job: finalJob,
        recipientResults: pendingResults,
      };
    }
  } catch (err) {
    await releaseLock();
    throw err;
  }
}
