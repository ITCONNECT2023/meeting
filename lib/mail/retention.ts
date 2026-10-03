/**
 * EPIC 9-2: mail retention for the dedicated Gmail account (TRD 4).
 *
 * The TRD asks for mail older than 30 days to be removed. A Gmail filter
 * cannot do that (filters only act on incoming mail and cannot select by
 * age), so the daily cleanup does it here over IMAP: messages older than
 * the cutoff in the bot's own folders are moved to Trash, and Gmail empties
 * Trash by itself after another 30 days.
 *
 * Only the bot's own traffic is touched:
 *   - Sent Mail (special-use \Sent): mail the bot sent.
 *   - INBOX: bounce notices (and the self-addressed connection check mail).
 * Drafts, Spam, Trash itself and All Mail are never selected.
 *
 * Folders are found by their special-use flag, never by name: the account's
 * UI language decides the names (e.g. "보낸편지함", "휴지통").
 *
 * Errors are reported as short codes only. Server responses can echo the
 * login name, so no error text ever leaves this module.
 *
 * Runs under plain Node (`npm run cleanup`, native TS type stripping) as
 * well as under Next: relative `.ts` imports only, no "@/" alias, no
 * "server-only".
 */

import { ImapFlow } from "imapflow";

import type { CleanupSectionResult } from "../cleanup/types.ts";

export interface PurgeOldMailOptions {
  now?: Date;
  olderThanDays?: number;
  dryRun?: boolean;
}

export const IMAP_HOST = "imap.gmail.com";
export const IMAP_PORT = 993;
export const DEFAULT_RETENTION_DAYS = 30;

/** Upper bound for the whole purge, so a stuck server cannot stall the cleanup. */
export const PURGE_DEADLINE_MS = 120_000;
const LOGOUT_TIMEOUT_MS = 5_000;
/** UIDs per MOVE command, to keep each command line short. */
const MOVE_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

export type MailRetentionErrorCode =
  | "MAIL_NOT_CONFIGURED"
  | "MAIL_AUTH_FAILED"
  | "MAIL_CONNECT_FAILED"
  | "MAIL_PURGE_FAILED";

type Env = Record<string, string | undefined>;

interface MailCredentials {
  user: string;
  pass: string;
}

function readCredentials(env: Env): MailCredentials | null {
  const user = (env.GMAIL_USER ?? "").trim();
  // Google displays app passwords as "abcd efgh ijkl mnop"; the spaces are
  // not part of the password.
  const pass = (env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
  if (user === "" || pass === "") return null;
  return { user, pass };
}

/**
 * The date passed to IMAP `SEARCH BEFORE`.
 *
 * BEFORE compares only the calendar date of a message's internal date,
 * and the server decides which timezone that date is in (up to ±14 h
 * from UTC). To make sure every match is strictly older than
 * `now - olderThanDays`, take the UTC day the cutoff falls on and go one
 * more day back. A message on the boundary is kept a day longer rather
 * than deleted a day early.
 *
 * Worst case, a match is still ≥ 10 h older than the exact cutoff:
 *   match < (cutoffDayStartUtc - 1 day) + 14 h = cutoffDayStartUtc - 10 h ≤ cutoff - 10 h.
 */
export function searchBeforeDate(now: Date, olderThanDays: number): Date {
  const cutoff = now.getTime() - olderThanDays * DAY_MS;
  const cutoffDayStart = Math.floor(cutoff / DAY_MS) * DAY_MS;
  return new Date(cutoffDayStart - DAY_MS);
}

/** The listed folder carrying `flag`, preferring what the server itself reported. */
function findSpecialUse(
  folders: readonly { path: string; specialUse?: string; specialUseSource?: string }[],
  flag: string,
): string | undefined {
  const matches = folders.filter((f) => f.specialUse === flag);
  const fromServer = matches.find((f) => f.specialUseSource === "extension");
  return (fromServer ?? matches[0])?.path;
}

function isAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { authenticationFailed?: unknown; serverResponseCode?: unknown };
  return (
    err.authenticationFailed === true ||
    (typeof err.serverResponseCode === "string" &&
      /^AUTHENTICATIONFAILED$/i.test(err.serverResponseCode))
  );
}

