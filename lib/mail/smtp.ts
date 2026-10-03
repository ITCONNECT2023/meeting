import nodemailer, { type SendMailOptions } from "nodemailer";
import { ImapFlow } from "imapflow";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import {
  EMPTY_ALLOWLIST_REASON,
  NOT_IN_ALLOWLIST_REASON,
  filterAllowedRecipients,
  isAllowlistRequired,
  parseAllowlist,
} from "./allowlist";

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  jobId: string;
  recipients: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /**
   * Message-ID to put on the mail. The send workflow picks it (and records
   * it) BEFORE handing the mail to Gmail, so a retry after an interruption
   * can look for exactly this ID in Sent Mail (EPIC 7-4). Generated here
   * when omitted.
   */
  messageId?: string;
}

export interface SendEmailRecipientResult {
  email: string;
  status: "pending" | "sent" | "failed";
  errorReason?: string;
  messageId?: string;
}

export interface SendEmailResponse {
  ok: boolean;
  messageId?: string;
  results: SendEmailRecipientResult[];
  error?: string;
}

export interface FakeSentEmail {
  jobId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  messageId: string;
  sentAt: number;
  attachments?: { filename: string; size: number }[];
}

// In-memory fake sent box for test assertions
const fakeSentEmails: FakeSentEmail[] = [];

export function getFakeSentEmails(): FakeSentEmail[] {
  return [...fakeSentEmails];
}

export function clearFakeSentEmails(): void {
  fakeSentEmails.length = 0;
}

/**
 * Budget Guard for real SMTP sends:
 * Reads cumulative real sent count from .local-data/gemini-budget.md.
 * Aborts if count + newRecipients > 30.
 */
function checkAndUpdateEmailBudget(recipientEmails: string[], messageId: string): void {
  const budgetFilePath = path.join(process.cwd(), ".local-data", "gemini-budget.md");
  if (!fs.existsSync(budgetFilePath)) {
    return;
  }

  const content = fs.readFileSync(budgetFilePath, "utf8");
  const countMatch = content.match(/- \*\*현재 실제 메일 발송 수:\*\* (\d+)통/);
  const currentCount = countMatch ? parseInt(countMatch[1], 10) : 0;
  const newCount = currentCount + recipientEmails.length;

  if (newCount > 30) {
    throw new Error(
      `실제 메일 발송 예산(최대 30통)을 초과할 수 없습니다. (현재: ${currentCount}통, 요청: ${recipientEmails.length}통)`
    );
  }

  // Update cumulative count and append row to ## 메일 발송 기록
  const nowStr = new Date().toISOString().replace("T", " ").substring(0, 19);
  const newRows = recipientEmails
    .map(
      (email, idx) =>
        `| ${nowStr} | ${email} | 발송 성공 (${messageId}) | ${currentCount + idx + 1} |`
    )
    .join("\n");

  let updatedContent = content.replace(
    /- \*\*현재 실제 메일 발송 수:\*\* \d+통/,
    `- **현재 실제 메일 발송 수:** ${newCount}통`
  );

  if (updatedContent.includes("## 메일 발송 기록\n| 일시 | 수신 주소 | 상태 (Message-ID / 이유) | 누적 통수 |\n|---|---|---|---|")) {
    updatedContent = updatedContent.replace(
      "|---|---|---|---|",
      `|---|---|---|---|\n${newRows}`
    );
  }

  fs.writeFileSync(budgetFilePath, updatedContent, "utf8");
}

/**
 * True when mail really goes out through Gmail SMTP: MAIL_PROVIDER isn't
 * "fake" and the Gmail credentials are set. Anything else uses the fake box.
 */
export function isRealSmtp(): boolean {
  const provider = (process.env.MAIL_PROVIDER || "fake").toLowerCase();
  return provider !== "fake" && !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
}

function mailDomain(): string {
  const gmailUser = process.env.GMAIL_USER;
  return gmailUser && gmailUser.includes("@") ? gmailUser.split("@")[1] : "meeting.local";
}

/**
 * A new, unique Message-ID for one send attempt of a job. Random rather than
 * time-based so the workflow can choose (and save) it before sending and a
 * later retry can look for the very same ID in Sent Mail (EPIC 7-4).
 */
export function createMessageId(jobId: string): string {
  return `<job-${jobId}-${randomUUID()}@${mailDomain()}>`;
}

/**
 * Whether a mail with this Message-ID was already accepted by Gmail — i.e.
 * it is in the dedicated account's Sent Mail (EPIC 7-4, TRD ④-7). Used
 * before re-sending after an interruption. Throws when Sent Mail can't be
 * checked, so the caller never re-sends without knowing.
 */
