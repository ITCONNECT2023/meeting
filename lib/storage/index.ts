import "server-only";

import { LocalStorageDriver } from "./local";
import type { StorageDriver } from "./types";

export type { StorageDriver, StoredAudioFile } from "./types";

let cachedStorage: StorageDriver | undefined;

export function getStorage(): StorageDriver {
  if (!cachedStorage) {
    cachedStorage = new LocalStorageDriver();
  }
  return cachedStorage;
}
