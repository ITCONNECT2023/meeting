"use client";

// EPIC 2-4/2-5/2-6: every olligi(올리기)-screen input lives in one place —
// this reducer — instead of scattered useState calls, so EPIC 3 can grow
// app/new into processing/review/result without reshuffling state.
//
// FRD refs: F1 (녹음 파일 올리기), F2 (회의 정보), F3 (받는 메일 주소),
// F4 (보내는 방식 선택), F14 (처음으로 나가기).

import { useCallback, useEffect, useRef, useReducer } from "react";
import { upload } from "@vercel/blob/client";

import type { ChipCommitResult } from "@/components/ChipInput/commit";
import { commit } from "@/components/ChipInput/commit";
import type { FilePickerError } from "@/components/FilePicker/FilePicker";
import { readAudioMetadata, type AudioMetadataResult } from "@/lib/audio/read-metadata";
import {
  VALIDATION_MESSAGES,
  checkDurationSec,
  checkPickedFile,
} from "@/lib/validation/input";

import type { JobRecord, MeetingMinutes } from "@/lib/minutes/types";
import { audioPathnameFor } from "@/lib/storage/pathname";
import { attendeeChipCheck, recipientChipCheck } from "./chipAdapters";

export type UploadMode = "a" | "b";
export type ScreenState = "form" | "processing" | "review";

/** F1: the picked file plus what's known about it so far. `pickId` is an
 * internal-only guard (see pickFile below) — never shown to the user. */
export type PickedFile = {
  file: File;
  ext: string;
  pickId: number;
  metaStatus: "reading" | "done";
  durationSec: number | null;
  recordedAt: string | null;
};

export type DialogKind = "leave" | "confirmB";

export type UploadFormState = {
  screen: ScreenState;
  mode: UploadMode;
  fileState: PickedFile | null;
  fileError: FilePickerError | null;
  title: string;
  date: string;
  attendees: string[];
  attendeeDraft: string;
  attendeeError: string | null;
  recipients: string[];
  recipientDraft: string;
  recipientError: string | null;
  dialog: DialogKind | null;
  toastOpen: boolean;
  jobId: string | null;
  job: JobRecord | null;
};

type Action =
  | { type: "SET_MODE"; mode: UploadMode }
  | {
      type: "PICK_FILE";
      pickId: number;
      file: File;
      ext: string;
      error: FilePickerError | null;
      metaStatus: "reading" | "done";
    }
  | {
      type: "FILE_META";
      pickId: number;
      durationSec: number | null;
      recordedAt: string | null;
    }
  | { type: "REMOVE_FILE" }
  | { type: "SET_TITLE"; value: string }
  | { type: "SET_DATE"; value: string }
  | { type: "ATTENDEE_CHANGE"; value: ChipCommitResult }
  | { type: "RECIPIENT_CHANGE"; value: ChipCommitResult }
  | {
      type: "SUBMIT_RESULT";
      attendees: string[];
      attendeeDraft: string;
      recipients: string[];
      recipientDraft: string;
      recipientError: string | null;
      fileState: PickedFile | null;
      fileError: FilePickerError | null;
    }
  | { type: "SHOW_TOAST" }
  | { type: "CLOSE_TOAST" }
  | { type: "OPEN_DIALOG"; dialog: DialogKind }
  | { type: "CLOSE_DIALOG" }
  | { type: "CONFIRM_B_GO" }
  | { type: "START_JOB_REQUEST" }
  | { type: "JOB_CREATED"; jobId: string; job: JobRecord }
  | { type: "JOB_UPDATE"; job: JobRecord }
  | { type: "JOB_REVIEW"; job: JobRecord }
  | { type: "JOB_FAILED"; job: JobRecord }
  | { type: "JOB_ERROR"; error: string }
  | { type: "RESET_TO_FORM" };

function createInitialState(mode: UploadMode): UploadFormState {
  return {
    screen: "form",
    mode,
    fileState: null,
    fileError: null,
    title: "",
    date: "",
    attendees: [],
    attendeeDraft: "",
    attendeeError: null,
    recipients: [],
    recipientDraft: "",
    recipientError: null,
    dialog: null,
    toastOpen: false,
    jobId: null,
    job: null,
  };
}

