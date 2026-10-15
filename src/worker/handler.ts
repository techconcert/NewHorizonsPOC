import type { Command } from '../shared/commands';
import type { CommandReply, FromWorker, ToWorker } from '../shared/messages';
import { createSnapshot, isDetached, snapshotBuffers, type Snapshot } from '../shared/snapshot';
import {
  applyCommandsNow,
  advanceReal,
  createAccumulator,
  type StepAccumulator,
} from '../sim/tick';
import { createSave, loadSave } from '../sim/save';
import { submit, createWorld, type World } from '../sim/world';
import { fillSnapshot } from './fill';

/** The slice of a worker global the handler needs; tests pass a plain object. */
export interface WorkerPort {
  postMessage(msg: FromWorker, transfer: Transferable[]): void;
}

/** Snapshots are posted at most this often (20 per second). */
export const MIN_SNAPSHOT_INTERVAL_MS = 50;
/** Snapshots in flight: one being drawn on main while the worker fills the other. */
export const SNAPSHOT_POOL_SIZE = 2;

/** commandResult id used for replies to setSpeed messages. */
export const SET_SPEED_REPLY_ID = 0;

function assertNever(msg: never): void {
  // Exhaustiveness check at compile time; at runtime ignore, never throw or post.
  void msg;
}

export interface WorkerHandler {
  onMessage(msg: ToWorker): void;
  /** Advance the sim by real time since the last call and post a snapshot if due. */
  pump(): void;
  /** The live world, or null before init. For tests and debug tooling; never mutate from UI. */
  getWorld(): World | null;
}

/**
 * Worker logic without a real Worker. `clock` returns real milliseconds (performance.now in
 * the worker); the sim itself never reads time.
 */
