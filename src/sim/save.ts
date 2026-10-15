import { contentHash } from '../data';
import { SAVE_VERSION, SIM_VERSION, type SaveData } from '../shared/save';
import { COMMAND_LOG_CAPACITY, COMMAND_MAX_ARGS, G_LOG, HOMEWORLD_CLOCK_DAYS } from './components';
import { replayLogEntry, TYPE_CODE } from './commands';
import { tickDay, applyCommandsNow } from './tick';
import { createWorld, type World } from './world';

/**
 * Save and load (M5, D-099). A save is the seed, the command log and the state hash; a load
 * replays the log on a fresh world and fails loudly if the hash differs. Nothing here reads a clock.
 */

/**
 * Snapshot the run for storage. Commands still waiting in the queue are applied first (they would
 * be the first thing the next tick does at this same day), so the log holds everything and the
 * hash is current.
 */
export function createSave(w: World): SaveData {
  applyCommandsNow(w);
  const s = w.stores;
  const n = s.counts[G_LOG];
  return {
    version: SAVE_VERSION,
    simVersion: SIM_VERSION,
    seed: w.seed,
    day: s.run.day[0],
    contentHash: contentHash(),
    stateHash: s.run.stateHash[0],
    logDay: s.log.day.slice(0, n),
    logType: s.log.type.slice(0, n),
    logArgs: s.log.args.slice(0, n * COMMAND_MAX_ARGS),
  };
}

/** A run ends at the latest when the homeworld clock runs out; saves a little past that are tolerated. */
export const SAVE_MAX_DAY = HOMEWORLD_CLOCK_DAYS + 30;

const VALID_TYPES = new Set<number>(Object.values(TYPE_CODE));

/** Why a save cannot be loaded, or null. Checks the shape only; the hash check happens in loadSave. */
export function saveProblem(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'The save is not readable.';
  const d = data as Partial<SaveData>;
  if (d.version !== SAVE_VERSION) return 'The save is from a different version of the game.';
  if (Number.isInteger(d.simVersion) && d.simVersion !== SIM_VERSION)
    return `The save was made with simulation version ${d.simVersion}, but this game runs version ${SIM_VERSION}. The rules changed, so it cannot be replayed. Start a new game.`;
  if (
    !Number.isInteger(d.simVersion) ||
    !Number.isInteger(d.seed) ||
    !Number.isInteger(d.day) ||
    !Number.isInteger(d.stateHash) ||
    !Number.isInteger(d.contentHash)
  )
    return 'The save is damaged (header).';
  if (d.contentHash !== contentHash())
    return 'The save was saved with different game data (the game content has changed since).';
  if (
    !(d.logDay instanceof Int32Array) ||
    !(d.logType instanceof Uint8Array) ||
    !(d.logArgs instanceof Int32Array)
  )
    return 'The save is damaged (log).';
  const n = d.logDay.length;
  if (
    d.logType.length !== n ||
    d.logArgs.length !== n * COMMAND_MAX_ARGS ||
    n > COMMAND_LOG_CAPACITY
  )
    return 'The save is damaged (log size).';
  const day = d.day as number;
  // A huge day would make the replay run for ages and hang the worker.
  if (day < 0 || day > SAVE_MAX_DAY) return 'The save is damaged (day).';
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = d.logDay[i];
    if (t < prev || t > day) return 'The save is damaged (log order).';
    if (!VALID_TYPES.has(d.logType[i])) return 'The save is damaged (command type).';
    prev = t;
  }
  return null;
}

/**
 * Rebuild the world of a save: new world from the seed, then for each day apply that day's log
 * entries and run the day, then the entries of the save day. Throws an Error with a player-readable
 * message when the save is damaged or does not reproduce its hash.
 */
export function loadSave(data: SaveData): World {
  const problem = saveProblem(data);
  if (problem !== null) throw new Error(problem);
  const w = createWorld(data.seed);
  const n = data.logDay.length;
  const log = { day: data.logDay, type: data.logType, args: data.logArgs };
  let i = 0;
  for (let day = 0; day <= data.day; day++) {
    while (i < n && data.logDay[i] === day) {
      replayLogEntry(w, log, i);
      i++;
    }
    if (day < data.day) tickDay(w);
  }
  if (w.stores.run.stateHash[0] !== data.stateHash) {
    throw new Error('The save does not replay to the same game (hash mismatch).');
  }
  return w;
}
