/**
 * Mail Allowlist Security Guard (TRD 5-1, 7장, DEV 7-2, 10-2)
 *
 * Prevents test / preview dispatches from accidentally leaking to real recipients.
 * When MAIL_ALLOWLIST is provided, emails can ONLY be sent to explicitly
 * matched addresses or wildcard domains (*@domain.com).
 *
 * An empty list means "no restriction" only where that is safe: the Vercel
 * production deployment. For real SMTP anywhere else (a local run, a preview
 * deployment) the list is required and an empty one blocks everybody — see
 * `isAllowlistRequired`. The fake mail provider never sends, so it is never
 * restricted.
 */

export interface AllowlistOptions {
  /** When true, an empty/blank allowlist blocks every recipient (fail closed). */
  requireAllowlist?: boolean;
}

/** Shown on the result screen as "보내지 못함 (…)" when the list is missing. */
export const EMPTY_ALLOWLIST_REASON =
  "허용 목록(MAIL_ALLOWLIST)이 비어 있어 보내지 않았습니다";

/** Shown on the result screen as "보내지 못함 (…)" for an unlisted address. */
export const NOT_IN_ALLOWLIST_REASON = "허용 목록(MAIL_ALLOWLIST)에 없는 주소입니다";

/**
 * Whether real sending must be limited to MAIL_ALLOWLIST: always, except on
 * the Vercel production deployment (VERCEL_ENV=production). The fake
 * provider sends nothing, so it never needs the list.
 */
export function isAllowlistRequired({
  realSmtp,
  vercelEnv = process.env.VERCEL_ENV,
}: {
  realSmtp: boolean;
  vercelEnv?: string;
}): boolean {
  return realSmtp && vercelEnv !== "production";
}

/** The non-blank, lower-cased patterns of an allowlist string. */
export function parseAllowlist(rawAllowlist?: string): string[] {
  const allowlistStr = rawAllowlist !== undefined ? rawAllowlist : process.env.MAIL_ALLOWLIST;
  return (allowlistStr ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

export function isAllowedRecipient(
  recipient: string,
  rawAllowlist?: string,
  options: AllowlistOptions = {}
): boolean {
  const patterns = parseAllowlist(rawAllowlist);

  if (patterns.length === 0) {
    // No list: unrestricted only when the caller doesn't require one
    // (production / fake provider). Otherwise fail closed.
    return !options.requireAllowlist;
  }

  const cleanRecipient = recipient.trim().toLowerCase();
  for (const pattern of patterns) {
    if (pattern.startsWith("*@")) {
      const domain = pattern.slice(2);
      if (cleanRecipient.endsWith(`@${domain}`)) {
        return true;
      }
    } else if (cleanRecipient === pattern) {
      return true;
    }
  }

  return false;
}

export function filterAllowedRecipients(
  recipients: string[],
  rawAllowlist?: string,
  options: AllowlistOptions = {}
): { allowed: string[]; blocked: string[] } {
  const allowed: string[] = [];
  const blocked: string[] = [];

  for (const rcp of recipients) {
    if (isAllowedRecipient(rcp, rawAllowlist, options)) {
      allowed.push(rcp);
    } else {
      blocked.push(rcp);
    }
  }

  return { allowed, blocked };
}
