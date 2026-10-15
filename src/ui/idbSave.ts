import { createMemoryStorage, type SaveData, type SaveStorage } from '../shared/save';

/**
 * Thin IndexedDB wrapper for the save game (M5, D-099). One database, one object store, one key per
 * slot. No logic lives here (the format and the checks are in src/shared/save.ts and src/sim/save.ts),
 * so it is not run under Node. When IndexedDB is not available (private windows in some browsers)
 * the memory storage stands in and a save lasts until the page closes.
 */

const DB_NAME = 'colony-ship';
const STORE = 'saves';

/** How long any storage step may take before the menu gets an error instead of "Loading..." forever. */
export const IDB_TIMEOUT_MS = 8000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('The save storage did not answer in time.'));
    }, IDB_TIMEOUT_MS);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      clearTimeout(timer);
      // Too late: the caller already gave up, so do not leave the connection open.
      if (settled) req.result.close();
      else resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('IndexedDB could not be opened.'));
    };
    // Another tab holds an older connection and blocks the upgrade.
    req.onblocked = () => {
      clearTimeout(timer);
      settled = true;
      reject(
        new Error(
          'The save storage is blocked by another tab of the game. Close it and try again.',
        ),
      );
    };
  });
}

function request<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The save storage did not answer in time.')),
      IDB_TIMEOUT_MS,
    );
    let tx: IDBTransaction;
    let req: IDBRequest<T>;
    try {
      tx = db.transaction(STORE, mode);
      req = run(tx.objectStore(STORE));
    } catch (err) {
      // The database closed under us or the store is gone: do not leave the timer running.
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('IndexedDB failed.'));
      return;
    }
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(req.result);
    };
    tx.onerror = () => {
      clearTimeout(timer);
      reject(tx.error ?? new Error('IndexedDB failed.'));
    };
    tx.onabort = () => {
      clearTimeout(timer);
      reject(tx.error ?? new Error('IndexedDB was aborted.'));
    };
  });
}

/** A SaveStorage that says whether it had to give up on IndexedDB and keep saves in memory. */
export interface IdbStorage extends SaveStorage {
  /** Why saves are only kept in memory right now (D-110), or '' when IndexedDB works. */
  fallbackReason(): string;
}

/**
 * IndexedDB storage. When opening it or writing to it fails, the save goes to an in-memory store
 * instead (it lasts until the page closes) and `fallbackReason` says why, so the menu can tell the
 * player the game is not saved for good.
 */
export function createIdbStorage(): IdbStorage {
  const memory = createMemoryStorage();
  let reason = '';
  if (typeof indexedDB === 'undefined') reason = 'This browser has no save storage.';
  const memorySlots = new Set<string>();
  return {
    fallbackReason: () => reason,
    async put(slot: string, data: SaveData): Promise<void> {
      if (reason === '') {
        try {
          const db = await open();
          try {
            await request(db, 'readwrite', (s) => s.put(data, slot));
            memorySlots.delete(slot);
            return;
          } finally {
            db.close();
          }
        } catch (err) {
          reason = err instanceof Error ? err.message : 'The save storage failed.';
        }
      }
      await memory.put(slot, data);
      memorySlots.add(slot);
    },
    async get(slot: string): Promise<SaveData | null> {
      // A slot written to memory after a failure is newer than anything in IndexedDB.
      if (memorySlots.has(slot)) {
        const m = await memory.get(slot);
        if (m !== null) return m;
      }
      if (typeof indexedDB === 'undefined') return null;
      const db = await open();
      try {
        const v = await request<SaveData | undefined>(db, 'readonly', (s) => s.get(slot));
        return v ?? null;
      } finally {
        db.close();
      }
    },
  };
}
