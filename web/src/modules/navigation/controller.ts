/**
 * Orchestration layer. `localStore.ts` is the primary persistence (IndexedDB
 * with localStorage fallback); `storage.ts` stays raw memo RPC for the optional
 * cross-device backup; `cache.ts` keeps the pre-save crash snapshot.
 *
 * Read path (local-first):
 * - local + memo both present, memo newer -> `mergeNavConfigs`, persist merged locally
 * - local + memo, local equal/ahead      -> local wins (covers local-only oversized walls)
 * - local only                           -> "local"; memo lookup failure is non-fatal
 * - memo only                            -> migrate into local ("memo")
 * - neither                              -> first visit: seed local, best-effort memo backup
 * - broken memo, no local                -> null (never re-seed over a recoverable memo)
 *
 * Write path: bump `rev`, snapshot the last-known-good config, write local
 * (primary), then upsert the memo backup only when the body fits the server
 * content cap. Oversized configs save locally and surface
 * `memoSync: "skipped-too-large"` for the UI hint.
 */

import { State } from "@/types/proto/api/v1/common_pb";
import { markInitialized, readCachedConfig, readPreSaveSnapshot, writeCache, writePreSaveSnapshot } from "./cache";
import { clearLocalConfig, loadLocalConfig, saveLocalConfig } from "./localStore";
import { mergeNavConfigs, pruneTombstones } from "./merge";
import {
  archiveConfigMemo,
  buildConfigContent,
  createConfigMemo,
  deleteConfigMemo,
  extractConfigFromMemo,
  findConfigMemo,
  updateConfigMemo,
} from "./storage";
import { createSeedConfig, type MemoSyncStatus, NAV_CONFIG_MEMO_CONTENT_LIMIT, type NavConfig } from "./types";

export type NavConfigSource = "local" | "memo" | "seed" | "local+memo" | "cache";

export interface NavConfigState {
  config: NavConfig;
  memoName: string | null;
  source: NavConfigSource;
  memoSync: MemoSyncStatus;
}

export interface PersistResult {
  config: NavConfig;
  memoName: string | null;
  memoSync: MemoSyncStatus;
}

const nextRev = (config: NavConfig): NavConfig => ({
  ...config,
  rev: config.rev + 1,
  updatedAt: Date.now(),
});

const isContentTooLong = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("content too long") || message.includes("invalid_argument") || message.includes("exceed");
};

/** Prefer local when equal/ahead; merge only when the memo is strictly newer. */
export const resolveLocalAndMemo = (local: NavConfig | null, remote: NavConfig | null): NavConfig | null => {
  if (!local) return remote;
  if (!remote) return local;
  if (remote.rev > local.rev) return mergeNavConfigs(local, remote);
  return local;
};

const rememberLocal = async (config: NavConfig): Promise<void> => {
  await saveLocalConfig(config);
  writeCache(config);
};

export const loadOrSeedConfig = async (): Promise<NavConfigState | null> => {
  const local = (await loadLocalConfig()) ?? readCachedConfig();
  let memoName: string | null = null;
  let remote: NavConfig | null = null;
  let memoBroken = false;
  let rpcFailed = false;

  try {
    const memo = await findConfigMemo();
    if (memo) {
      memoName = memo.name;
      remote = extractConfigFromMemo(memo);
      memoBroken = remote === null;
      if (remote && memo.state !== State.ARCHIVED) {
        try {
          await archiveConfigMemo(memo.name);
          memo.state = State.ARCHIVED;
        } catch {
          // Non-fatal; the config still loads.
        }
      }
    }
  } catch {
    rpcFailed = true;
  }

  if (memoBroken && !local) {
    // Marker present but payload broken — keep it visible in Archive, do not re-seed.
    return null;
  }

  const resolved = resolveLocalAndMemo(local, remote);
  if (resolved) {
    // Persist the merge result (or migrate a memo-only config) into local storage.
    if (!local || resolved !== local) {
      try {
        await rememberLocal(resolved);
      } catch {
        // Local write failed; still render what we have.
      }
    }
    const source: NavConfigSource = local && remote ? "local+memo" : local ? "local" : "memo";
    const memoSync: MemoSyncStatus = remote ? "synced" : rpcFailed && !memoName ? "failed" : memoBroken ? "none" : "none";
    return { config: resolved, memoName, source, memoSync };
  }

  // First visit (or empty local + empty memo): seed locally, memo backup best-effort.
  const config = createSeedConfig();
  await rememberLocal(config);
  try {
    const created = await createConfigMemo(config);
    markInitialized();
    return { config, memoName: created.name, source: "seed", memoSync: "synced" };
  } catch (error) {
    // Offline first visit: the local seed is enough to render and edit.
    if (rpcFailed || isContentTooLong(error)) {
      return { config, memoName: null, source: "seed", memoSync: rpcFailed ? "failed" : "skipped-too-large" };
    }
    throw error;
  }
};

export const persistConfig = async (
  next: NavConfig,
  prev: { config: NavConfig | null; memoName: string | null },
): Promise<PersistResult> => {
  const config = pruneTombstones(nextRev(next));
  if (prev.config) writePreSaveSnapshot(prev.config);
  try {
    await rememberLocal(config);
  } catch (error) {
    const snapshot = readPreSaveSnapshot();
    if (snapshot) {
      try {
        await rememberLocal(snapshot);
      } catch {
        // Snapshot restore is best-effort.
      }
    }
    throw error;
  }

  // Optional memo backup — skipped when the body would exceed the server content cap.
  if (buildConfigContent(config).length > NAV_CONFIG_MEMO_CONTENT_LIMIT) {
    return { config, memoName: prev.memoName, memoSync: "skipped-too-large" };
  }

  try {
    let memoName = prev.memoName;
    if (!memoName) {
      // Degraded path has no memoName. Look up the existing config memo first
      // so a save while the service is back does not fork a second config memo.
      const existing = await findConfigMemo();
      memoName = existing?.name ?? null;
    }
    const memo = memoName ? await updateConfigMemo(memoName, config) : await createConfigMemo(config);
    markInitialized();
    return { config, memoName: memo.name, memoSync: "synced" };
  } catch (error) {
    if (isContentTooLong(error)) {
      return { config, memoName: prev.memoName, memoSync: "skipped-too-large" };
    }
    // Local save already succeeded; a failed backup must not look like data loss.
    return { config, memoName: prev.memoName, memoSync: "failed" };
  }
};

/**
 * Drops the config memo (best effort), clears local storage, and re-seeds.
 * Deletion is best-effort so a transient failure cannot leave the user
 * stranded; the fresh seed still wins on the next load either way.
 */
export const resetConfig = async (memoName: string | null): Promise<NavConfigState | null> => {
  if (memoName) {
    try {
      await deleteConfigMemo(memoName);
    } catch {
      // best effort
    }
  }
  await clearLocalConfig();
  return loadOrSeedConfig();
};
