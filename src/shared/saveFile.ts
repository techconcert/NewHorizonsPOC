import { SAVE_VERSION, SIM_VERSION, type SaveData } from './save';

/**
 * Save file export and import (M8, D-148). The file is the same data as the IndexedDB save (seed,
 * command log, state hash), written as JSON with plain arrays. Import checks the shape here with
 * clear messages; the worker's `loadSave` then replays the log and checks the state hash, so a
 * file that was edited by hand or made by other rules is refused before it can change the game.
 */

export const SAVE_FILE_FORMAT = 'colony-ship-save';
export const SAVE_FILE_VERSION = 1;
/** A real save is a few tens of KB; anything past this is not one. */
export const SAVE_FILE_MAX_BYTES = 4 * 1024 * 1024;
/** Mirrors COMMAND_LOG_CAPACITY and COMMAND_MAX_ARGS in src/sim/components.ts (a test checks it). */
export const SAVE_FILE_MAX_ENTRIES = 8192;
export const SAVE_FILE_ARGS = 9;
/** Far above any real game day; the sim applies its own, tighter limit. */
const MAX_DAY = 100000;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

export type SaveFileResult = { ok: true; data: SaveData } | { ok: false; error: string };

/** The text to write to disk. */
export function exportSaveText(data: SaveData): string {
  return JSON.stringify({
    format: SAVE_FILE_FORMAT,
    fileVersion: SAVE_FILE_VERSION,
    version: data.version,
    simVersion: data.simVersion,
    seed: data.seed,
    day: data.day,
    contentHash: data.contentHash,
    stateHash: data.stateHash,
    log: {
      day: Array.from(data.logDay),
      type: Array.from(data.logType),
      args: Array.from(data.logArgs),
    },
  });
}

/** "colony-ship-seed42-day120.json" */
export function saveFileName(data: SaveData): string {
  return `colony-ship-seed${data.seed}-day${data.day}.json`;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function intArray(v: unknown, lo: number, hi: number): number[] | null {
  if (!Array.isArray(v)) return null;
  for (let i = 0; i < v.length; i++) {
    const x: unknown = v[i];
    if (!isInt(x) || x < lo || x > hi) return null;
  }
  return v as number[];
}

/** Check a file's text and turn it into SaveData, or say in plain words what is wrong. */
export function parseSaveFile(text: string): SaveFileResult {
  const fail = (error: string): SaveFileResult => ({ ok: false, error });
  if (text.trim() === '') return fail('The file is empty.');
  if (text.length > SAVE_FILE_MAX_BYTES) {
    return fail(
      `The file is too large to be a save (over ${SAVE_FILE_MAX_BYTES / (1024 * 1024)} MB).`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('The file is not valid JSON, so it is not a Colony Ship save.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('The file is not a Colony Ship save (it does not hold a save object).');
  }
  const d = raw as Record<string, unknown>;
  if (d.format !== SAVE_FILE_FORMAT) {
    return fail('The file is not a Colony Ship save (the format marker is missing or different).');
  }
  if (d.fileVersion !== SAVE_FILE_VERSION) {
    return fail(
      `The file uses file format version ${String(d.fileVersion)}, but this game reads version ${SAVE_FILE_VERSION}.`,
    );
  }
  if (d.version !== SAVE_VERSION) {
    return fail(
      `The save is from a different version of the game (save format ${String(d.version)}, this game reads ${SAVE_VERSION}).`,
    );
  }
  if (isInt(d.simVersion) && d.simVersion !== SIM_VERSION) {
    return fail(
      `The save was made with simulation version ${d.simVersion}, but this game runs version ${SIM_VERSION}. The rules changed, so it cannot be replayed. Start a new game.`,
    );
  }
  if (!isInt(d.simVersion)) return fail('The save file is damaged (simulation version).');
  if (!isInt(d.seed)) return fail('The save file is damaged (seed).');
  if (!isInt(d.day) || d.day < 0 || d.day > MAX_DAY) return fail('The save file is damaged (day).');
  if (!isInt(d.contentHash) || !isInt(d.stateHash))
    return fail('The save file is damaged (hashes).');
  const log = d.log;
  if (typeof log !== 'object' || log === null)
    return fail('The save file is damaged (command log missing).');
  const l = log as Record<string, unknown>;
  // Check the lengths before intArray scans the arrays (a huge damaged file must not cost a full scan).
  if (Array.isArray(l.day) && l.day.length > SAVE_FILE_MAX_ENTRIES)
    return fail('The save file is damaged (command log too long).');
  if (Array.isArray(l.type) && l.type.length > SAVE_FILE_MAX_ENTRIES)
    return fail('The save file is damaged (command log too long).');
  if (Array.isArray(l.args) && l.args.length > SAVE_FILE_MAX_ENTRIES * SAVE_FILE_ARGS)
    return fail('The save file is damaged (command log too long).');
  const logDay = intArray(l.day, 0, MAX_DAY);
  const logType = intArray(l.type, 0, 255);
  const logArgs = intArray(l.args, INT32_MIN, INT32_MAX);
  if (logDay === null || logType === null || logArgs === null) {
    return fail('The save file is damaged (command log entries).');
  }
  const n = logDay.length;
  if (logType.length !== n || logArgs.length !== n * SAVE_FILE_ARGS) {
    return fail('The save file is damaged (command log sizes do not match).');
  }
  if (n > SAVE_FILE_MAX_ENTRIES) return fail('The save file is damaged (command log too long).');
  let prev = 0;
  for (let i = 0; i < n; i++) {
    if (logDay[i] < prev || logDay[i] > d.day)
      return fail('The save file is damaged (command log order).');
    prev = logDay[i];
  }
  return {
    ok: true,
    data: {
      version: d.version,
      simVersion: d.simVersion,
      seed: d.seed,
      day: d.day,
      contentHash: d.contentHash,
      stateHash: d.stateHash,
      logDay: Int32Array.from(logDay),
      logType: Uint8Array.from(logType),
      logArgs: Int32Array.from(logArgs),
    },
  };
}
