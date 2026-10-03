export interface StoredAudioFile {
  jobId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

/** The error code the workflow reads as "the recording is missing or unreadable". */
export function missingAudioError(): Error {
  const err = new Error(
    "녹음을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다. 다른 파일로 다시 올려 주세요.",
  );
  (err as { code?: string }).code = "FILE_CORRUPT";
  return err;
}

/**
 * Where a job's recording is kept between upload and transcribe. The local
 * folder (EPIC 3-3) and Vercel Blob (EPIC 10-3) both implement this, so the
 * workflow never needs to know which one is in use.
 */
export interface StorageDriver {
  /** Local folder only. Blob uploads go straight from the browser. */
  saveAudio(
    jobId: string,
    fileName: string,
    source: ReadableStream<Uint8Array> | Buffer,
  ): Promise<StoredAudioFile>;
  hasAudio(jobId: string): Promise<boolean>;
  /**
   * Gives `run` a file path it can read for the length of the call. Blob
   * downloads into a temporary file and removes it afterwards.
   */
  withAudioFile<T>(jobId: string, run: (filePath: string) => Promise<T>): Promise<T>;
  deleteAudio(jobId: string): Promise<void>;
  countUploads(): Promise<number>;
}
