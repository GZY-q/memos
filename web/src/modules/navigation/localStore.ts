/**
 * Primary local persistence for the navigation config.
 *
 * IndexedDB when available (multi-MB quota, survives large bookmark walls),
 * localStorage as the fallback (~5MB, and the path exercised in jsdom tests).
 * The config memo is an optional cross-device sync backup — never the source
 * of truth — so an over-limit config still saves on this device.
 */

import { NAV_STORAGE_KEYS, type NavConfig } from "./types";
import { parseNavConfig } from "./validate";

const DB_NAME = "nav-config-store";
const DB_STORE = "kv";
const DB_KEY = "config";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });

const idbGet = async (): Promise<string | null> => {
  const db = await openDb();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("indexedDB get failed"));
    });
  } finally {
    db.close();
  }
};

const idbSet = async (raw: string): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(raw, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
    });
  } finally {
    db.close();
  }
};

const idbDelete = async (): Promise<void> => {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB delete failed"));
    });
  } finally {
    db.close();
  }
};

/** localStorage primary key. */
const lsGetPrimary = (): string | null => {
  try {
    return localStorage.getItem(NAV_STORAGE_KEYS.local);
  } catch {
    return null;
  }
};

/** Legacy cache key (pre-local-first primary; still used as a fallback). */
const lsGetLegacy = (): string | null => {
  try {
    return localStorage.getItem(NAV_STORAGE_KEYS.cache);
  } catch {
    return null;
  }
};

/**
 * Loads the primary local copy. Prefers the higher-rev of IDB and the
 * localStorage keys so a one-sided write failure cannot strand a stale copy.
 */
export const loadLocalConfig = async (): Promise<NavConfig | null> => {
  let fromIdb: NavConfig | null = null;
  try {
    const raw = await idbGet();
    fromIdb = raw ? parseNavConfig(raw) : null;
  } catch {
    // IDB unavailable or unreadable — fall through to localStorage.
  }
  const primaryRaw = lsGetPrimary();
  const legacyRaw = lsGetLegacy();
  const fromPrimary = primaryRaw ? parseNavConfig(primaryRaw) : null;
  const fromLegacy = legacyRaw ? parseNavConfig(legacyRaw) : null;
  const fromLs = fromPrimary && fromLegacy ? (fromPrimary.rev >= fromLegacy.rev ? fromPrimary : fromLegacy) : (fromPrimary ?? fromLegacy);
  if (fromIdb && fromLs) return fromIdb.rev >= fromLs.rev ? fromIdb : fromLs;
  return fromIdb ?? fromLs;
};

/**
 * Writes the primary local copy to both backends (best effort each).
 * Throws only when neither backend accepted the write.
 */
export const saveLocalConfig = async (config: NavConfig): Promise<void> => {
  const raw = JSON.stringify(config);
  let idbOk = false;
  try {
    await idbSet(raw);
    idbOk = true;
  } catch {
    // Fall through.
  }
  let lsOk = false;
  try {
    localStorage.setItem(NAV_STORAGE_KEYS.local, raw);
    lsOk = true;
  } catch {
    // Quota / private mode.
  }
  // Keep the legacy cache key warm so degraded paths and older tests still see a copy.
  try {
    localStorage.setItem(NAV_STORAGE_KEYS.cache, raw);
  } catch {
    // Ignore.
  }
  if (!idbOk && !lsOk) throw new Error("local nav-config storage unavailable");
};

export const clearLocalConfig = async (): Promise<void> => {
  try {
    await idbDelete();
  } catch {
    // Best effort.
  }
  try {
    localStorage.removeItem(NAV_STORAGE_KEYS.local);
    localStorage.removeItem(NAV_STORAGE_KEYS.cache);
  } catch {
    // Ignore.
  }
};
