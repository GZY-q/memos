/**
 * Pure TTS audio-cache policy: content-hash keys and LRU eviction.
 * IndexedDB I/O lives in `idbAudioCache.ts` so this module stays unit-testable.
 */

export const TTS_CACHE_MAX_ENTRIES = 50;
export const TTS_CACHE_MAX_BYTES = 50 * 1024 * 1024;
export const TTS_CACHE_DB_NAME = "memos-tts-audio";
export const TTS_CACHE_DB_VERSION = 1;
export const TTS_CACHE_STORE = "audio";

export interface TTSCacheEntryMeta {
  key: string;
  size: number;
  /** Epoch ms of the last successful playback lookup. */
  lastUsed: number;
}

/**
 * FNV-1a 32-bit hash mixed with the text length. Stable across sessions,
 * cheap enough to run on every play, and adequate for cache identity
 * (collisions only cost a wrong audio clip, never correctness of storage).
 */
export const ttsCacheKey = (text: string): string => {
  const normalized = text.trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const h = (hash >>> 0).toString(16).padStart(8, "0");
  return `tts-${h}-${normalized.length}`;
};

/**
 * Evicts least-recently-used entries until both the count and byte budgets
 * are satisfied. The newest entry (`incomingKey` / `incomingSize`) is always
 * kept so a fresh write is never immediately discarded.
 */
export const evictTtsCache = (
  entries: readonly TTSCacheEntryMeta[],
  options?: {
    maxEntries?: number;
    maxBytes?: number;
    incomingKey?: string;
    incomingSize?: number;
    now?: number;
  },
): { keep: TTSCacheEntryMeta[]; drop: string[] } => {
  const maxEntries = options?.maxEntries ?? TTS_CACHE_MAX_ENTRIES;
  const maxBytes = options?.maxBytes ?? TTS_CACHE_MAX_BYTES;
  const now = options?.now ?? Date.now();
  const incomingKey = options?.incomingKey;
  const incomingSize = options?.incomingSize ?? 0;

  // Drop the incoming key from the existing list so re-writes don't double-count.
  const prior = entries.filter((entry) => entry.key !== incomingKey).map((entry) => ({ ...entry }));
  if (incomingKey) {
    prior.push({ key: incomingKey, size: incomingSize, lastUsed: now });
  }

  // Sort newest-first (LRU head).
  const sorted = [...prior].sort((a, b) => b.lastUsed - a.lastUsed || (a.key < b.key ? -1 : 1));

  const keep: TTSCacheEntryMeta[] = [];
  const drop: string[] = [];
  let totalBytes = 0;

  for (const entry of sorted) {
    const wouldExceedCount = keep.length >= maxEntries;
    const wouldExceedBytes = totalBytes + entry.size > maxBytes;
    const isIncoming = entry.key === incomingKey;
    if (!isIncoming && (wouldExceedCount || wouldExceedBytes)) {
      drop.push(entry.key);
      continue;
    }
    // Incoming always stays even if it alone exceeds the budget.
    keep.push(entry);
    totalBytes += entry.size;
  }

  return { keep, drop };
};
