/**
 * Mail Allowlist Security Guard (TRD 5-1, DEV 5-1)
 *
 * Prevents test / preview dispatches from accidentally leaking to real recipients.
 * When MAIL_ALLOWLIST is provided (e.g. in test/staging), emails can ONLY be sent
 * to explicitly matched addresses or wildcard domains (*@domain.com).
 */

export function isAllowedRecipient(
  recipient: string,
  rawAllowlist?: string
): boolean {
  const allowlistStr = rawAllowlist !== undefined ? rawAllowlist : process.env.MAIL_ALLOWLIST;
  if (!allowlistStr || allowlistStr.trim() === "") {
    return true; // No allowlist restriction in standard production
  }

  const cleanRecipient = recipient.trim().toLowerCase();
  const patterns = allowlistStr
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);

  if (patterns.length === 0) {
    return true;
  }

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
  rawAllowlist?: string
): { allowed: string[]; blocked: string[] } {
  const allowed: string[] = [];
  const blocked: string[] = [];

  for (const rcp of recipients) {
    if (isAllowedRecipient(rcp, rawAllowlist)) {
      allowed.push(rcp);
    } else {
      blocked.push(rcp);
    }
  }

  return { allowed, blocked };
}
