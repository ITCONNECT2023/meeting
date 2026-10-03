import { simpleParser, ParsedMail } from "mailparser";
import { ImapFlow } from "imapflow";

export interface BounceInfo {
  recipient?: string;
  statusCode?: string;
  reason: string;
  originalMessageId?: string;
}

/**
 * Maps delivery status code (RFC 3463 / RFC 1893) or diagnostic text to user-friendly Korean reason.
 * - 5.1.1: 주소를 찾을 수 없음
 * - 5.2.2: 메일함이 가득 참
 * - 4.x.x: 일시적인 메일 서비스 문제
 * - 그 밖: 받는 쪽에서 거절함
 */
export function mapStatusCodeToReason(statusCode?: string, diagnosticText?: string): string {
  if (statusCode) {
    const code = statusCode.trim();
    if (/^5\.1\./.test(code)) {
      return "주소를 찾을 수 없음";
    }
    if (/^5\.2\./.test(code)) {
      return "메일함이 가득 참";
    }
    if (/^4\./.test(code)) {
      return "일시적인 메일 서비스 문제";
    }
    return "받는 쪽에서 거절함";
  }

  if (diagnosticText) {
    const lower = diagnosticText.toLowerCase();
    if (
      lower.includes("5.1.1") ||
      lower.includes("does not exist") ||
      lower.includes("no such user") ||
      lower.includes("recipient rejected") ||
      lower.includes("user not found")
    ) {
      return "주소를 찾을 수 없음";
    }
    if (
      lower.includes("5.2.2") ||
      lower.includes("mailbox is full") ||
      lower.includes("quota exceeded")
    ) {
      return "메일함이 가득 참";
    }
    if (
      lower.includes("4.") ||
      lower.includes("temporary") ||
      lower.includes("try again later")
    ) {
      return "일시적인 메일 서비스 문제";
    }
  }

  return "받는 쪽에서 거절함";
}

/**
 * Parses an NDR / bounce email to extract failure status, reason, recipient, and original Message-ID.
 */
export async function parseBounceMessage(
  rawOrParsed: string | Buffer | ParsedMail
): Promise<BounceInfo | null> {
  const parsed: ParsedMail =
    typeof rawOrParsed === "string" || Buffer.isBuffer(rawOrParsed)
      ? await simpleParser(rawOrParsed)
      : rawOrParsed;

  const subject = parsed.subject || "";
  const fromAddr = parsed.from?.text || "";

  const isDsn =
    /delivery status notification/i.test(subject) ||
    /undelivered mail/i.test(subject) ||
    /mail delivery failed/i.test(subject) ||
    /failure notice/i.test(subject) ||
    /mailer-daemon/i.test(fromAddr) ||
    /postmaster/i.test(fromAddr);

  if (!isDsn) {
    return null;
  }

  const fullText = [
    parsed.text || "",
    parsed.html || "",
    typeof parsed.headers?.get("diagnostic-code") === "string" ? parsed.headers.get("diagnostic-code") : "",
  ].join("\n");

  // 1. Extract recipient email
  let recipient: string | undefined;
  const finalRcpMatch = fullText.match(/Final-Recipient:\s*(?:rfc822;\s*)?([^\s;]+@[^\s;]+)/i);
  if (finalRcpMatch) {
    recipient = finalRcpMatch[1].trim().replace(/[<>]/g, "");
  } else {
    // Fallback: look for common pattern: "Your message to xxx@domain could not be delivered"
    const fallbackMatch = fullText.match(
      /(?:to|address|reach)\s+<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i
    );
    if (fallbackMatch) {
      recipient = fallbackMatch[1].trim();
    }
  }

  // 2. Extract status code (e.g. 5.1.1, 5.2.2, 4.4.1)
  let statusCode: string | undefined;
  const statusMatch = fullText.match(/Status:\s*([45]\.\d+\.\d+)/i);
  if (statusMatch) {
    statusCode = statusMatch[1];
  } else {
    const codeMatch = fullText.match(/\b([45]\.\d+\.\d+)\b/);
    if (codeMatch) {
      statusCode = codeMatch[1];
    }
  }

  // 3. Extract original Message-ID if present
  let originalMessageId: string | undefined;
  const inReplyTo = parsed.inReplyTo;
  if (inReplyTo) {
    originalMessageId = inReplyTo.trim();
  } else {
    const msgIdMatch = fullText.match(/Message-ID:\s*(<[^>]+>)/i);
    if (msgIdMatch) {
      originalMessageId = msgIdMatch[1].trim();
    }
  }

  const reason = mapStatusCodeToReason(statusCode, fullText);

  return {
    recipient,
    statusCode,
    reason,
    originalMessageId,
  };
}

