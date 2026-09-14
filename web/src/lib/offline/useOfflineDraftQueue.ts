/**
 * React glue for the offline draft queue: listens for `online`, flushes queued
 * saves through the real memo RPCs, and surfaces toasts.
 */

import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { memoServiceClient } from "@/connect";
import { attachmentKeys } from "@/hooks/useAttachmentQueries";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import type { OfflineQueuedSave } from "@/lib/offline/draftQueue";
import { dequeueOfflineSave, enqueueOfflineSave, listQueuedSaves } from "@/lib/offline/offlineDrafts";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/** Submits one queued save against the live memo service. */
export const submitQueuedSave = async (item: OfflineQueuedSave): Promise<void> => {
  const visibility = item.visibility as Visibility;
  if (item.kind === "update" && item.memoName) {
    await memoServiceClient.updateMemo({
      memo: create(MemoSchema, {
        name: item.memoName,
        content: item.content,
        visibility,
      }),
      updateMask: create(FieldMaskSchema, { paths: ["content", "visibility", "update_time"] }),
    });
    return;
  }
  const memo = create(MemoSchema, {
    content: item.content,
    visibility,
    space: item.kind === "comment" ? undefined : item.space,
  });
  if (item.kind === "comment" && item.parentMemoName) {
    await memoServiceClient.createMemoComment({
      name: item.parentMemoName,
      comment: memo,
    });
    return;
  }
  await memoServiceClient.createMemo({ memo });
};

const isBrowser = typeof window !== "undefined";

/** Shared flush lock so concurrent editors cannot drain the queue twice. */
let flushing = false;

/** Persist a failed save into the offline queue. Callers own the toast copy. */
export const queueOfflineSave = async (item: Omit<OfflineQueuedSave, "createdAt" | "updatedAt">): Promise<void> => {
  const now = Date.now();
  await enqueueOfflineSave({ ...item, createdAt: now, updatedAt: now });
};

/**
 * Drain the offline save queue in order. Safe to call from multiple mount
 * points; concurrent callers collapse onto one pass.
 * Returns how many items were submitted.
 */
export const flushOfflineQueue = async (options?: { onFlushed?: () => void }): Promise<number> => {
  if (flushing) return 0;
  flushing = true;
  try {
    const queued = await listQueuedSaves();
    if (queued.length === 0) return 0;
    const ordered = [...queued].sort((a, b) => a.updatedAt - b.updatedAt);
    let submitted = 0;
    for (const item of ordered) {
      try {
        await submitQueuedSave(item);
        await dequeueOfflineSave(item.id);
        submitted += 1;
      } catch {
        // Still offline or rejected — keep remaining items for the next flush.
        break;
      }
    }
    if (submitted > 0) {
      options?.onFlushed?.();
    }
    return submitted;
  } finally {
    flushing = false;
  }
};

/** Tracks online/offline and drains the offline save queue when connectivity returns. */
export function useOfflineDraftQueue() {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(() => (isBrowser ? navigator.onLine !== false : true));
  const tRef = useRef(t);
  tRef.current = t;

  const invalidateAfterFlush = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: memoKeys.lists() });
    void queryClient.invalidateQueries({ queryKey: userKeys.stats() });
    void queryClient.invalidateQueries({ queryKey: attachmentKeys.lists() });
  }, [queryClient]);

  const flush = useCallback(async () => {
    const submitted = await flushOfflineQueue({ onFlushed: invalidateAfterFlush });
    if (submitted > 0) {
      toast.success(tRef.current("editor.offline-queue-flushed"));
    }
  }, [invalidateAfterFlush]);

  useEffect(() => {
    if (!isBrowser) return;
    const handleOnline = () => {
      setIsOnline(true);
      void flush();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Drain anything left over from a previous session.
    void flush();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flush]);

  const queueSave = useCallback(async (item: Omit<OfflineQueuedSave, "createdAt" | "updatedAt">) => {
    await queueOfflineSave(item);
    toast.success(tRef.current("editor.offline-draft-saved"));
  }, []);

  return { isOnline, queueSave, flush };
}
