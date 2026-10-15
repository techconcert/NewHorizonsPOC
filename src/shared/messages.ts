import type { Command, CommandResult, GameSpeed } from './commands';
import type { SaveData } from './save';
import type { Snapshot } from './snapshot';

export type { Command, Snapshot };

/**
 * Reply reasons that come from the worker, not the sim: a command before Init, a command made for
 * an older world (new game or load happened in between: D-107), or a worker that stopped after an error.
 */
export type WorkerReject = 'NOT_INITIALIZED' | 'STALE_WORLD' | 'WORKER_FAILED';

export type CommandReply = CommandResult | { ok: false; reason: WorkerReject };

/**
 * World generation (D-107): main numbers every world it asks for (init, load); commands, saves and
 * speed changes carry the generation they were made for and every reply echoes it. The worker
 * refuses a request made for another generation and main drops a reply that is not for the current one.
 */

/** Main thread to worker. */
export type ToWorker =
  | { kind: 'init'; seed: number; gen: number }
  | { kind: 'command'; id: number; gen: number; command: Command }
  | { kind: 'setSpeed'; gen: number; speed: GameSpeed }
  /** Ask for the save data of the running game; answered with `saved` (M5, D-099). */
  | { kind: 'save'; id: number; gen: number }
  /** Replace the running game with a saved one; answered with `loadResult`. */
  | { kind: 'load'; id: number; gen: number; data: SaveData }
  /** Hands a consumed snapshot's buffers back to the worker for reuse (ping-pong). */
  | { kind: 'returnBuffers'; snapshot: Snapshot };

/** Worker to main thread. */
export type FromWorker =
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'commandResult'; id: number; gen: number; result: CommandReply }
  | { kind: 'saved'; id: number; gen: number; ok: true; data: SaveData }
  | { kind: 'saved'; id: number; gen: number; ok: false; error: string }
  | { kind: 'loadResult'; id: number; gen: number; ok: boolean; error: string }
  /** The sim threw while running: the worker has stopped the game (speed 0) and refuses further commands. */
  | { kind: 'error'; message: string };