function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, "");
}

/** Clock skew allowed between our server and Gmail when comparing times. */
const RECEIVED_SKEW_MS = 60_000;

/**
 * Whether a bounce belongs to THIS send (FRD 3-4). A bounce for an earlier
 * mail to the same address — the first try this morning, or another job —
 * must not mark a mail that did arrive as "보내지 못함", or the user's
 * "실패한 주소에 다시 보내기" would deliver it a second time.
 *  - When the bounce names the original Message-ID (Gmail sets
 *    In-Reply-To), it must be one of ours.
 *  - Otherwise it must have arrived after we sent.
 */
export function isBounceForSend(
  info: Pick<BounceInfo, "originalMessageId">,
  receivedAt: Date | undefined,
  send: { messageIds: string[]; sentAt?: number },
): boolean {
  if (info.originalMessageId && send.messageIds.length > 0) {
    const original = normalizeMessageId(info.originalMessageId);
    return send.messageIds.some((id) => normalizeMessageId(id) === original);
  }
  if (send.sentAt !== undefined && receivedAt) {
    return receivedAt.getTime() >= send.sentAt - RECEIVED_SKEW_MS;
  }
  return true;
}

/**
 * Checks for bounce notifications for a job via IMAP.
 * In fake mode, evaluates simulated addresses.
 * Only bounces for this send's Message-ID(s) — or, when a bounce names
 * none, ones received after `sentAt` — count (see `isBounceForSend`).
 */
export async function checkBouncesForJob(options: {
  jobId: string;
  recipients: string[];
  messageId?: string;
  /** Extra Message-IDs of the same send (a recovered interrupted attempt). */
  messageIds?: string[];
  /** When the mail was handed to Gmail (ms since epoch). */
  sentAt?: number;
  timeoutMs?: number;
}): Promise<Map<string, { status: "failed"; reason: string }>> {
  const { jobId, recipients } = options;
  const messageIds = [
    ...(options.messageId ? [options.messageId] : []),
    ...(options.messageIds ?? []),
  ];
  const bounceMap = new Map<string, { status: "failed"; reason: string }>();

  const provider = (process.env.MAIL_PROVIDER || "fake").toLowerCase();
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (provider === "fake" || !gmailUser || !gmailPass) {
    for (const email of recipients) {
      const lower = email.toLowerCase();
      if (lower.includes("fail@") || lower.includes("511@") || lower.includes("nonexistent@")) {
        bounceMap.set(email, { status: "failed", reason: "주소를 찾을 수 없음" });
      } else if (lower.includes("522@") || lower.includes("quota@")) {
        bounceMap.set(email, { status: "failed", reason: "메일함이 가득 참" });
      } else if (lower.includes("4xx@") || lower.includes("temp@")) {
        bounceMap.set(email, { status: "failed", reason: "일시적인 메일 서비스 문제" });
      } else if (lower.includes("reject@")) {
        bounceMap.set(email, { status: "failed", reason: "받는 쪽에서 거절함" });
      }
    }
    return bounceMap;
  }

  if (recipients.length === 0) {
    return bounceMap;
  }

  // Real IMAP check
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Search recent messages in the last 5 minutes. IMAP SINCE is
      // day-granular, so this actually returns all of today's mail: each
      // bounce is matched to this send by Message-ID / arrival time below.
      const sinceDate = new Date(Date.now() - 5 * 60 * 1000);
      const messages = client.fetch(
        { since: sinceDate },
        { source: true, envelope: true, bodyStructure: true, internalDate: true }
      );

      for await (const message of messages) {
        if (!message.source) continue;
        const bounceInfo = await parseBounceMessage(message.source);
        const receivedRaw = message.internalDate ?? message.envelope?.date;
        const receivedAt = receivedRaw ? new Date(receivedRaw) : undefined;
        if (
          bounceInfo &&
          bounceInfo.recipient &&
          isBounceForSend(bounceInfo, receivedAt, { messageIds, sentAt: options.sentAt })
        ) {
          const matchedRcp = recipients.find(
            (r) => r.toLowerCase() === bounceInfo.recipient!.toLowerCase()
          );
          if (matchedRcp) {
            bounceMap.set(matchedRcp, { status: "failed", reason: bounceInfo.reason });
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    // Log policy (TRD 5): error code only. The raw IMAP error can contain
    // a recipient address or mail content, so it must never be logged.
    const code = (err as { code?: string } | undefined)?.code ?? "IMAP_ERROR";
    console.error(`[bounce] job=${jobId} step=bounce-check error=${code}`);
  }

  return bounceMap;
}
