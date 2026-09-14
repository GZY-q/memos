import { useCallback, useEffect, useState } from "react";
import { ttsService } from "@/components/MemoEditor/services/ttsService";
import { type TTSPlayerIO, type TTSPlayerState, TTSPlayerStore, type TTSQueueItem } from "@/hooks/ttsPlayerStore";
import { extractSpeechText } from "@/utils/speech-text";

export type TTSPlaybackStatus = TTSPlayerState["status"];

/** Browser/TTS backend for the shared store: synthesize then play an <audio>. */
const createBrowserPlayerIO = (): TTSPlayerIO => ({
  extractText: extractSpeechText,
  start: async (text, handlers) => {
    const { audio, contentType } = await ttsService.synthesize(text);
    // Copy into a fresh ArrayBuffer so Blob accepts the typed array buffer.
    const bytes = Uint8Array.from(audio);
    const blob = new Blob([bytes.buffer], { type: contentType });
    const objectUrl = URL.createObjectURL(blob);
    const audioEl = new Audio(objectUrl);
    audioEl.onended = handlers.onEnded;
    audioEl.onerror = handlers.onError;
    try {
      await audioEl.play();
    } catch (error) {
      audioEl.onended = null;
      audioEl.onerror = null;
      audioEl.src = "";
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
    return () => {
      audioEl.pause();
      audioEl.onended = null;
      audioEl.onerror = null;
      audioEl.src = "";
      URL.revokeObjectURL(objectUrl);
    };
  },
});

// Shared across all memo action menus so only one memo is spoken at a time.
export const ttsPlayerStore = new TTSPlayerStore(createBrowserPlayerIO());

/**
 * Plays memo content through the instance TTS provider.
 * All components share one global playback session per tab.
 *
 * `play` is "read this now" (interrupts current speech, clears the queue).
 * `enqueuePlay` / `skip` expose the queue for multi-memo listening.
 */
export function useTTSPlayer(memoName?: string) {
  const [state, setState] = useState<TTSPlayerState>(ttsPlayerStore.getState);

  useEffect(() => ttsPlayerStore.subscribe(setState), []);

  const isSpeakingThisMemo = Boolean(memoName) && state.memoName === memoName && state.status !== "idle";
  const isBusy = state.status !== "idle";

  const stop = useCallback(() => {
    ttsPlayerStore.stop();
  }, []);

  const play = useCallback(
    async (content: string) => {
      await ttsPlayerStore.play(memoName ?? "unknown", content);
    },
    [memoName],
  );

  const enqueuePlay = useCallback(
    async (content: string) => {
      await ttsPlayerStore.enqueue(memoName ?? "unknown", content);
    },
    [memoName],
  );

  const skip = useCallback(() => {
    ttsPlayerStore.skip();
  }, []);

  const enqueueItem = useCallback((item: TTSQueueItem) => {
    void ttsPlayerStore.enqueue(item.memoName, item.content).catch(() => {
      // Empty / failed items are dropped; the button surface handles toasts.
    });
  }, []);

  return {
    status: state.status,
    memoName: state.memoName,
    queue: state.queue,
    queueLength: state.queue.length,
    isBusy,
    isSpeakingThisMemo,
    play,
    stop,
    skip,
    enqueuePlay,
    enqueueItem,
  };
}