export function createHandler(port: WorkerPort, clock: () => number): WorkerHandler {
  let world: World | null = null;
  let acc: StepAccumulator = createAccumulator();
  let lastPumpMs = 0;
  let lastPostMs = -Infinity;
  let dirty = false;
  let tickMs = 0;
  const free: Snapshot[] = [];
  let created = 0;
  /** World generation (D-107): requests for another generation are refused. */
  let gen = 0;
  /** Set when the sim threw (D-107): the game is stopped for good; only init or a good load clears it. */
  let failed = false;

  /** Stop the game after a sim error: speed 0, tell main once. The world is not touched further. */
  function fail(err: unknown): void {
    if (failed) return;
    failed = true;
    if (world) world.stores.run.speed[0] = 0;
    const why = err instanceof Error ? err.message : String(err);
    port.postMessage(
      { kind: 'error', message: `The simulation stopped after an error: ${why}. Reload the page.` },
      [],
    );
  }

  function takeSnapshot(): Snapshot | null {
    while (free.length > 0) {
      const s = free.pop() as Snapshot;
      if (!isDetached(s)) return s;
      created--; // a detached snapshot is lost; allow a replacement
    }
    if (created < SNAPSHOT_POOL_SIZE) {
      created++;
      return createSnapshot();
    }
    return null;
  }

  function maybePost(now: number): void {
    if (!world || failed || !dirty || now - lastPostMs < MIN_SNAPSHOT_INTERVAL_MS) return;
    const s = takeSnapshot();
    if (!s) return; // main has not returned a buffer yet; stay dirty and retry
    fillSnapshot(world, s, tickMs);
    dirty = false;
    lastPostMs = now;
    port.postMessage({ kind: 'snapshot', snapshot: s }, snapshotBuffers(s));
  }

  function submitCommand(cmd: unknown): CommandReply {
    if (!world) return { ok: false, reason: 'NOT_INITIALIZED' };
    if (failed) return { ok: false, reason: 'WORKER_FAILED' };
    let res: CommandReply;
    try {
      res = submit(world, cmd);
    } catch (err) {
      fail(err);
      return { ok: false, reason: 'WORKER_FAILED' };
    }
    if (res.ok) {
      dirty = true;
      // Speed changes, launches, reroutes, card choices and the four planetfall commands (so the reply and the next snapshot already show the ship and the
      // spent stockpile, and a second launch is checked against it) and any command while paused
      // apply now, at the current day. Replay-safe: logged at this day (D-036, D-041).
      const c = cmd as Command;
      if (
        c.type === 'SetGameSpeed' ||
        c.type === 'LaunchShip' ||
        c.type === 'RerouteShip' ||
        c.type === 'ResolveEventChoice' ||
        c.type === 'FormExpedition' ||
        c.type === 'ExploreRegion' ||
        c.type === 'FoundColony' ||
        c.type === 'ReEmbark' ||
        c.type === 'SetColonyStance' ||
        c.type === 'BuildDistrict' ||
        c.type === 'BuildSpaceport' ||
        c.type === 'ChooseTech' ||
        world.stores.run.speed[0] === 0
      ) {
        try {
          applyCommandsNow(world);
        } catch (err) {
          fail(err);
          return { ok: false, reason: 'WORKER_FAILED' };
        }
      }
    }
    return res;
  }

  return {
    onMessage(msg) {
      switch (msg.kind) {
        case 'init':
          gen = msg.gen;
          failed = false;
          world = createWorld(msg.seed);
          acc = createAccumulator();
          lastPumpMs = clock();
          lastPostMs = -Infinity;
          tickMs = 0;
          dirty = true;
          maybePost(lastPumpMs);
          break;
        case 'command':
          port.postMessage(
            {
              kind: 'commandResult',
              id: msg.id,
              gen: msg.gen,
              result:
                msg.gen === gen || world === null
                  ? submitCommand(msg.command)
                  : { ok: false, reason: 'STALE_WORLD' },
            },
            [],
          );
          maybePost(clock());
          break;
        case 'setSpeed':
          // Speed changes carry no id; their reply uses the reserved id 0.
          port.postMessage(
            {
              kind: 'commandResult',
              id: SET_SPEED_REPLY_ID,
              gen: msg.gen,
              result:
                msg.gen === gen || world === null
                  ? submitCommand({ type: 'SetGameSpeed', speed: msg.speed })
                  : { ok: false, reason: 'STALE_WORLD' },
            },
            [],
          );
          maybePost(clock());
          break;
        case 'save':
          if (world === null || msg.gen !== gen) {
            port.postMessage(
              { kind: 'saved', id: msg.id, gen: msg.gen, ok: false, error: 'No game to save.' },
              [],
            );
          } else if (failed) {
            port.postMessage(
              {
                kind: 'saved',
                id: msg.id,
                gen: msg.gen,
                ok: false,
                error: 'The simulation stopped after an error, so the game cannot be saved.',
              },
              [],
            );
          } else {
            try {
              const data = createSave(world);
              port.postMessage({ kind: 'saved', id: msg.id, gen: msg.gen, ok: true, data }, []);
              dirty = true;
            } catch (err) {
              fail(err);
              port.postMessage(
                {
                  kind: 'saved',
                  id: msg.id,
                  gen: msg.gen,
                  ok: false,
                  error: 'The game could not be saved.',
                },
                [],
              );
            }
          }
          break;
        case 'load':
          try {
            const loaded = loadSave(msg.data);
            world = loaded;
            gen = msg.gen;
            failed = false;
            acc = createAccumulator();
            lastPumpMs = clock();
            lastPostMs = -Infinity;
            tickMs = 0;
            dirty = true;
            port.postMessage(
              { kind: 'loadResult', id: msg.id, gen: msg.gen, ok: true, error: '' },
              [],
            );
            maybePost(lastPumpMs);
          } catch (err) {
            // The running game is untouched: loadSave builds a separate world and only returns on success.
            const why = err instanceof Error ? err.message : 'The save could not be loaded.';
            port.postMessage(
              { kind: 'loadResult', id: msg.id, gen: msg.gen, ok: false, error: why },
              [],
            );
          }
          break;
        case 'returnBuffers':
          if (isDetached(msg.snapshot))
            created--; // lost buffers: allow a replacement
          else free.push(msg.snapshot);
          break;
        default:
          assertNever(msg); // unknown kinds from outside are ignored at runtime
      }
    },
    getWorld() {
      return world;
    },
    pump() {
      if (!world || failed) return;
      const now = clock();
      const dt = now - lastPumpMs;
      lastPumpMs = now;
      let days: number;
      try {
        days = advanceReal(world, acc, dt);
      } catch (err) {
        fail(err);
        return;
      }
      if (days > 0) {
        tickMs = (clock() - now) / days;
        dirty = true;
      }
      maybePost(now);
    },
  };
}
