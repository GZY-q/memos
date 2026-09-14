import { describe, expect, it, vi } from "vitest";
import { type TTSPlayerIO, type TTSPlayerState, TTSPlayerStore } from "@/hooks/ttsPlayerStore";

type TrackHandlers = { onEnded: () => void; onError: () => void };

/** Backend whose `start` stays pending until the test resolves/rejects it. */
const createDeferredBackend = () => {
  const started: string[] = [];
  let stops = 0;
  let pendingResolve: (() => void) | null = null;
  let pendingReject: ((error: unknown) => void) | null = null;
  let handlers: TrackHandlers | null = null;

  const io: TTSPlayerIO = {
    extractText: (content) => content.trim(),
    start: (text, nextHandlers) => {
      started.push(text);
      handlers = nextHandlers;
      return new Promise<() => void>((resolve, reject) => {
        pendingResolve = () =>
          resolve(() => {
            stops += 1;
          });
        pendingReject = reject;
      });
    },
  };

  return {
    io,
    started,
    stopCount: () => stops,
    resolveStart: () => {
      const resolve = pendingResolve;
      pendingResolve = null;
      pendingReject = null;
      resolve?.();
    },
    rejectStart: (error: unknown) => {
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;
      reject?.(error);
    },
    finishTrack: () => handlers?.onEnded(),
    failTrack: () => handlers?.onError(),
  };
};

/** Backend that starts playback immediately (synthesis already "done"). */
const createInstantBackend = () => {
  const started: string[] = [];
  const stopCalls: number[] = [];
  let handlers: TrackHandlers | null = null;

  const io: TTSPlayerIO = {
    extractText: (content) => content.trim(),
    start: (text, nextHandlers) => {
      started.push(text);
      handlers = nextHandlers;
      const index = started.length - 1;
      stopCalls[index] = 0;
      return Promise.resolve(() => {
        stopCalls[index] = (stopCalls[index] ?? 0) + 1;
      });
    },
  };

  return {
    io,
    started,
    stopCalls,
    finishTrack: () => handlers?.onEnded(),
    failTrack: () => handlers?.onError(),
  };
};

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe("TTSPlayerStore", () => {
  it("plays a single memo and reports status transitions", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    const seen: TTSPlayerState[] = [];
    store.subscribe((state) => seen.push(state));

    const playPromise = store.play("memos/1", "hello");
    expect(store.getState().status).toBe("loading");
    expect(store.getState().memoName).toBe("memos/1");

    backend.resolveStart();
    await playPromise;
    expect(store.getState().status).toBe("playing");
    expect(store.getState().queue).toEqual([]);
    expect(seen.map((state) => state.status)).toEqual(["loading", "playing"]);
  });

  it("rejects empty content without touching playback", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    await expect(store.play("memos/1", "   ")).rejects.toThrow("empty");
    expect(store.getState().status).toBe("idle");
    expect(backend.started).toEqual([]);
  });

  it("play interrupts current speech and clears the queue", async () => {
    const backend = createInstantBackend();
    const store = new TTSPlayerStore(backend.io);

    await store.play("memos/1", "first");
    await store.enqueue("memos/2", "second");
    await store.enqueue("memos/3", "third");
    expect(store.getState().queue.map((item) => item.memoName)).toEqual(["memos/2", "memos/3"]);

    await store.play("memos/4", "fourth");
    expect(store.getState().memoName).toBe("memos/4");
    expect(store.getState().queue).toEqual([]);
    expect(backend.started).toEqual(["first", "fourth"]);
    // First track was stopped when play() interrupted it.
    expect(backend.stopCalls[0]).toBe(1);
  });

  it("enqueue while idle starts playback immediately", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    const enqueuePromise = store.enqueue("memos/1", "only");
    backend.resolveStart();
    await enqueuePromise;
    expect(store.getState().status).toBe("playing");
    expect(store.getState().memoName).toBe("memos/1");
  });

  it("enqueue while playing appends to the queue", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    const playPromise = store.play("memos/1", "first");
    backend.resolveStart();
    await playPromise;

    await store.enqueue("memos/2", "second");
    await store.enqueue("memos/3", "third");
    expect(store.getState().status).toBe("playing");
    expect(store.getState().memoName).toBe("memos/1");
    expect(store.getState().queue.map((item) => item.content)).toEqual(["second", "third"]);
  });

  it("advances to the next queued memo when a track ends", async () => {
    const backend = createInstantBackend();
    const store = new TTSPlayerStore(backend.io);

    await store.play("memos/1", "first");
    await store.enqueue("memos/2", "second");
    await store.enqueue("memos/3", "third");

    backend.finishTrack();
    await flush();
    expect(store.getState().memoName).toBe("memos/2");
    expect(store.getState().status).toBe("playing");
    expect(store.getState().queue.map((item) => item.memoName)).toEqual(["memos/3"]);

    backend.finishTrack();
    await flush();
    expect(store.getState().memoName).toBe("memos/3");
    expect(store.getState().queue).toEqual([]);

    backend.finishTrack();
    await flush();
    expect(store.getState().status).toBe("idle");
    expect(store.getState().memoName).toBeUndefined();
  });

  it("skip drops the current track and starts the next", async () => {
    const backend = createInstantBackend();
    const store = new TTSPlayerStore(backend.io);

    await store.play("memos/1", "first");
    await store.enqueue("memos/2", "second");
    store.skip();
    await flush();
    expect(store.getState().memoName).toBe("memos/2");
    expect(backend.started).toEqual(["first", "second"]);

    store.skip();
    await flush();
    expect(store.getState().status).toBe("idle");
  });

  it("skip on an idle store is a no-op", () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    store.skip();
    expect(store.getState().status).toBe("idle");
    expect(backend.started).toEqual([]);
  });

  it("stop clears playback and the queue", async () => {
    const backend = createInstantBackend();
    const store = new TTSPlayerStore(backend.io);

    await store.play("memos/1", "first");
    await store.enqueue("memos/2", "second");
    store.stop();
    expect(store.getState().status).toBe("idle");
    expect(store.getState().queue).toEqual([]);
    expect(backend.stopCalls[0]).toBe(1);

    // A late natural-end from the halted track must not revive playback.
    backend.finishTrack();
    await flush();
    expect(store.getState().status).toBe("idle");
  });

  it("discards a synthesis that finishes after an interrupt", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);

    const playPromise = store.play("memos/1", "slow");
    store.stop();
    backend.resolveStart();
    await playPromise;
    expect(store.getState().status).toBe("idle");
    // The late start was torn down via its stop handle.
    expect(backend.stopCount()).toBe(1);
  });

  it("goes idle and surfaces the error when synthesis fails", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    const playPromise = store.play("memos/1", "boom");
    backend.rejectStart(new Error("synth failed"));
    await expect(playPromise).rejects.toThrow("synth failed");
    expect(store.getState().status).toBe("idle");
  });

  it("an audio error stops the whole queue", async () => {
    const backend = createInstantBackend();
    const store = new TTSPlayerStore(backend.io);

    await store.play("memos/1", "first");
    await store.enqueue("memos/2", "second");
    backend.failTrack();
    await flush();
    expect(store.getState().status).toBe("idle");
    expect(store.getState().queue).toEqual([]);
  });

  it("notifies subscribers and supports unsubscribe", async () => {
    const backend = createDeferredBackend();
    const store = new TTSPlayerStore(backend.io);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    const playPromise = store.play("memos/1", "hello");
    backend.resolveStart();
    await playPromise;
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.stop();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
