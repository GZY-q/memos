/**
 * IndexedDB-backed offline draft storage: editor drafts plus a queue of save
 * operations that failed while the network was down.
 */

import { type OfflineDraft, type OfflineQueuedSave, pruneOfflineDrafts, removeQueuedSave } from "./draftQueue";
import { withStore } from "./idb";

const DB_NAME = "memos-offline-drafts";
const DB_VERSION = 1;
const DRAFT_STORE = "drafts";
const QUEUE_STORE = "queue";

const upgrade = (db: IDBDatabase): void => {
  if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE);
  if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE);
};

const isAvailable = (): boolean => typeof indexedDB !== "undefined";

export const saveOfflineDraft = async (draft: OfflineDraft): Promise<void> => {
  if (!isAvailable() || !draft.content.trim()) return;
  try {
    await withStore(DB_NAME, DB_VERSION, upgrade, DRAFT_STORE, "readwrite", (store) => store.put(draft, draft.id));
  } catch {
    // Best-effort; localStorage cache remains the primary draft store.
  }
};

export const loadOfflineDraft = async (id: string): Promise<OfflineDraft | null> => {
  if (!isAvailable()) return null;
  try {
    const value = await withStore<OfflineDraft | undefined>(DB_NAME, DB_VERSION, upgrade, DRAFT_STORE, "readonly", (store) =>
      store.get(id),
    );
    return value ?? null;
  } catch {
    return null;
  }
};

export const clearOfflineDraft = async (id: string): Promise<void> => {
  if (!isAvailable()) return;
  try {
    await withStore(DB_NAME, DB_VERSION, upgrade, DRAFT_STORE, "readwrite", (store) => store.delete(id));
  } catch {
    // Best-effort cleanup.
  }
};

export const listOfflineDrafts = async (): Promise<OfflineDraft[]> => {
  if (!isAvailable()) return [];
  try {
    const values = await withStore<OfflineDraft[]>(DB_NAME, DB_VERSION, upgrade, DRAFT_STORE, "readonly", (store) => store.getAll());
    return pruneOfflineDrafts(values ?? []);
  } catch {
    return [];
  }
};

export const enqueueOfflineSave = async (item: OfflineQueuedSave): Promise<void> => {
  if (!isAvailable()) return;
  try {
    // Same id (same target memo / new-memo slot) replaces the earlier payload.
    await withStore(DB_NAME, DB_VERSION, upgrade, QUEUE_STORE, "readwrite", (store) => store.put(item, item.id));
  } catch {
    // If IDB is unavailable the draft still lives in localStorage.
  }
};

export const listQueuedSaves = async (): Promise<OfflineQueuedSave[]> => {
  if (!isAvailable()) return [];
  try {
    const values = await withStore<OfflineQueuedSave[]>(DB_NAME, DB_VERSION, upgrade, QUEUE_STORE, "readonly", (store) => store.getAll());
    return [...(values ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

export const dequeueOfflineSave = async (id: string): Promise<void> => {
  if (!isAvailable()) return;
  try {
    await withStore(DB_NAME, DB_VERSION, upgrade, QUEUE_STORE, "readwrite", (store) => store.delete(id));
  } catch {
    // Best-effort cleanup.
  }
};

export const replaceQueuedSaves = async (items: readonly OfflineQueuedSave[]): Promise<void> => {
  if (!isAvailable()) return;
  try {
    await withStore(DB_NAME, DB_VERSION, upgrade, QUEUE_STORE, "readwrite", (store) => {
      store.clear();
      for (const entry of items) store.put(entry, entry.id);
      return store.getAll();
    });
  } catch {
    // Best-effort.
  }
};

export { removeQueuedSave };