function reducer(state: UploadFormState, action: Action): UploadFormState {
  switch (action.type) {
    case "SET_MODE":
      return { ...state, mode: action.mode };
    case "PICK_FILE":
      return {
        ...state,
        fileState: {
          file: action.file,
          ext: action.ext,
          pickId: action.pickId,
          metaStatus: action.metaStatus,
          durationSec: null,
          recordedAt: null,
        },
        fileError: action.error,
      };
    case "FILE_META": {
      // Stale read (file since removed/replaced) — ignore.
      if (!state.fileState || state.fileState.pickId !== action.pickId) return state;
      const durationCheck = checkDurationSec(action.durationSec);
      return {
        ...state,
        fileState: {
          ...state.fileState,
          metaStatus: "done",
          durationSec: action.durationSec,
          recordedAt: action.recordedAt,
        },
        fileError: durationCheck.ok
          ? null
          : { kind: "duration", message: durationCheck.message },
      };
    }
    case "REMOVE_FILE":
      // FRD: removing the file clears its error too.
      return { ...state, fileState: null, fileError: null };
    case "SET_TITLE":
      return { ...state, title: action.value };
    case "SET_DATE":
      return { ...state, date: action.value };
    case "ATTENDEE_CHANGE":
      return {
        ...state,
        attendees: action.value.items,
        attendeeDraft: action.value.draft,
        attendeeError: action.value.error,
      };
    case "RECIPIENT_CHANGE":
      return {
        ...state,
        recipients: action.value.items,
        recipientDraft: action.value.draft,
        recipientError: action.value.error,
      };
    case "SUBMIT_RESULT":
      return {
        ...state,
        attendees: action.attendees,
        attendeeDraft: action.attendeeDraft,
        recipients: action.recipients,
        recipientDraft: action.recipientDraft,
        recipientError: action.recipientError,
        fileState: action.fileState,
        fileError: action.fileError,
      };
    case "SHOW_TOAST":
      return { ...state, toastOpen: true };
    case "CLOSE_TOAST":
      return { ...state, toastOpen: false };
    case "OPEN_DIALOG":
      return { ...state, dialog: action.dialog };
    case "CLOSE_DIALOG":
      return { ...state, dialog: null };
    case "CONFIRM_B_GO":
      return { ...state, dialog: null };
    case "START_JOB_REQUEST":
      return { ...state, screen: "processing", jobId: null, job: null };
    case "JOB_CREATED":
      return { ...state, jobId: action.jobId, job: action.job };
    case "JOB_UPDATE":
      return { ...state, job: action.job };
    case "JOB_REVIEW":
      return { ...state, screen: "review", job: action.job };
    case "JOB_FAILED":
      return { ...state, job: action.job };
    case "JOB_ERROR": {
      const currentJob: JobRecord = state.job ?? {
        id: state.jobId ?? "job-err",
        mode: state.mode.toUpperCase() as "A" | "B",
        fileName: state.fileState?.file.name ?? "recording.mp3",
        fileSize: state.fileState?.file.size ?? 0,
        status: "failed",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        steps: {
          upload: { status: "failed", startedAt: Date.now(), errorMessage: action.error },
          transcribe: { status: "pending" },
          minutes: { status: "pending" },
        },
        recipients: state.recipients,
      };
      return {
        ...state,
        job: {
          ...currentJob,
          status: "failed",
          steps: {
            ...currentJob.steps,
            upload: {
              ...currentJob.steps.upload,
              status: "failed",
              errorMessage: action.error,
            },
          },
        },
      };
    }
    case "RESET_TO_FORM":
      return { ...state, screen: "form", jobId: null, job: null };
  }
}

/** Lowercased extension without the dot, or "" when the name has none.
 * Mirrors lib/validation/input.ts's private extensionOf — duplicated
 * (rather than exported from a shared-with-server file) since this copy is
 * only ever used for display (FilePickerFile.ext) after checkPickedFile has
 * already rejected the file; the message text itself always comes from
 * checkPickedFile/VALIDATION_MESSAGES, never re-derived here. */
function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** F11/TRD4: fire-and-forget delete, used from pagehide handlers where the
 * page may already be gone before a normal `fetch` could complete.
 * `sendBeacon` only ever does POST, which `/api/jobs/[id]` treats as a
 * full delete when no `clientLeft` flag is present — the same path `DELETE`
 * takes. Falls back to a keepalive `fetch` where `sendBeacon` isn't available. */
function sendDeleteBeacon(jobId: string): void {
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(`/api/jobs/${jobId}`);
  } else {
    fetch(`/api/jobs/${jobId}`, { method: "DELETE", keepalive: true }).catch(() => {});
  }
}

export type SubmitOutcome =
  | { ok: true; mode: UploadMode }
  | { ok: false; failedSection: "file" | "recipients" };

