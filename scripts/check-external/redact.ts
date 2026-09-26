/**
 * EPIC 1-7: every line `npm run check:external` prints goes through a
 * redactor built from the secret values in the environment, so a secret
 * can never reach the terminal even if a library echoes it back inside
 * an error message.
 *
 * Besides the raw value, the forms a secret can take on the wire are
 * covered: the Gmail app password with and without spaces, URL-encoded,
 * and base64 (SMTP AUTH LOGIN/PLAIN send it that way).
 */

type Env = Record<string, string | undefined>;

/** Env vars whose values must never be printed. */
export const SECRET_ENV_NAMES = [
  "GEMINI_API_KEY",
  "GMAIL_APP_PASSWORD",
  "ACCESS_PASSWORD",
  "SESSION_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "CRON_SECRET",
] as const;

export const REDACTED = "[숨김]";

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Every string form of the secrets in `env` that must be hidden. */
export function collectSecrets(env: Env): string[] {
  const forms = new Set<string>();

  const add = (value: string) => {
    if (value === "") return;
    forms.add(value);
    forms.add(encodeURIComponent(value));
    forms.add(base64(value));
  };

  for (const name of SECRET_ENV_NAMES) {
    const raw = env[name];
    if (raw === undefined) continue;
    add(raw);
    const trimmed = raw.trim();
    add(trimmed);
    const compact = raw.replace(/\s+/g, "");
    add(compact);
    if (name === "GMAIL_APP_PASSWORD" && compact.length === 16) {
      // Google shows it as "abcd efgh ijkl mnop".
      add(compact.match(/.{4}/g)!.join(" "));
    }
  }

  // SMTP AUTH PLAIN sends base64("\0user\0password").
  const user = (env.GMAIL_USER ?? "").trim();
  const pass = (env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
  if (user !== "" && pass !== "") {
    forms.add(base64(`\u0000${user}\u0000${pass}`));
  }

  forms.delete("");
  return [...forms];
}

export type Redactor = (text: string) => string;

export function createRedactor(secrets: readonly string[]): Redactor {
  // Longest first, so a secret containing another one is hidden whole.
  const ordered = [...new Set(secrets)]
    .filter((s) => s !== "")
    .sort((a, b) => b.length - a.length);

  return (text: string) => {
    let out = text;
    for (const secret of ordered) {
      out = out.split(secret).join(REDACTED);
    }
    return out;
  };
}
