/**
 * Testable playback-queue store for the global TTS session.
 *
 * Owns queue/state transitions only; synthesis and audio playback are injected
 * so unit tests never touch the network or DOM. The React hook in
 * `useTTSPlayer.ts` wires one shared store instance to the real backend.
 */

export type TTSPlaybackStatus = "idle" | "loading" | "playing";

export interface TTSQueueItem {
  memoName: string;
  content: string;
}

export interface TTSPlayerState {
  status: TTSPlaybackStatus;
  /** Memo name currently being spoken, if any. */
  memoName?: string;
  /** Upcoming items, in play order. */
  queue: readonly TTSQueueItem[];
}

export interface TTSStartHandlers {
  onEnded: () => void;
  onError: () => void;
}

export interface TTSPlayerIO {
  /** Extract speakable text; return an empty string when there is nothing to say. */
  extractText: (content: string) => string;
  /**
   * Synthesize and start playback of `text`.
   * Resolves with a stop handle once audio is actually playing.
   */
  start: (text: string, handlers: TTSStartHandlers) => Promise<() => void>;
}

const IDLE_STATE: TTSPlayerState = { status: "idle", queue: [] };

export class TTSPlayerStore {
  private readonly listeners = new Set<(state: TTSPlayerState) => void>();
  private state: TTSPlayerState = IDLE_STATE;
  private stopHandle: (() => void) | null = null;
  /** Bumped on every interrupt so stale async `start` results are discarded. */
  private generation = 0;

  constructor(private readonly io: TTSPlayerIO) {}

  getState = (): TTSPlayerState => this.state;

  subscribe = (listener: (state: TTSPlayerState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Play immediately: interrupts whatever is playing and clears the queue. */
  play = async (memoName: string, content: string): Promise<void> => {
    if (!this.io.extractText(content)) {
      throw new Error("empty");
    }
    this.halt();
    this.emit({ status: "loading", memoName, queue: [] });
    await this.startItem({ memoName, content });
  };

  /**
   * Queue a memo for later. When nothing is playing this starts it right away
   * (same as `play`); otherwise it appends after the existing queue.
   */
  enqueue = async (memoName: string, content: string): Promise<void> => {
    if (!this.io.extractText(content)) {
      throw new Error("empty");
    }
    if (this.state.status === "idle") {
      await this.play(memoName, content);
      return;
    }
    this.emit({ ...this.state, queue: [...this.state.queue, { memoName, content }] });
  };

  /** Stop playback and drop the queue. */
  stop = (): void => {
    this.halt();
    this.emit({ ...IDLE_STATE });
  };

  /** Drop the current track and start the next queued one, if any. */
  skip = (): void => {
    if (this.state.status === "idle") return;
    this.halt();
    void this.advance();
  };

  private emit(next: TTSPlayerState): void {
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  /** Invalidate in-flight loads and tear down the current audio, keeping the queue. */
  private halt(): void {
    this.generation += 1;
    if (this.stopHandle) {
      this.stopHandle();
      this.stopHandle = null;
    }
  }

  private handleEnded = (generation: number): void => {
    if (generation !== this.generation) return;
    if (this.stopHandle) {
      this.stopHandle();
      this.stopHandle = null;
    }
    void this.advance();
  };

  private handleError = (generation: number): void => {
    if (generation !== this.generation) return;
    this.stop();
  };

  /** Shift the next queued item into playback; go idle when the queue is empty. */
  private async advance(): Promise<void> {
    const [next, ...rest] = this.state.queue;
    if (!next) {
      this.emit({ ...IDLE_STATE });
      return;
    }
    this.emit({ status: "loading", memoName: next.memoName, queue: rest });
    await this.startItem(next);
  }

  private async startItem(item: TTSQueueItem): Promise<void> {
    const text = this.io.extractText(item.content);
    if (!text) {
      await this.advance();
      return;
    }
    const generation = this.generation;
    try {
      const stop = await this.io.start(text, {
        onEnded: () => this.handleEnded(generation),
        onError: () => this.handleError(generation),
      });
      if (generation !== this.generation) {
        // Interrupted while synthesizing — discard this track.
        stop();
        return;
      }
      this.stopHandle = stop;
      this.emit({ status: "playing", memoName: item.memoName, queue: this.state.queue });
    } catch (error) {
      if (generation === this.generation) {
        this.stopHandle = null;
        this.emit({ status: "idle", queue: this.state.queue });
      }
      throw error;
    }
  }
}
