/**
 * Save game format (M5, D-099). A save is the seed plus the command log: loading rebuilds the world
 * from the seed and replays the log day by day, then checks the state hash. Plain typed arrays, so
 * it passes through postMessage and IndexedDB's structured clone unchanged.
 */

export const SAVE_VERSION = 3;

/**
 * Version of the simulation rules (D-107). A save is a replay, so any change that alters what a
 * seed plus a command log produces (balance numbers, formulas, command logging) must bump this
 * together with the golden-hash re-record. 1 = M5 and its first review fixes; 2 = M5 second review
 * (command log merging, natives upkeep, balance retune); 3 = M7a content (30 cards, native variants, find tables); 4 = M7b win rule and homeworld supplies; 5 = M7c (clock 8000, win 10 colonies, D-136).
 */
export const SIM_VERSION = 5;

export interface SaveData {
  version: number;
  /** SIM_VERSION when the save was made; a load refuses a different one with a clear message. */
  simVersion: number;
  seed: number;
  /** Game day when the save was made. */
  day: number;
  /** Hash of the game-data JSONs the save was made with (src/data contentHash); a load refuses a different one. */
  contentHash: number;
  /** The state hash at that moment; a load must reproduce it exactly. */
  stateHash: number;
  /** One entry per logged command: day, type code and COMMAND_MAX_ARGS integers. */
  logDay: Int32Array;
  logType: Uint8Array;
  logArgs: Int32Array;
}

/** Where saves live. IndexedDB in the browser (src/ui/idbSave.ts); a Map in tests. */
export interface SaveStorage {
  put(slot: string, data: SaveData): Promise<void>;
  /** Null when the slot is empty. */
  get(slot: string): Promise<SaveData | null>;
}

export const SAVE_SLOT = 'manual';

/** A storage kept in memory (tests, and the fallback when IndexedDB is not available). */
export function createMemoryStorage(): SaveStorage {
  const slots = new Map<string, SaveData>();
  return {
    put(slot, data) {
      slots.set(slot, structuredClone(data));
      return Promise.resolve();
    },
    get(slot) {
      const d = slots.get(slot);
      return Promise.resolve(d === undefined ? null : structuredClone(d));
    },
  };
}
