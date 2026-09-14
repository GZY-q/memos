/**
 * Pure offline draft-queue logic: what to queue, how to merge retries, and
 * which failures are worth retrying. Storage and network stay injected so the
 * unit tests never touch IndexedDB or the network.
 */

import { Code, ConnectError } from "@connectrpc/connect";

export type OfflineSaveKind = "create" | "update" | "comment";

export interface OfflineQueuedSave {
  /** Stable id so a later attempt for the same target replaces the earlier one. */
  id: string;
  kind: OfflineSaveKind;
  content: string;
  visibility: number;
  /** Target memo name for updates. */
  memoName?: string;
  /** Parent memo name for comments. */
  parentMemoName?: string;
  /** Space resource name for creates. */
  space?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OfflineDraft {
  /** Editor cache key, e.g. `users/steven-home-memo-editor`. */
  id: string;
  content: string;
  updatedAt: number;
}

export const OFFLINE_QUEUE_MAX_ITEMS = 50;

const NETWORK_CODES: Code[] = [Code.Unavailable, Code.DeadlineExceeded, Code.Aborted, Code.Internal, Code.Unknown];

/** True when a save failure is likely transient / offline and should be queued. */
export const shouldQueueSaveError = (error: unknown): boolean => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (typeof error === "object" && error !== null && (error as { name?: string }).name === "TypeError") {
    // fetch() rejects with TypeError on network failure.
    return true;
  }
  if (error instanceof ConnectError) {
    return NETWORK_CODES.includes(error.code);
  }
  if (error instanceof Error && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return true;
  }
  return false;
};

export const offlineSaveId = (kind: OfflineSaveKind, target?: string): string => `${kind}:${target || "new"}`;

/** Newest-first merge: a retry for the same id replaces the previous payload. */
export const upsertQueuedSave = (
  list: readonly OfflineQueuedSave[],
  item: OfflineQueuedSave,
  max = OFFLINE_QUEUE_MAX_ITEMS,
): OfflineQueuedSave[] => {
  const next = [item, ...list.filter((entry) => entry.id !== item.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  return next.slice(0, max);
};

export const removeQueuedSave = (list: readonly OfflineQueuedSave[], id: string): OfflineQueuedSave[] =>
  list.filter((entry) => entry.id !== id);

const OFFLINE_DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const pruneOfflineDrafts = (list: readonly OfflineDraft[], now = Date.now(), max = 20): OfflineDraft[] =>
  list
    .filter((draft) => draft.content.trim().length > 0 && now - draft.updatedAt < OFFLINE_DRAFT_TTL_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);

export type FlushOutcome = { flushed: OfflineQueuedSave[]; failed: OfflineQueuedSave[] };

/**
 * Submit queued saves in order. A failure keeps the item (and later ones) for
 * the next flush so a still-offline flush does not drop work.
 */
export const flushQueuedSaves = async (
  list: readonly OfflineQueuedSave[],
  submit: (item: OfflineQueuedSave) => Promise<void>,
): Promise<FlushOutcome> => {
  const ordered = [...list].sort((a, b) => a.updatedAt - b.updatedAt);
  const flushed: OfflineQueuedSave[] = [];
  const failed: OfflineQueuedSave[] = [];
  for (const item of ordered) {
    try {
      await submit(item);
      flushed.push(item);
    } catch {
      failed.push(item);
      // Stop on first failure so later drafts do not jump a still-broken network.
      break;
    }
  }
  return { flushed, failed: [...failed, ...ordered.slice(flushed.length + failed.length)] };
};
