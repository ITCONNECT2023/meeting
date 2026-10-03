import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake ImapFlow that records what the code under test does with it.
const imap = vi.hoisted(() => {
  interface Folder {
    path: string;
    specialUse?: string;
    specialUseSource?: string;
    /** uid → server receive time (IMAP INTERNALDATE) */
    msgs: { uid: number; date: string }[];
    /** Overrides what SEARCH answers, e.g. to simulate a criterion being dropped. */
    searchAnswer?: number[];
  }

  const state = {
    folders: [] as Folder[],
    instances: [] as FakeImapFlow[],
    connectError: undefined as unknown,
    searchError: undefined as unknown,
    hangOnConnect: false,
  };

  class FakeImapFlow {
    options: Record<string, unknown>;
    usable = false;
    mailbox: { path: string; exists: number } | false = false;
    listeners: Record<string, unknown> = {};
    selected: string[] = [];
    searches: { path: string; query: Record<string, unknown>; options: unknown }[] = [];
    moves: { path: string; range: unknown; destination: unknown; options: unknown }[] = [];
    fetches: { path: string; range: unknown; options: unknown }[] = [];

    connect = vi.fn(async () => {
      if (state.hangOnConnect) return new Promise<void>(() => {});
      if (state.connectError) throw state.connectError;
      this.usable = true;
    });
    list = vi.fn(async () =>
      state.folders.map((f) => ({
        path: f.path,
        name: f.path.split("/").pop(),
        specialUse: f.specialUse,
        specialUseSource: f.specialUseSource,
        flags: new Set<string>(),
      })),
    );
    getMailboxLock = vi.fn(async (path: string) => {
      const folder = state.folders.find((f) => f.path === path);
      if (!folder) throw Object.assign(new Error("no such mailbox"), { mailboxMissing: true });
      this.selected.push(path);
      this.mailbox = { path, exists: folder.msgs.length };
      return { path, release: vi.fn() };
    });
    search = vi.fn(async (query: Record<string, unknown>, options: unknown) => {
      if (state.searchError) throw state.searchError;
      const path = this.mailbox ? this.mailbox.path : "";
      this.searches.push({ path, query, options });
      const folder = state.folders.find((f) => f.path === path)!;
      if (folder.searchAnswer) return [...folder.searchAnswer];
      // Real BEFORE semantics (UTC days): received on an earlier calendar day.
      const before = (query.before as Date).getTime();
      return folder.msgs.filter((m) => Date.parse(m.date.slice(0, 10)) < before).map((m) => m.uid);
    });
    fetch = vi.fn((range: number[], _query: unknown, options: unknown) => {
      const path = this.mailbox ? this.mailbox.path : "";
      this.fetches.push({ path, range, options });
      const folder = state.folders.find((f) => f.path === path)!;
      const rows = folder.msgs.filter((m) => range.includes(m.uid)).map((m) => ({ uid: m.uid, internalDate: new Date(m.date) }));
      return (async function* () {
        yield* rows;
      })();
    });
    messageMove = vi.fn(async (range: unknown, destination: unknown, options: unknown) => {
      const path = this.mailbox ? this.mailbox.path : "";
      this.moves.push({ path, range, destination, options });
      return { path, destination, uidMap: new Map() };
    });
    logout = vi.fn(async () => {
      this.usable = false;
    });
    close = vi.fn(() => {
      this.usable = false;
    });
    on = vi.fn((event: string, handler: unknown) => {
      this.listeners[event] = handler;
      return this;
    });

    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.instances.push(this);
    }
  }

  return { state, FakeImapFlow };
});

vi.mock("imapflow", () => ({ ImapFlow: imap.FakeImapFlow }));

import { purgeOldMail, searchBeforeDate } from "@/lib/mail/retention";

const USER = "meeting.bot.secret@gmail.com";
const PASS = "abcd efgh ijkl mnop";

const OLD = "2025-01-01T00:00:00Z";

/** Gmail with a Korean UI: every folder name localized. */
function koreanGmail() {
  imap.state.folders = [
    {
      path: "INBOX",
      specialUse: "\\Inbox",
      specialUseSource: "extension",
      msgs: [
        { uid: 11, date: "2026-07-01T09:00:00Z" },
        { uid: 12, date: "2026-08-20T09:00:00Z" },
        // Day before the BEFORE date: matched and older than the cutoff.
        { uid: 13, date: "2026-08-26T23:00:00Z" },
        // Older than the exact cutoff, but on the BEFORE day: kept a day longer.
        { uid: 14, date: "2026-08-27T10:00:00Z" },
        { uid: 15, date: "2026-09-26T09:00:00Z" },
      ],
    },
    {
      path: "[Gmail]/보낸편지함",
      specialUse: "\\Sent",
      specialUseSource: "extension",
      msgs: [
        { uid: 21, date: "2026-06-01T09:00:00Z" },
        { uid: 22, date: "2026-08-01T09:00:00Z" },
        // One hour newer than the cutoff.
        { uid: 23, date: "2026-08-28T13:00:00Z" },
        { uid: 24, date: "2026-09-27T09:00:00Z" },
      ],
    },
    { path: "[Gmail]/휴지통", specialUse: "\\Trash", specialUseSource: "extension", msgs: [{ uid: 31, date: OLD }] },
    { path: "[Gmail]/임시보관함", specialUse: "\\Drafts", specialUseSource: "extension", msgs: [{ uid: 41, date: OLD }] },
    { path: "[Gmail]/스팸", specialUse: "\\Junk", specialUseSource: "extension", msgs: [{ uid: 51, date: OLD }] },
    { path: "[Gmail]/전체보관함", specialUse: "\\All", specialUseSource: "extension", msgs: [{ uid: 61, date: OLD }] },
    // A user label whose name merely looks like an English folder.
    { path: "Sent", msgs: [{ uid: 71, date: OLD }] },
  ];
}

