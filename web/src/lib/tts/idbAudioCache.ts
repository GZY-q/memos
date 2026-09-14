/**
 * IndexedDB blob store for synthesized TTS audio, with LRU eviction.
 * Lookups bump `lastUsed` so eviction follows actual playback, not write order.
 */

import { withStore } from "@/lib/offline/idb";
import {
  evictTtsCache,
  TTS_CACHE_DB_NAME,
  TTS_CACHE_DB_VERSION,
  TTS_CACHE_MAX_BYTES,
  TTS_CACHE_MAX_ENTRIES,
  TTS_CACHE_STORE,
  type TTSCacheEntryMeta,
  ttsCacheKey,
} from "./audioCache";

interface TTSCacheRecord {
  key: string;
  contentType: string;
  blob: Blob;
  size: number;
  lastUsed: number;
}

const upgrade = (db: IDBDatabase): void => {
  if (!db.objectStoreNames.contains(TTS_CACHE_STORE)) {
    const store = db.createObjectStore(TTS_CACHE_STORE, { keyPath: "key" });
    store.createIndex("lastUsed", "lastUsed");
  }
};

const isAvailable = (): boolean => typeof indexedDB !== "undefined";

export type CachedTtsAudio = { audio: Uint8Array; contentType: string };

const toUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

/** Read a cached clip and bump its LRU timestamp. Returns null on miss. */
export const getCachedTtsAudio = async (text: string): Promise<CachedTtsAudio | null> => {
  if (!isAvailable()) return null;
  const key = ttsCacheKey(text);
  try {
    const record = await withStore<TTSCacheRecord | undefined>(
      TTS_CACHE_DB_NAME,
      TTS_CACHE_DB_VERSION,
      upgrade,
      TTS_CACHE_STORE,
      "readonly",
      (store) => store.get(key),
    );
    if (!record?.blob) return null;
    // Best-effort touch so LRU reflects playback.
    void withStore(TTS_CACHE_DB_NAME, TTS_CACHE_DB_VERSION, upgrade, TTS_CACHE_STORE, "readwrite", (store) =>
      store.put({ ...record, lastUsed: Date.now() }),
    );
    return { audio: await toUint8Array(record.blob), contentType: record.contentType };
  } catch {
    return null;
  }
};

/** Write a synthesized clip and apply LRU eviction. */
export const putCachedTtsAudio = async (text: string, audio: Uint8Array, contentType: string): Promise<void> => {
  if (!isAvailable()) return;
  const key = ttsCacheKey(text);
  const size = audio.byteLength;
  if (size === 0 || size > TTS_CACHE_MAX_BYTES) return;
  // Copy so the Blob owns an exact-length ArrayBuffer regardless of the view.
  const bytes = Uint8Array.from(audio);
  const blob = new Blob([bytes.buffer], { type: contentType });
  try {
    const existing = await withStore<TTSCacheRecord[]>(
      TTS_CACHE_DB_NAME,
      TTS_CACHE_DB_VERSION,
      upgrade,
      TTS_CACHE_STORE,
      "readonly",
      (store) => store.getAll(),
    );
    const metas: TTSCacheEntryMeta[] = (existing ?? []).map((record) => ({
      key: record.key,
      size: record.size,
      lastUsed: record.lastUsed,
    }));
    const { drop } = evictTtsCache(metas, {
      maxEntries: TTS_CACHE_MAX_ENTRIES,
      maxBytes: TTS_CACHE_MAX_BYTES,
      incomingKey: key,
      incomingSize: size,
    });
    await withStore(TTS_CACHE_DB_NAME, TTS_CACHE_DB_VERSION, upgrade, TTS_CACHE_STORE, "readwrite", (store) => {
      for (const dropKey of drop) store.delete(dropKey);
      store.put({ key, contentType, blob, size, lastUsed: Date.now() } satisfies TTSCacheRecord);
      return store.getAll();
    });
  } catch {
    // Cache is best-effort; playback already has the bytes in memory.
  }
};

/** Clear every cached clip (used by tests and future settings controls). */
export const clearTtsAudioCache = async (): Promise<void> => {
  if (!isAvailable()) return;
  try {
    await withStore(TTS_CACHE_DB_NAME, TTS_CACHE_DB_VERSION, upgrade, TTS_CACHE_STORE, "readwrite", (store) => store.clear());
  } catch {
    // Best-effort.
  }
};
