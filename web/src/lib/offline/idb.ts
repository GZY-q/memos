/**
 * Minimal IndexedDB helpers shared by offline drafts and the TTS audio cache.
 * Mirrors the open/put/get pattern used by `modules/navigation/clipboard.ts`
 * so storage failures stay best-effort and never throw at call sites.
 */

export type IdbUpgrade = (db: IDBDatabase) => void;

const openDatabase = (name: string, version: number, upgrade: IdbUpgrade): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => {
      upgrade(request.result);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });

const runTx = <T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  exec: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> =>
  new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = exec(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
  });

export const withStore = async <T>(
  name: string,
  version: number,
  upgrade: IdbUpgrade,
  store: string,
  mode: IDBTransactionMode,
  exec: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDatabase(name, version, upgrade);
  try {
    return await runTx(db, store, mode, exec);
  } finally {
    db.close();
  }
};