function client() {
  expect(imap.state.instances).toHaveLength(1);
  return imap.state.instances[0]!;
}

const NOW = new Date("2026-09-27T12:00:00Z");

describe("lib/mail/retention", () => {
  beforeEach(() => {
    imap.state.instances = [];
    imap.state.connectError = undefined;
    imap.state.searchError = undefined;
    imap.state.hangOnConnect = false;
    koreanGmail();
    vi.stubEnv("GMAIL_USER", USER);
    vi.stubEnv("GMAIL_APP_PASSWORD", PASS);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("searchBeforeDate", () => {
    it("goes one UTC day before the day the cutoff falls on", () => {
      // cutoff = 2026-08-28T12:00Z → cutoff day 08-28 → BEFORE 27-Aug-2026
      expect(searchBeforeDate(NOW, 30).toISOString()).toBe("2026-08-27T00:00:00.000Z");
    });

    it("keeps every match strictly older than the cutoff in any server timezone", () => {
      const samples = [
        new Date("2026-09-27T00:00:00Z"),
        new Date("2026-09-27T00:00:01Z"),
        new Date("2026-09-27T09:59:59Z"),
        new Date("2026-09-27T23:59:59Z"),
        new Date("2026-03-01T00:30:00Z"),
      ];
      for (const now of samples) {
        for (const days of [1, 30]) {
          const cutoff = now.getTime() - days * 86_400_000;
          const before = searchBeforeDate(now, days).getTime();
          // Latest instant BEFORE can match: that date's midnight in UTC+14.
          const latestMatch = before + 14 * 3_600_000;
          expect(latestMatch).toBeLessThan(cutoff);
          // …but never more than 2 days too conservative.
          expect(cutoff - before).toBeLessThanOrEqual(2 * 86_400_000);
        }
      }
    });
  });

  it("returns MAIL_NOT_CONFIGURED without connecting when the account is not set", async () => {
    vi.stubEnv("GMAIL_USER", "");
    expect(await purgeOldMail({ now: NOW })).toEqual({ deleted: 0, kept: 0, error: "MAIL_NOT_CONFIGURED" });

    vi.stubEnv("GMAIL_USER", USER);
    vi.stubEnv("GMAIL_APP_PASSWORD", "   ");
    expect(await purgeOldMail({ now: NOW })).toEqual({ deleted: 0, kept: 0, error: "MAIL_NOT_CONFIGURED" });

    expect(imap.state.instances).toHaveLength(0);
  });

  it("connects to imap.gmail.com:993 over TLS with the app password, spaces removed", async () => {
    await purgeOldMail({ now: NOW, dryRun: true });
    const c = client();
    expect(c.options).toMatchObject({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: USER, pass: "abcdefghijklmnop" },
      logger: false,
    });
    expect(c.options.connectionTimeout).toEqual(expect.any(Number));
    expect(c.options.socketTimeout).toEqual(expect.any(Number));
    expect(c.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("finds Sent and Trash by special-use flag with Korean folder names and moves old mail to Trash", async () => {
    const result = await purgeOldMail({ now: NOW });
    const c = client();

    expect(c.selected.sort()).toEqual(["INBOX", "[Gmail]/보낸편지함"].sort());
    expect(c.moves).toHaveLength(2);
    for (const move of c.moves) {
      expect(move.destination).toBe("[Gmail]/휴지통");
      expect(move.options).toEqual({ uid: true });
    }
    expect(c.moves.find((m) => m.path === "[Gmail]/보낸편지함")?.range).toEqual([21, 22]);
    expect(c.moves.find((m) => m.path === "INBOX")?.range).toEqual([11, 12, 13]);

    for (const s of c.searches) {
      expect(s.query).toEqual({ before: new Date("2026-08-27T00:00:00.000Z") });
      expect(s.options).toEqual({ uid: true });
    }

    // 5 moved; kept = INBOX 14, 15 + Sent 23, 24
    expect(result).toEqual({ deleted: 5, kept: 4 });
    expect(c.logout).toHaveBeenCalledTimes(1);
    expect(c.close).toHaveBeenCalled();
  });

  it("never opens Drafts, Spam, Trash, All Mail or a label merely named 'Sent'", async () => {
    await purgeOldMail({ now: NOW });
    const c = client();
    for (const untouched of ["[Gmail]/휴지통", "[Gmail]/임시보관함", "[Gmail]/스팸", "[Gmail]/전체보관함", "Sent"]) {
      expect(c.selected).not.toContain(untouched);
      expect(c.moves.map((m) => m.path)).not.toContain(untouched);
    }
  });

  it("re-checks each match's receive time, so a SEARCH that matched everything moves only old mail", async () => {
    const inbox = imap.state.folders.find((f) => f.path === "INBOX")!;
    inbox.searchAnswer = [11, 12, 13, 14, 15];
    const result = await purgeOldMail({ now: NOW });
    const c = client();
    expect(c.fetches.find((f) => f.path === "INBOX")).toMatchObject({ range: [11, 12, 13, 14, 15], options: { uid: true } });
    // 14 is strictly older than the exact cutoff; 15 is from yesterday.
    expect(c.moves.find((m) => m.path === "INBOX")?.range).toEqual([11, 12, 13, 14]);
    expect(result).toEqual({ deleted: 6, kept: 3 });
  });

  it("dryRun counts but moves nothing", async () => {
    const result = await purgeOldMail({ now: NOW, dryRun: true });
    const c = client();
    expect(c.messageMove).not.toHaveBeenCalled();
    expect(result).toEqual({ deleted: 5, kept: 4 });
    expect(c.logout).toHaveBeenCalledTimes(1);
  });

  it("uses olderThanDays for the cutoff", async () => {
    await purgeOldMail({ now: NOW, olderThanDays: 7, dryRun: true });
    for (const s of client().searches) {
      expect(s.query).toEqual({ before: new Date("2026-09-19T00:00:00.000Z") });
    }
  });

  it("refuses a cutoff that could reach recent mail", async () => {
    for (const olderThanDays of [0, -1, Number.NaN]) {
      expect(await purgeOldMail({ now: NOW, olderThanDays })).toMatchObject({ deleted: 0, error: "MAIL_PURGE_FAILED" });
    }
    expect(imap.state.instances).toHaveLength(0);
  });

  it("fails with MAIL_PURGE_FAILED and moves nothing when Trash cannot be found", async () => {
    imap.state.folders = imap.state.folders.filter((f) => f.specialUse !== "\\Trash");
    const result = await purgeOldMail({ now: NOW });
    const c = client();
    expect(result).toEqual({ deleted: 0, kept: 0, error: "MAIL_PURGE_FAILED" });
    expect(c.messageMove).not.toHaveBeenCalled();
    expect(c.logout).toHaveBeenCalledTimes(1);
  });

  it("logs out and closes when the purge fails midway, with a code that carries no secrets", async () => {
    imap.state.searchError = new Error(`NO [ALERT] ${USER} ${PASS} Subject: 회의록 overquota`);
    const result = await purgeOldMail({ now: NOW });
    const c = client();
    expect(result).toEqual({ deleted: 0, kept: 0, error: "MAIL_PURGE_FAILED" });
    expect(c.logout).toHaveBeenCalledTimes(1);
    expect(c.close).toHaveBeenCalled();
    const text = JSON.stringify(result);
    expect(text).not.toContain(USER);
    expect(text).not.toContain("abcd");
    expect(text).not.toContain("회의록");
  });

  it("maps a rejected login to MAIL_AUTH_FAILED without echoing the server response", async () => {
    imap.state.connectError = Object.assign(new Error(`Invalid credentials for ${USER}`), {
      authenticationFailed: true,
      serverResponseCode: "AUTHENTICATIONFAILED",
      response: `a1 NO [AUTHENTICATIONFAILED] Invalid credentials ${USER}`,
    });
    const result = await purgeOldMail({ now: NOW });
    const c = client();
    expect(result).toEqual({ deleted: 0, kept: 0, error: "MAIL_AUTH_FAILED" });
    expect(JSON.stringify(result)).not.toContain(USER);
    expect(c.close).toHaveBeenCalled();
  });

  it("maps a network failure to MAIL_CONNECT_FAILED", async () => {
    imap.state.connectError = Object.assign(new Error("getaddrinfo ENOTFOUND imap.gmail.com"), { code: "ENOTFOUND" });
    const result = await purgeOldMail({ now: NOW });
    expect(result).toEqual({ deleted: 0, kept: 0, error: "MAIL_CONNECT_FAILED" });
    expect(client().close).toHaveBeenCalled();
  });

  it("gives up on a hung connection instead of stalling the cleanup", async () => {
    vi.useFakeTimers();
    imap.state.hangOnConnect = true;
    const pending = purgeOldMail({ now: NOW });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await pending).toEqual({ deleted: 0, kept: 0, error: "MAIL_CONNECT_FAILED" });
    expect(client().close).toHaveBeenCalled();
  });
});
