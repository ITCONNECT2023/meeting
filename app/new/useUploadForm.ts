"use client";

// EPIC 2-4/2-5/2-6: every olligi(올리기)-screen input lives in one place —
// this reducer — instead of scattered useState calls, so EPIC 3 can grow
// app/new into processing/review/result without reshuffling state.
//
// FRD refs: F1 (녹음 파일 올리기), F2 (회의 정보), F3 (받는 메일 주소),
// F4 (보내는 방식 선택), F14 (처음으로 나가기).

import { useCallback, useEffect, useRef, useReducer } from "react";

import type { ChipCommitResult } from "@/components/ChipInput/commit";
import { commit } from "@/components/ChipInput/commit";
import type { FilePickerError } from "@/components/FilePicker/FilePicker";
import { readAudioMetadata, type AudioMetadataResult } from "@/lib/audio/read-metadata";
import {
  VALIDATION_MESSAGES,
  checkDurationSec,
  checkPickedFile,
} from "@/lib/validation/input";

import { attendeeChipCheck, recipientChipCheck } from "./chipAdapters";

export type UploadMode = "a" | "b";

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
  | { type: "CONFIRM_B_GO" };

function createInitialState(mode: UploadMode): UploadFormState {
  return {
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
      return { ...state, dialog: null, toastOpen: true };
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
  /** B confirm dialog's 「이 주소로 올리고 보내기」: EPIC 2 stub — closes
   * the dialog and shows the same toast A's submit shows (EPIC 3 connects
   * the real upload+send). */
  const confirmBGo = useCallback(() => dispatch({ type: "CONFIRM_B_GO" }), []);

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

    dispatch(s.mode === "a" ? { type: "SHOW_TOAST" } : { type: "OPEN_DIALOG", dialog: "confirmB" });
    return { ok: true, mode: s.mode };
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
  };
}
