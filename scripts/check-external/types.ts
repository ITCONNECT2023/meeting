/** EPIC 1-7: shared shapes for the external connection checks. */

/** A failure explained in Korean: what went wrong and what to do next. */
export interface Failure {
  cause: string;
  next: string[];
  /** Error code / status and a short provider message. Printed redacted. */
  detail?: string;
}

export type CheckOutcome =
  | { ok: true; lines: string[] }
  | ({ ok: false } & Failure);

export interface Check {
  title: string;
  run: () => Promise<CheckOutcome>;
}

/**
 * A provider message on one line (SMTP replies span several), shortened
 * for the terminal.
 */
export function shortMessage(message: unknown, max = 200): string {
  if (typeof message !== "string") return "";
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
