export interface StoredAudioFile {
  jobId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
}

export interface StorageDriver {
  saveAudio(
    jobId: string,
    fileName: string,
    source: ReadableStream<Uint8Array> | Buffer,
  ): Promise<StoredAudioFile>;
  getAudioPath(jobId: string): Promise<string | null>;
  deleteAudio(jobId: string): Promise<void>;
  countUploads(): Promise<number>;
}
