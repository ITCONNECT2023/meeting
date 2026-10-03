import "server-only";

import { BlobStorageDriver } from "./blob";
import { LocalStorageDriver } from "./local";
import type { StorageDriver } from "./types";

export type { StorageDriver, StoredAudioFile } from "./types";

/** Vercel connects BLOB_READ_WRITE_TOKEN when a Blob store is linked (EPIC 10-2). */
export function isBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

let cachedStorage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (!cachedStorage) {
    cachedStorage = isBlobStorage() ? new BlobStorageDriver() : new LocalStorageDriver();
  }
  return cachedStorage;
}
