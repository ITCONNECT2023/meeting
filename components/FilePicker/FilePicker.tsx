"use client";

// EPIC 2-2: F1 file-picking region (drop zone / picked-file card / error
// line). Controlled component — the parent owns `file`/`error` state and
// re-derives them (via lib/validation/input's checkPickedFile /
// checkDurationSec and lib/audio/read-metadata's readAudioMetadata) every
// time onPick fires. This component never validates anything itself; it
// only reports the raw File the user picked or dropped.

import type { ChangeEvent, DragEvent } from "react";
import { useId, useRef, useState } from "react";

import { AlertCircleIcon } from "@/components/icons";

import { AudioFileIcon, CloseIcon, UploadArrowIcon } from "./icons";
import styles from "./FilePicker.module.css";

/** What the card displays once a file is picked. `ext` is the normalized
 * (lowercased) extension from checkPickedFile — pass it through even when
 * the file turned out invalid, so the meta/short-label logic below has it
 * to fall back on. */
export type FilePickerFile = {
  name: string;
  ext: string;
};

export type FilePickerErrorKind = "missing" | "format" | "size" | "duration";

export type FilePickerError = {
  kind: FilePickerErrorKind;
  /** Full FRD-worded message, shown on the error line below the region. */
  message: string;
};

export interface FilePickerProps {
  /** Currently picked file, or null when none has been picked yet. */
  file: FilePickerFile | null;
  /**
   * Current file-region error, or null.
   * - `kind: "missing"` only makes sense with `file: null` (F1: 올리기
   *   pressed with no file picked) — shown as the drop zone's red border.
   * - `"format" | "size" | "duration"` only make sense with a non-null
   *   `file` — shown as the picked-file card turning red plus a short
   *   label replacing its meta line.
   */
  error: FilePickerError | null;
  /** Fires with the raw File the instant one is picked or dropped, before
   * any validation. The parent re-derives `file`/`error` from it. */
  onPick: (file: File) => void;
  /** 「빼기(×)」: clears the picked file. */
  onRemove: () => void;
}

/** F1 오류 안내 short labels for the picked-file card's meta line (the
 * card has no room for the full FRD sentence; that lives on the error line
 * below instead). "missing" is unused here — it never pairs with a picked
 * file — but listed for exhaustiveness. */
const SHORT_ERROR_LABEL: Record<FilePickerErrorKind, string> = {
  missing: "",
  format: "지원하지 않는 형식",
  size: "파일이 너무 큽니다",
  duration: "녹음이 2시간을 넘습니다",
};

export function FilePicker({ file, error, onPick, onRemove }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const errorId = useId();

  const openPicker = () => inputRef.current?.click();

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Reset now so picking the exact same file again still fires a
    // "change" event next time (the browser otherwise treats an unchanged
    // value as a no-op).
    event.target.value = "";
    if (picked) onPick(picked);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    // Required so the browser allows a drop here instead of navigating to
    // the file.
    event.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0]; // only the first file
    if (dropped) onPick(dropped);
  };

  const hasFileProblem = !!file && !!error;

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,.m4a,.wav,audio/*"
        onChange={handleInputChange}
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
      />

      {!file && (
        <button
          type="button"
          onClick={openPicker}
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-describedby={error ? errorId : undefined}
          className={[
            styles.dropZone,
            error ? styles.dropZoneError : "",
            dragging ? styles.dropZoneDragging : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={styles.dropIcon}>
            <UploadArrowIcon />
          </span>
          <span className={styles.dropTextPc}>
            녹음 파일을 여기로 끌어다 놓거나 눌러서 고르세요
          </span>
          <span className={styles.dropTextMobile}>눌러서 녹음 파일 고르기</span>
          <span className={styles.dropHint}>mp3 · m4a · wav</span>
        </button>
      )}

      {file && (
        <div
          onDragEnter={handleDragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            styles.fileCard,
            hasFileProblem ? styles.fileCardError : "",
            dragging ? styles.fileCardDragging : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span className={styles.fileIcon}>
            <AudioFileIcon />
          </span>
          <span className={styles.fileText}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileMeta}>
              {hasFileProblem && error
                ? SHORT_ERROR_LABEL[error.kind]
                : `${file.ext} 파일 · 아직 올리지 않았습니다`}
            </span>
          </span>
          <button type="button" onClick={openPicker} className={styles.changeButton}>
            다른 파일
          </button>
          <button
            type="button"
            aria-label="고른 파일 빼기"
            onClick={onRemove}
            className={styles.removeButton}
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {error && (
        <p id={errorId} role="alert" className={styles.errorLine}>
          <span className={styles.errorIcon}>
            <AlertCircleIcon size={18} />
          </span>
          <span>{error.message}</span>
        </p>
      )}
    </div>
  );
}
