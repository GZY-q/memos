import { useCallback, useEffect, useState } from "react";
import { ttsService } from "@/components/MemoEditor/services/ttsService";
import { extractSpeechText } from "@/utils/speech-text";

export type TTSPlaybackStatus = "idle" | "loading" | "playing";

type SharedPlayerState = {
  status: TTSPlaybackStatus;
  /** Memo name currently being spoken, if any. */
  memoName?: string;
};

// Shared across all memo action menus so only one memo is spoken at a time.
const listeners = new Set<(state: SharedPlayerState) => void>();
let sharedState: SharedPlayerState = { status: "idle" };
let audioEl: HTMLAudioElement | null = null;
let objectUrl: string | null = null;

const setState = (next: SharedPlayerState) => {
  sharedState = next;
  for (const listener of listeners) {
    listener(next);
  }
};

const cleanupAudio = () => {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.onended = null;
    audioEl.onerror = null;
    audioEl.src = "";
    audioEl = null;
  }
};

const stopShared = () => {
  cleanupAudio();
  setState({ status: "idle" });
};

const playShared = async (memoName: string, content: string) => {
  const text = extractSpeechText(content);
  if (!text) {
    throw new Error("empty");
  }

  stopShared();
  setState({ status: "loading", memoName });
  try {
    const { audio, contentType } = await ttsService.synthesize(text);
    // Copy into a fresh ArrayBuffer so Blob accepts the typed array buffer.
    const bytes = Uint8Array.from(audio);
    const blob = new Blob([bytes.buffer], { type: contentType });
    objectUrl = URL.createObjectURL(blob);
    audioEl = new Audio(objectUrl);
    audioEl.onended = () => stopShared();
    audioEl.onerror = () => stopShared();
    setState({ status: "playing", memoName });
    await audioEl.play();
  } catch (error) {
    stopShared();
    throw error;
  }
};

/**
 * Plays memo content through the instance TTS provider.
 * All components share one global playback session per tab.
 */
export function useTTSPlayer(memoName?: string) {
  const [state, setLocalState] = useState<SharedPlayerState>(sharedState);

  useEffect(() => {
    listeners.add(setLocalState);
    setLocalState(sharedState);
    return () => {
      listeners.delete(setLocalState);
    };
  }, []);

  const isSpeakingThisMemo = Boolean(memoName) && state.memoName === memoName && state.status !== "idle";
  const isBusy = state.status !== "idle";

  const stop = useCallback(() => {
    stopShared();
  }, []);

  const play = useCallback(
    async (content: string) => {
      await playShared(memoName ?? "unknown", content);
    },
    [memoName],
  );

  return {
    status: state.status,
    isBusy,
    isSpeakingThisMemo,
    play,
    stop,
  };
}