export async function wasMessageSent(messageId: string): Promise<boolean> {
  if (!isRealSmtp()) {
    return fakeSentEmails.some((m) => m.messageId === messageId);
  }

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER as string,
      pass: process.env.GMAIL_APP_PASSWORD as string,
    },
    logger: false,
  });

  await client.connect();
  try {
    // Sent Mail's name depends on the account language ("보낸편지함",
    // "Sent Mail"), so find it by its special-use flag.
    const folders = await client.list();
    const sentPath =
      folders.find((f) => f.specialUse === "\\Sent" && f.specialUseSource === "extension")?.path ??
      folders.find((f) => f.specialUse === "\\Sent")?.path;
    if (!sentPath) {
      throw new Error("Sent Mail folder not found");
    }

    const lock = await client.getMailboxLock(sentPath);
    try {
      const found = await client.search({ header: { "message-id": messageId } }, { uid: true });
      return Array.isArray(found) && found.length > 0;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Sends meeting minutes email via SMTP or fake mock.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResponse> {
  const { jobId, recipients, subject, text, html, attachments } = options;

  if (recipients.length === 0) {
    return { ok: true, results: [] };
  }

  const realSmtp = isRealSmtp();

  // 1. Allowlist filtering (DEV 7-2, TRD 7장). Real SMTP outside Vercel
  // production fails closed: no MAIL_ALLOWLIST means nobody is sent to.
  const requireAllowlist = isAllowlistRequired({ realSmtp });
  const { allowed, blocked } = filterAllowedRecipients(recipients, undefined, {
    requireAllowlist,
  });
  const blockedReason =
    parseAllowlist().length === 0 ? EMPTY_ALLOWLIST_REASON : NOT_IN_ALLOWLIST_REASON;

  const results: SendEmailRecipientResult[] = [];

  for (const b of blocked) {
    results.push({
      email: b,
      status: "failed",
      errorReason: blockedReason,
    });
  }

  if (allowed.length === 0) {
    // Nothing reached Gmail: no Message-ID, nothing to look for in bounces.
    return {
      ok: false,
      results,
      error: "전송 가능한 허용 주소가 없습니다.",
    };
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  const fromDomain = mailDomain();
  const messageId = options.messageId ?? createMessageId(jobId);
  const fromHeader = gmailUser ? `회의록 봇 <${gmailUser}>` : `회의록 봇 <no-reply@${fromDomain}>`;

  // 2. Fake Mail Provider (default or explicit)
  if (!realSmtp) {
    // Check for simulated SMTP outright reject
    if (allowed.some((e) => e.toLowerCase().includes("smtp-reject@"))) {
      throw new Error("Gmail 접수 거절: 서비스 일시 장애로 메일을 보낼 수 없습니다.");
    }

    // Process allowed recipients
    for (const email of allowed) {
      const lower = email.toLowerCase();
      if (lower.includes("fail@") || lower.includes("511@") || lower.includes("nonexistent@")) {
        results.push({
          email,
          status: "failed",
          errorReason: "주소를 찾을 수 없음",
          messageId,
        });
      } else if (lower.includes("522@") || lower.includes("quota@")) {
        results.push({
          email,
          status: "failed",
          errorReason: "메일함이 가득 참",
          messageId,
        });
      } else if (lower.includes("4xx@") || lower.includes("temp@")) {
        results.push({
          email,
          status: "failed",
          errorReason: "일시적인 메일 서비스 문제",
          messageId,
        });
      } else if (lower.includes("reject@")) {
        results.push({
          email,
          status: "failed",
          errorReason: "받는 쪽에서 거절함",
          messageId,
        });
      } else {
        // Pending verification / Sent
        results.push({
          email,
          status: "pending",
          messageId,
        });
      }
    }

    fakeSentEmails.push({
      jobId,
      from: fromHeader,
      to: allowed,
      subject,
      text,
      html,
      messageId,
      sentAt: Date.now(),
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        size: typeof a.content === "string" ? Buffer.byteLength(a.content) : a.content.length,
      })),
    });

    return {
      ok: true,
      messageId,
      results,
    };
  }

  // 3. Real Gmail SMTP (nodemailer)
  try {
    // Check real budget guard (max 30 emails)
    checkAndUpdateEmailBudget(allowed, messageId);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailPass,
      },
      // Keep one attempt well inside the send lock (SEND_LOCK_TTL_SECONDS):
      // nodemailer's defaults (2 min connect, 10 min idle socket) could let
      // a stalled attempt outlive the lock and overlap a second send.
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
    });

    const mailOptions: SendMailOptions = {
      from: fromHeader,
      to: allowed.join(", "),
      subject,
      text,
      html,
      messageId,
      attachments: attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    };

    const info = await transporter.sendMail(mailOptions);
    const resolvedMessageId = info.messageId || messageId;

    for (const email of allowed) {
      results.push({
        email,
        status: "pending",
        messageId: resolvedMessageId,
      });
    }

    return {
      ok: true,
      messageId: resolvedMessageId,
      results,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gmail 접수 실패: ${errorMsg}`);
  }
}
