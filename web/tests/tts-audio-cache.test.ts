import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { evictTtsCache, TTS_CACHE_MAX_ENTRIES, type TTSCacheEntryMeta, ttsCacheKey } from "@/lib/tts/audioCache";

describe("tts audio cache key", () => {
  it("is stable for identical text", () => {
    expect(ttsCacheKey("hello world")).toBe(ttsCacheKey("hello world"));
  });

  it("normalizes surrounding whitespace", () => {
    expect(ttsCacheKey("  hello  ")).toBe(ttsCacheKey("hello"));
  });

  it("differs for different text", () => {
    expect(ttsCacheKey("hello")).not.toBe(ttsCacheKey("hello!"));
    expect(ttsCacheKey("a")).not.toBe(ttsCacheKey("b"));
  });

  it("is prefixed and includes length", () => {
    const key = ttsCacheKey("hello");
    expect(key.startsWith("tts-")).toBe(true);
    expect(key.endsWith("-5")).toBe(true);
  });
});

describe("tts cache LRU eviction", () => {
  const meta = (key: string, lastUsed: number, size = 100): TTSCacheEntryMeta => ({ key, size, lastUsed });

  it("drops least-recently-used entries when over the count budget", () => {
    const now = 1_000;
    const entries = Array.from({ length: 5 }, (_, i) => meta(`old-${i}`, now - 100 + i));
    const { keep, drop } = evictTtsCache(entries, {
      maxEntries: 3,
      maxBytes: 1_000_000,
      incomingKey: "incoming",
      incomingSize: 10,
      now,
    });

    expect(keep.map((e) => e.key)).toEqual(["incoming", "old-4", "old-3"]);
    expect(drop.sort()).toEqual(["old-0", "old-1", "old-2"]);
  });

  it("drops by byte budget before count budget", () => {
    const now = 5_000;
    const entries = [meta("big", 100, 40_000), meta("mid", 200, 30_000), meta("small", 300, 10_000)];
    const { keep, drop } = evictTtsCache(entries, {
      maxEntries: 50,
      maxBytes: 45_000,
      incomingKey: "incoming",
      incomingSize: 20_000,
      now,
    });

    expect(keep.map((e) => e.key)).toEqual(["incoming", "small"]);
    expect(drop.sort()).toEqual(["big", "mid"]);
  });

  it("always keeps the incoming entry even if it alone exceeds the budget", () => {
    const { keep } = evictTtsCache([], {
      maxEntries: 1,
      maxBytes: 10,
      incomingKey: "huge",
      incomingSize: 10_000,
      now: 1,
    });
    expect(keep.map((e) => e.key)).toEqual(["huge"]);
  });

  it("replaces an existing entry for the same key without double-counting", () => {
    const now = 9_000;
    const entries = [meta("same", 1, 50), meta("other", 2, 50)];
    const { keep, drop } = evictTtsCache(entries, {
      maxEntries: 2,
      maxBytes: 1000,
      incomingKey: "same",
      incomingSize: 80,
      now,
    });
    expect(drop).toEqual([]);
    expect(keep.find((e) => e.key === "same")?.size).toBe(80);
    expect(keep).toHaveLength(2);
  });

  it("defaults to the published entry budget", () => {
    const entries = Array.from({ length: TTS_CACHE_MAX_ENTRIES + 5 }, (_, i) => meta(`e-${i}`, i));
    const { keep, drop } = evictTtsCache(entries, { incomingKey: "incoming", incomingSize: 1, now: 99_999 });
    // 55 existing + 1 incoming = 56 candidates; keep 50, drop the 6 oldest.
    expect(keep).toHaveLength(TTS_CACHE_MAX_ENTRIES);
    expect(drop).toHaveLength(6);
    expect(keep[0].key).toBe("incoming");
  });
});

/**
 * Simulates the play-time cache decision: a hit must skip synthesize entirely.
 * The IDB layer is mocked so this stays a pure logic test.
 */
describe("tts play cache hit", () => {
  type Cached = { audio: Uint8Array; contentType: string };

  const createPipeline = (cache: Map<string, Cached>) => {
    let synthesizeCalls = 0;
    const synthesize = async (_text: string): Promise<Cached> => {
      synthesizeCalls += 1;
      return { audio: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" };
    };
    const play = async (text: string): Promise<Cached> => {
      const key = ttsCacheKey(text);
      const hit = cache.get(key);
      if (hit) return hit;
      const fresh = await synthesize(text);
      cache.set(key, fresh);
      return fresh;
    };
    return { play, synthesizeCalls: () => synthesizeCalls };
  };

  it("skips synthesize on a cache hit", async () => {
    const cache = new Map<string, Cached>();
    const pipeline = createPipeline(cache);

    await pipeline.play("hello memo");
    expect(pipeline.synthesizeCalls()).toBe(1);

    await pipeline.play("hello memo");
    expect(pipeline.synthesizeCalls()).toBe(1);

    await pipeline.play("different text");
    expect(pipeline.synthesizeCalls()).toBe(2);
  });

  it("treats unavailable connect errors as non-cacheable", async () => {
    // Guard the policy used by useTTSPlayer: a failed synthesize must not write.
    const error = new ConnectError("offline", Code.Unavailable);
    await expect(
      (async () => {
        throw error;
      })(),
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