export function useUploadForm(initialMode: UploadMode) {
  const [state, dispatch] = useReducer(reducer, initialMode, createInitialState);

  // Mirrors `state` for the async submit() below, which needs the *latest*
  // values after an `await` — by then this hook's own render-time `state`
  // closure may be stale, since dispatch doesn't update it synchronously.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Bumped on every pick/remove; readAudioMetadata's async result is only
  // applied if it still matches (guards a slow read finishing after the
  // user already removed or replaced the file).
  const pickIdRef = useRef(0);
  // The in-flight metadata read for the current file, or null once it
  // isn't needed (no file picked, or wrong/duplicate format already
  // rejected the file before any read was attempted). Resolves to the raw
  // AudioMetadataResult (not just a side-effecting dispatch) so submit()
  // can use its authoritative value even before React re-renders.
  const metaTaskRef = useRef<Promise<AudioMetadataResult | null> | null>(null);

  const pickFile = useCallback((file: File) => {
    pickIdRef.current += 1;
    const id = pickIdRef.current;
    const check = checkPickedFile(file);
    if (!check.ok) {
      metaTaskRef.current = null;
      dispatch({
        type: "PICK_FILE",
        pickId: id,
        file,
        ext: extOf(file.name),
        error: { kind: check.kind, message: check.message },
        metaStatus: "done",
      });
      return;
    }
    dispatch({
      type: "PICK_FILE",
      pickId: id,
      file,
      ext: check.ext,
      error: null,
      metaStatus: "reading",
    });
    metaTaskRef.current = readAudioMetadata(file).then((meta) => {
      if (pickIdRef.current !== id) return null; // stale — file changed since
      dispatch({
        type: "FILE_META",
        pickId: id,
        durationSec: meta.durationSec,
        recordedAt: meta.recordedAt,
      });
      return meta;
    });
  }, []);

  const removeFile = useCallback(() => {
    pickIdRef.current += 1;
    metaTaskRef.current = null;
    dispatch({ type: "REMOVE_FILE" });
  }, []);

  const setMode = useCallback((mode: UploadMode) => {
    dispatch({ type: "SET_MODE", mode });
    // F4: switching tabs must not remount/navigate (that would drop every
    // input) — only the URL's ?mode= is kept in sync, via replaceState, so
    // a refresh preserves the tab without adding a history entry.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("mode", mode);
      window.history.replaceState(null, "", url);
    }
  }, []);

  const setTitle = useCallback((value: string) => dispatch({ type: "SET_TITLE", value }), []);
  const setDate = useCallback((value: string) => dispatch({ type: "SET_DATE", value }), []);
  const onAttendeeChange = useCallback(
    (value: ChipCommitResult) => dispatch({ type: "ATTENDEE_CHANGE", value }),
    [],
  );
  const onRecipientChange = useCallback(
    (value: ChipCommitResult) => dispatch({ type: "RECIPIENT_CHANGE", value }),
    [],
  );
  const openLeaveDialog = useCallback(() => dispatch({ type: "OPEN_DIALOG", dialog: "leave" }), []);
  const closeDialog = useCallback(() => dispatch({ type: "CLOSE_DIALOG" }), []);
  const closeToast = useCallback(() => dispatch({ type: "CLOSE_TOAST" }), []);
  const isStartingRef = useRef(false);

  const startJobFlow = useCallback(async (file: File) => {
    dispatch({ type: "START_JOB_REQUEST" });
    const s = stateRef.current;
    try {
      const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: s.mode,
          audio: {
            name: file.name,
            size: file.size,
            durationSec: s.fileState?.durationSec ?? null,
            recordedAt: s.fileState?.recordedAt ?? null,
          },
          meetingInfo: {
            title: s.title.trim() || undefined,
            date: s.date.trim() || undefined,
            attendees: s.attendees.length > 0 ? s.attendees : undefined,
          },
          recipients: s.recipients,
        }),
      });
      if (!jobRes.ok) {
        const err = await jobRes.json().catch(() => ({}));
        dispatch({
          type: "JOB_ERROR",
          error: err.message || "작업을 생성하지 못했습니다.",
        });
        return;
      }
      const data = await jobRes.json();
      const id = data.job?.id || data.id;
      const record = data.job || data.record;
      dispatch({ type: "JOB_CREATED", jobId: id, job: record });

      if (data.uploadMode === "blob") {
        // EPIC 10-3: the file goes straight to Blob; we only confirm it afterwards.
        let blobPathname: string;
        try {
          const blob = await upload(audioPathnameFor(id, file.name), file, {
            access: "private",
            handleUploadUrl: "/api/upload/token",
            clientPayload: id,
            multipart: true,
          });
          blobPathname = blob.pathname;
        } catch {
          dispatch({
            type: "JOB_ERROR",
            error: "녹음 파일을 올리지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.",
          });
          return;
        }
        const confirmRes = await fetch(`/api/upload?jobId=${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: blobPathname }),
        });
        if (!confirmRes.ok) {
          const err = await confirmRes.json().catch(() => ({}));
          dispatch({
            type: "JOB_ERROR",
            error: err.message || "녹음 파일을 올리지 못했습니다.",
          });
          return;
        }
      } else {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch(`/api/upload?jobId=${id}`, {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          dispatch({
            type: "JOB_ERROR",
            error: err.message || "녹음 파일을 올리지 못했습니다.",
          });
          return;
        }
      }

      // Check job right after upload
      const jobCheckRes = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      if (jobCheckRes.ok) {
        const checkData = await jobCheckRes.json();
        if (checkData.job) {
          const j: JobRecord = checkData.job;
          if (j.status === "review" || j.status === "sent") {
            dispatch({ type: "JOB_REVIEW", job: j });
          } else if (j.status === "failed") {
            dispatch({ type: "JOB_FAILED", job: j });
          } else {
            dispatch({ type: "JOB_UPDATE", job: j });
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "작업을 시작하지 못했습니다.";
      dispatch({ type: "JOB_ERROR", error: msg });
    }
  }, []);

  /** B confirm dialog's 「이 주소로 올리고 보내기」: closes the dialog and starts the upload/process flow. */
  const confirmBGo = useCallback(async () => {
    if (isStartingRef.current) return;
    const file = stateRef.current.fileState?.file;
    if (!file) return;
    isStartingRef.current = true;
    dispatch({ type: "CLOSE_DIALOG" });
    try {
      await startJobFlow(file);
    } finally {
      isStartingRef.current = false;
    }
  }, [startJobFlow]);

  /**
   * F1/F3 올리기 버튼: force-commits both drafts (recipients — FRD's own
   * requirement — and, per the EPIC 2 plan, attendees too, purely for
   * completeness since attendee checks never block), awaits an in-flight
   * duration read so a >2h file can't slip through by clicking fast, then
   * validates file + recipients together. Returns which section (if any)
   * failed, so the caller can scroll/focus it — important on tablet/mobile
   * where the submit button lives in the bottom bar, away from the section
   * that failed.
   */
  const submit = useCallback(async (): Promise<SubmitOutcome> => {
    // Wait first, then read the latest state: tab/chip edits made while
    // the read was in flight must not be overwritten below.
    const pending = stateRef.current.fileState;
    const meta =
      pending && pending.metaStatus === "reading" && metaTaskRef.current
        ? await metaTaskRef.current
        : null;

    const s = stateRef.current;
    const attResult = commit(`${s.attendeeDraft},`, s.attendees, attendeeChipCheck);
    const rcpResult = commit(`${s.recipientDraft},`, s.recipients, recipientChipCheck);

    let fileState = s.fileState;
    let fileError = s.fileError;
    if (fileState && fileState.metaStatus === "reading") {
      if (meta && pickIdRef.current === fileState.pickId) {
        const durationCheck = checkDurationSec(meta.durationSec);
        fileState = {
          ...fileState,
          metaStatus: "done",
          durationSec: meta.durationSec,
          recordedAt: meta.recordedAt,
        };
        fileError = durationCheck.ok
          ? null
          : { kind: "duration", message: durationCheck.message };
      }
    }

    const missingFile = !fileState;
    const fileBlocked = !!fileState && !!fileError;
    const noRecipients = rcpResult.items.length === 0;
    const recipientDraftBlocked = !!rcpResult.error;
    const recipientDisplayError = rcpResult.error
      ? rcpResult.error
      : noRecipients
        ? VALIDATION_MESSAGES.recipientsEmpty
        : null;

    dispatch({
      type: "SUBMIT_RESULT",
      attendees: attResult.items,
      attendeeDraft: attResult.draft,
      recipients: rcpResult.items,
      recipientDraft: rcpResult.draft,
      recipientError: recipientDisplayError,
      fileState,
      fileError: missingFile
        ? { kind: "missing", message: VALIDATION_MESSAGES.fileMissing }
        : fileError,
    });

    if (missingFile || fileBlocked || noRecipients || recipientDraftBlocked) {
      return { ok: false, failedSection: missingFile || fileBlocked ? "file" : "recipients" };
    }

    if (s.mode === "a") {
      void startJobFlow(fileState!.file);
      return { ok: true, mode: s.mode };
    }

    dispatch({ type: "OPEN_DIALOG", dialog: "confirmB" });
    return { ok: true, mode: s.mode };
  }, [startJobFlow]);

  // 2s polling while processing
  useEffect(() => {
    if (state.screen !== "processing" || !state.jobId) return;
    if (
      state.job?.status === "review" ||
      state.job?.status === "sent" ||
      state.job?.status === "failed"
    ) {
      return;
    }

    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${state.jobId}`, { cache: "no-store" });
        if (!active || !res.ok) return;
        const data = await res.json();
        if (!active || !data.job) return;
        const fetchedJob: JobRecord = data.job;
        if (fetchedJob.status === "review" || fetchedJob.status === "sent") {
          dispatch({ type: "JOB_REVIEW", job: fetchedJob });
        } else if (fetchedJob.status === "failed") {
          dispatch({ type: "JOB_FAILED", job: fetchedJob });
        } else {
          dispatch({ type: "JOB_UPDATE", job: fetchedJob });
        }
      } catch {
        // Will retry next tick
      }
    };

    const intervalId = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [state.screen, state.jobId, state.job?.status]);

  // Window close/refresh guard during processing, and on the review/done
  // screen (FRD F7/F11/F14, TRD 4): job data must not outlive the user
  // leaving that screen, by any exit — including closing/refreshing the
  // tab, not just the in-app 처음으로/새 회의록 buttons.
  useEffect(() => {
    if (state.screen !== "processing" && state.screen !== "review") return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // Only the processing screen's own leave-confirmation rules apply
      // here (F6/F10) — the review/done screen never blocks refresh/close.
      if (state.screen !== "processing") return;
      // In Mode B, once upload is completed, do not prevent unload
      if (state.mode === "b" && state.job?.steps.upload.status === "completed") {
        return;
      }
      e.preventDefault();
      e.returnValue = "지금 나가면 만들던 회의록이 사라집니다.";
      return "지금 나가면 만들던 회의록이 사라집니다.";
    };

    const onPageHide = () => {
      if (!state.jobId) return;

      if (state.screen === "review") {
        // Review/done screen: leaving by any means deletes the job right
        // away, same as the in-app 처음으로/새 회의록 exit.
        sendDeleteBeacon(state.jobId);
        return;
      }

      if (state.mode === "a") {
        sendDeleteBeacon(state.jobId);
      } else if (state.mode === "b") {
        if (state.job?.steps.upload.status === "completed") {
          // Upload completed: mark clientLeft
          if (typeof navigator !== "undefined" && navigator.sendBeacon) {
            navigator.sendBeacon(`/api/jobs/${state.jobId}?clientLeft=1`);
          } else {
            fetch(`/api/jobs/${state.jobId}?clientLeft=1`, { method: "POST", keepalive: true }).catch(() => {});
          }
        } else {
          // Upload not completed: cancel job
          sendDeleteBeacon(state.jobId);
        }
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [state.screen, state.jobId, state.mode, state.job?.steps.upload.status]);

  const retry = useCallback(() => {
    const file = stateRef.current.fileState?.file;
    if (!file) return;
    void startJobFlow(file);
  }, [startJobFlow]);

  const cancelAndHome = useCallback(async () => {
    const jobId = stateRef.current.jobId;
    if (jobId) {
      try {
        await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      } catch {
        // ignore
      }
    }
    dispatch({ type: "RESET_TO_FORM" });
  }, []);

  const updateJobMinutes = useCallback((updatedMinutes: MeetingMinutes, maskedCount?: number) => {
    const current = stateRef.current.job;
    if (!current) return;
    dispatch({
      type: "JOB_UPDATE",
      job: {
        ...current,
        minutes: updatedMinutes,
        maskedCount: maskedCount !== undefined ? maskedCount : current.maskedCount,
      },
    });
  }, []);

  const updateJob = useCallback((updatedJob: JobRecord) => {
    dispatch({
      type: "JOB_UPDATE",
      job: updatedJob,
    });
  }, []);

  return {
    state,
    pickFile,
    removeFile,
    setMode,
    setTitle,
    setDate,
    onAttendeeChange,
    onRecipientChange,
    openLeaveDialog,
    closeDialog,
    closeToast,
    confirmBGo,
    submit,
    retry,
    cancelAndHome,
    updateJobMinutes,
    updateJob,
  };
}