class DeadlineExceeded extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceeded()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Moves mail older than `olderThanDays` (default 30) from Sent Mail and
 * INBOX to Trash. With `dryRun`, only counts.
 *
 * `deleted`: messages moved (or that would be moved).
 * `kept`: messages looked at in those folders and left alone.
 * `error`: a short code when the section could not finish; `deleted` then
 * still counts what was already moved.
 */
export async function purgeOldMail(
  options: PurgeOldMailOptions = {},
): Promise<CleanupSectionResult> {
  const now = options.now ?? new Date();
  const olderThanDays = options.olderThanDays ?? DEFAULT_RETENTION_DAYS;
  const dryRun = options.dryRun ?? false;

  const credentials = readCredentials(process.env);
  if (!credentials) {
    return { deleted: 0, kept: 0, error: "MAIL_NOT_CONFIGURED" };
  }
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1 || Number.isNaN(now.getTime())) {
    // Refuse anything that could widen the selection to recent mail.
    return { deleted: 0, kept: 0, error: "MAIL_PURGE_FAILED" };
  }

  const cutoff = now.getTime() - olderThanDays * DAY_MS;
  const before = searchBeforeDate(now, olderThanDays);

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: credentials.user, pass: credentials.pass },
    // Never let imapflow print the IMAP conversation (it includes LOGIN).
    logger: false,
    emitLogs: false,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
    disableAutoIdle: true,
  });
  // imapflow emits 'error' on socket problems; without a listener Node
  // would crash the whole process. Failures surface through the awaited
  // calls below instead.
  client.on("error", () => {});

  let deleted = 0;
  let kept = 0;
  let phase: "connect" | "purge" = "connect";

  const work = async () => {
    await client.connect();
    phase = "purge";

    const folders = await client.list();
    const sentPath = findSpecialUse(folders, "\\Sent");
    const trashPath = findSpecialUse(folders, "\\Trash");
    if (!sentPath || !trashPath) throw new Error("special-use folder missing");

    // INBOX is a reserved IMAP name and is never localized.
    const sources = [...new Set([sentPath, "INBOX"])].filter((p) => p !== trashPath);

    for (const path of sources) {
      const lock = await client.getMailboxLock(path);
      try {
        const exists = client.mailbox ? client.mailbox.exists : 0;
        const found = await client.search({ before }, { uid: true });
        const candidates = Array.isArray(found) ? found : [];

        // Second, exact check on the server's own receive time. SEARCH is
        // only day-granular and silently falls back to ALL if its criteria
        // ever compile to nothing, so nothing is moved on its word alone.
        const uids: number[] = [];
        if (candidates.length > 0) {
          for await (const msg of client.fetch(
            candidates,
            { uid: true, internalDate: true },
            { uid: true },
          )) {
            const received = msg.internalDate ? new Date(msg.internalDate).getTime() : NaN;
            if (Number.isFinite(received) && received < cutoff) uids.push(msg.uid);
          }
        }
        kept += Math.max(0, exists - uids.length);

        if (dryRun) {
          deleted += uids.length;
          continue;
        }
        for (const batch of chunk(uids, MOVE_BATCH_SIZE)) {
          await client.messageMove(batch, trashPath, { uid: true });
          deleted += batch.length;
        }
      } finally {
        lock.release();
      }
    }
  };

  let error: MailRetentionErrorCode | undefined;
  try {
    await withTimeout(work(), PURGE_DEADLINE_MS);
  } catch (err) {
    if (isAuthError(err)) error = "MAIL_AUTH_FAILED";
    else if (phase === "connect") error = "MAIL_CONNECT_FAILED";
    else error = "MAIL_PURGE_FAILED";
  } finally {
    try {
      if (client.usable) await withTimeout(client.logout(), LOGOUT_TIMEOUT_MS);
    } catch {
      // Closing below is enough.
    }
    try {
      client.close();
    } catch {
      // Already closed.
    }
  }

  return error ? { deleted, kept, error } : { deleted, kept };
}
