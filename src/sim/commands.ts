import type { Command, CommandResult, RejectReason } from '../shared/commands';
import {
  COMMAND_LOG_CAPACITY,
  COMMAND_MAX_ARGS,
  COMMAND_QUEUE_CAPACITY,
  G_LOG,
  RunOutcome,
  type Stores,
} from './components';
import {
  applyBuildDistrict,
  applyBuildSpaceport,
  applySetStance,
  checkBuildDistrict,
  checkBuildSpaceport,
  checkSetStance,
} from './colony';
import { applyChooseTech, checkChooseTech } from './research';
import { applyResolve, applySpeedCommand, checkResolve, pendingCount } from './events';
import {
  applyExplore,
  applyForm,
  applyFound,
  applyReEmbark,
  checkExplore,
  checkForm,
  checkFound,
  checkReEmbark,
} from './expedition';
import { hashState } from './hash';
import { applyLaunch, checkLaunch } from './launch';
import { applyReroute, checkReroute } from './reroute';
import type { World } from './world';

/** Ring buffer of validated commands awaiting the next tick, plus the append-only log. */
export interface CommandQueue {
  items: (Command | null)[];
  head: number;
  count: number;
}

export function createCommandQueue(): CommandQueue {
  return {
    items: new Array<Command | null>(COMMAND_QUEUE_CAPACITY).fill(null),
    head: 0,
    count: 0,
  };
}

/**
 * Log slots kept free for speed commands: every other command is refused with LOG_FULL this early,
 * so pausing still works when the log is nearly full (D-108).
 */
export const SPEED_LOG_RESERVE = 64;

const ACCEPT: CommandResult = { ok: true };
const reject = (reason: RejectReason): CommandResult => ({ ok: false, reason });
export const REJECTS: Record<RejectReason, CommandResult> = {
  UNKNOWN_COMMAND: reject('UNKNOWN_COMMAND'),
  INVALID_SHAPE: reject('INVALID_SHAPE'),
  INVALID_SPEED: reject('INVALID_SPEED'),
  NOT_IMPLEMENTED_YET: reject('NOT_IMPLEMENTED_YET'),
  QUEUE_FULL: reject('QUEUE_FULL'),
  LOG_FULL: reject('LOG_FULL'),
  NO_SUCH_COLONY: reject('NO_SUCH_COLONY'),
  NO_SPACEPORT: reject('NO_SPACEPORT'),
  INVALID_TARGET: reject('INVALID_TARGET'),
  INVALID_HULL: reject('INVALID_HULL'),
  INVALID_SPEED_SETTING: reject('INVALID_SPEED_SETTING'),
  INVALID_LOADOUT: reject('INVALID_LOADOUT'),
  OVER_CAPACITY: reject('OVER_CAPACITY'),
  NO_PASSENGERS: reject('NO_PASSENGERS'),
  OUT_OF_RANGE: reject('OUT_OF_RANGE'),
  INSUFFICIENT_PASSENGERS: reject('INSUFFICIENT_PASSENGERS'),
  INSUFFICIENT_SUPPLIES: reject('INSUFFICIENT_SUPPLIES'),
  INSUFFICIENT_FUEL: reject('INSUFFICIENT_FUEL'),
  INSUFFICIENT_PRODUCTION: reject('INSUFFICIENT_PRODUCTION'),
  SHIP_LIMIT: reject('SHIP_LIMIT'),
  ENTITY_LIMIT: reject('ENTITY_LIMIT'),
  NO_SUCH_SHIP: reject('NO_SUCH_SHIP'),
  SHIP_LOST: reject('SHIP_LOST'),
  SHIP_DRIFTING: reject('SHIP_DRIFTING'),
  EVENT_PENDING: reject('EVENT_PENDING'),
  SHIP_NOT_IN_TRANSIT: reject('SHIP_NOT_IN_TRANSIT'),
  EXPEDITION_ACTIVE: reject('EXPEDITION_ACTIVE'),
  SAME_TARGET: reject('SAME_TARGET'),
  NO_PENDING_EVENT: reject('NO_PENDING_EVENT'),
  INVALID_CHOICE: reject('INVALID_CHOICE'),
  SHIP_NOT_ARRIVED: reject('SHIP_NOT_ARRIVED'),
  PLANET_OWNED: reject('PLANET_OWNED'),
  EXPEDITION_EXISTS: reject('EXPEDITION_EXISTS'),
  EXPEDITION_LIMIT: reject('EXPEDITION_LIMIT'),
  INVALID_STANCE: reject('INVALID_STANCE'),
  INVALID_EXPEDITION: reject('INVALID_EXPEDITION'),
  NO_EXPLORERS: reject('NO_EXPLORERS'),
  INSUFFICIENT_COLONISTS: reject('INSUFFICIENT_COLONISTS'),
  INSUFFICIENT_SECURITY: reject('INSUFFICIENT_SECURITY'),
  INSUFFICIENT_KIT: reject('INSUFFICIENT_KIT'),
  NO_SUCH_EXPEDITION: reject('NO_SUCH_EXPEDITION'),
  EXPEDITION_NOT_ACTIVE: reject('EXPEDITION_NOT_ACTIVE'),
  ROUND_IN_PROGRESS: reject('ROUND_IN_PROGRESS'),
  INVALID_REGION: reject('INVALID_REGION'),
  ALREADY_EXPLORED: reject('ALREADY_EXPLORED'),
  NOT_ADJACENT: reject('NOT_ADJACENT'),
  INVALID_SPLIT: reject('INVALID_SPLIT'),
  REGION_NOT_EXPLORED: reject('REGION_NOT_EXPLORED'),
  INVALID_DISTRICT: reject('INVALID_DISTRICT'),
  SPACEPORT_EXISTS: reject('SPACEPORT_EXISTS'),
  DISTRICT_EXISTS: reject('DISTRICT_EXISTS'),
  NATIVE_REGION: reject('NATIVE_REGION'),
  INVALID_TECH: reject('INVALID_TECH'),
  TECH_KNOWN: reject('TECH_KNOWN'),
  TECH_LOCKED: reject('TECH_LOCKED'),
  GAME_ENDED: reject('GAME_ENDED'),
};

/** Required integer fields per command type; also gives each type a stable numeric code. */
export const COMMAND_FIELDS: Record<string, readonly string[]> = {
  LaunchShip: [
    'colony',
    'target',
    'hull',
    'passengers',
    'supplies',
    'fuel',
    'speed',
    'kit',
    'security',
  ],
  RerouteShip: ['ship', 'target'],
  FormExpedition: ['ship', 'explorers', 'guards', 'supplies', 'kit', 'stance'],
  ExploreRegion: ['expedition', 'region', 'region2'],
  FoundColony: ['expedition', 'region'],
  ReEmbark: ['expedition'],
  SetColonyStance: ['colony', 'stance'],
  BuildDistrict: ['colony', 'region', 'district'],
  BuildSpaceport: ['colony', 'region'],
  ChooseTech: ['tech'],
  SetGameSpeed: ['speed'],
  ResolveEventChoice: ['card', 'choice', 'ship'],
};

export const TYPE_CODE: Record<string, number> = {
  LaunchShip: 1,
  RerouteShip: 2,
  FormExpedition: 3,
  ExploreRegion: 4,
  FoundColony: 5,
  ReEmbark: 6,
  SetColonyStance: 7,
  BuildDistrict: 8,
  ChooseTech: 9,
  SetGameSpeed: 10,
  ResolveEventChoice: 11,
  BuildSpaceport: 12,
};

/** Shape-only validation (pure, no world needed). State checks happen in submitCommand. */
export function validateCommand(cmd: unknown): CommandResult {
  if (typeof cmd !== 'object' || cmd === null) return REJECTS.UNKNOWN_COMMAND;
  const rec = cmd as Record<string, unknown>;
  const type = rec.type;
  if (typeof type !== 'string' || !Object.hasOwn(COMMAND_FIELDS, type)) {
    return REJECTS.UNKNOWN_COMMAND;
  }
  const fields = COMMAND_FIELDS[type];
  for (let i = 0; i < fields.length; i++) {
    if (!Number.isInteger(rec[fields[i] as string])) return REJECTS.INVALID_SHAPE;
  }
  if (type === 'SetGameSpeed') {
    const sp = rec.speed;
    return sp === 0 || sp === 1 || sp === 2 || sp === 4 ? ACCEPT : REJECTS.INVALID_SPEED;
  }
  if (
    type === 'LaunchShip' ||
    type === 'RerouteShip' ||
    type === 'ResolveEventChoice' ||
    type === 'FormExpedition' ||
    type === 'ExploreRegion' ||
    type === 'FoundColony' ||
    type === 'ReEmbark' ||
    type === 'SetColonyStance' ||
    type === 'BuildDistrict' ||
    type === 'BuildSpaceport' ||
    type === 'ChooseTech'
  )
    return ACCEPT;
  return REJECTS.NOT_IMPLEMENTED_YET;
}

/**
 * Validate (shape, then current state for LaunchShip) and, if accepted, enqueue for the start of
 * the next tick. A rejection carries a specific reason code.
 */
export function submitCommand(w: World, cmd: unknown): CommandResult {
  const q = w.queue;
  const s = w.stores;
  const res = validateCommand(cmd);
  if (!res.ok) return res;
  if (s.run.outcome[0] !== RunOutcome.Running) return REJECTS.GAME_ENDED;
  if (q.count >= COMMAND_QUEUE_CAPACITY) return REJECTS.QUEUE_FULL;
  const isSpeed = (cmd as Command).type === 'SetGameSpeed';
  // Speed commands never meet LOG_FULL (D-108); the others stop short of the reserve.
  if (!isSpeed && s.counts[G_LOG] + q.count >= COMMAND_LOG_CAPACITY - SPEED_LOG_RESERVE)
    return REJECTS.LOG_FULL;
  // A command that changes nothing is accepted but neither queued nor logged (D-108).
  if (q.count === 0 && isNoOp(w, cmd as Command)) return res;
  if ((cmd as Command).type === 'LaunchShip') {
    const why = checkLaunch(w, cmd as Extract<Command, { type: 'LaunchShip' }>);
    if (why !== null) return REJECTS[why];
  } else if ((cmd as Command).type === 'RerouteShip') {
    const why = checkReroute(w, cmd as Extract<Command, { type: 'RerouteShip' }>);
    if (why !== null) return REJECTS[why];
  } else if ((cmd as Command).type === 'ResolveEventChoice') {
    const why = checkResolve(w, cmd as Extract<Command, { type: 'ResolveEventChoice' }>);
    if (why !== null) return REJECTS[why];
  } else {
    const why = checkPlanetfall(w, cmd as Command);
    if (why !== null) return REJECTS[why];
  }
  q.items[(q.head + q.count) % COMMAND_QUEUE_CAPACITY] = cmd as Command;
  q.count++;
  return res;
}

/** True when applying `cmd` now would change nothing: the speed already set, the tech already under way. */
function isNoOp(w: World, cmd: Command): boolean {
  // With a card pending the speed command also sets the speed to resume to (D-055): never a no-op.
  if (cmd.type === 'SetGameSpeed')
    return cmd.speed === w.stores.run.speed[0] && pendingCount(w) === 0;
  if (cmd.type === 'ChooseTech')
    return w.stores.research.current[0] === cmd.tech && checkChooseTech(w, cmd) === null;
  return false;
}

/** State check of the planetfall and colony commands (null for every other command type). */
function checkPlanetfall(w: World, cmd: Command): RejectReason | null {
  switch (cmd.type) {
    case 'SetColonyStance':
      return checkSetStance(w, cmd);
    case 'BuildDistrict':
      return checkBuildDistrict(w, cmd);
    case 'BuildSpaceport':
      return checkBuildSpaceport(w, cmd);
    case 'ChooseTech':
      return checkChooseTech(w, cmd);
    case 'FormExpedition':
      return checkForm(w, cmd);
    case 'ExploreRegion':
      return checkExplore(w, cmd);
    case 'FoundColony':
      return checkFound(w, cmd);
    case 'ReEmbark':
      return checkReEmbark(w, cmd);
    default:
      return null;
  }
}

/** Apply every queued command (oldest first) and append it to the log. No allocation. */
export function applyQueuedCommands(w: World): void {
  const q = w.queue;
  const s = w.stores;
  while (q.count > 0) {
    const cmd = q.items[q.head];
    if (cmd === null || cmd === undefined) {
      throw new Error(`command queue invariant violated: null item at head ${q.head}`);
    }
    q.items[q.head] = null;
    q.head = (q.head + 1) % COMMAND_QUEUE_CAPACITY;
    q.count--;

    logCommand(s, cmd);
    applyCommandEffect(w, cmd);
  }
}

/** Append the serializable log entry: day, type code and integer args in typed arrays. */
function logCommand(s: Stores, cmd: Command): void {
  const n = s.counts[G_LOG];
  if (cmd.type === 'SetGameSpeed') {
    // Consecutive speed changes on one day collapse into one entry holding the last value (D-108).
    if (
      n > 0 &&
      s.log.type[n - 1] === TYPE_CODE.SetGameSpeed &&
      s.log.day[n - 1] === s.run.day[0]
    ) {
      s.log.args[(n - 1) * COMMAND_MAX_ARGS] = cmd.speed;
      return;
    }
    if (n >= COMMAND_LOG_CAPACITY) return; // full: the speed still applies, it just is not logged
  }
  s.log.day[n] = s.run.day[0];
  s.log.type[n] = TYPE_CODE[cmd.type];
  const fields = COMMAND_FIELDS[cmd.type];
  const rec = cmd as unknown as Record<string, number>;
  for (let i = 0; i < fields.length; i++) s.log.args[n * COMMAND_MAX_ARGS + i] = rec[fields[i]];
  s.counts[G_LOG] = n + 1;
}

/**
 * The state change of an accepted command. LaunchShip, RerouteShip and ResolveEventChoice
 * re-check the world themselves (D-041, D-052). SetGameSpeed keeps the game paused while an
 * event card is pending (D-055).
 */
function applyCommandEffect(w: World, cmd: Command): void {
  if (cmd.type === 'SetGameSpeed') applySpeedCommand(w, cmd.speed);
  else if (cmd.type === 'LaunchShip') applyLaunch(w, cmd);
  else if (cmd.type === 'RerouteShip') applyReroute(w, cmd);
  else if (cmd.type === 'ResolveEventChoice') applyResolve(w, cmd);
  else if (cmd.type === 'FormExpedition') applyForm(w, cmd);
  else if (cmd.type === 'ExploreRegion') applyExplore(w, cmd);
  else if (cmd.type === 'FoundColony') applyFound(w, cmd);
  else if (cmd.type === 'ReEmbark') applyReEmbark(w, cmd);
  else if (cmd.type === 'SetColonyStance') applySetStance(w, cmd);
  else if (cmd.type === 'BuildDistrict') applyBuildDistrict(w, cmd);
  else if (cmd.type === 'BuildSpaceport') applyBuildSpaceport(w, cmd);
  else if (cmd.type === 'ChooseTech') applyChooseTech(w, cmd);
}

/**
 * Raw replay of log entry `index` of `source` (a recorded run's stores): no shape or state
 * validation, no queue. It writes the same log entry (the log is part of the state hash) and
 * applies the same effect the live worker produced, then refreshes the hash. The world must be
 * on the entry's logged day (call it before that day's tick, as the live path did). A launch the
 * live run dropped at apply time is dropped here too, because the same apply-time check runs.
 */
export function replayLogged(w: World, source: Stores, index: number): void {
  if (w.stores.run.day[0] !== source.log.day[index]) {
    throw new Error(
      `replayLogged: entry ${index} is for day ${source.log.day[index]}, world is on day ${w.stores.run.day[0]}`,
    );
  }
  const cmd = getLoggedCommand(source, index);
  logCommand(w.stores, cmd);
  applyCommandEffect(w, cmd);
  hashState(w.stores);
}

/** The three typed arrays of a command log (a world's `stores.log`, or a saved copy). */
export interface LogView {
  day: Int32Array;
  type: Uint8Array;
  args: Int32Array;
}

/** Rebuild entry `index` of a log view as a plain command object (allocates; for replay and saves). */
export function commandFromLog(log: LogView, index: number): Command {
  const type = TYPE_NAMES[log.type[index]] as string;
  const fields = COMMAND_FIELDS[type] as readonly string[];
  const out: Record<string, unknown> = { type };
  for (let i = 0; i < fields.length; i++) {
    out[fields[i] as string] = log.args[index * COMMAND_MAX_ARGS + i];
  }
  return out as unknown as Command;
}

/** Rebuild log entry `index` as a plain command object (allocates; for replay and saves). */
export function getLoggedCommand(s: Stores, index: number): Command {
  return commandFromLog(s.log, index);
}

/**
 * Raw replay of entry `index` of a saved log view: like replayLogged, but the source is plain
 * arrays (a save file), not a world. The world must be on the entry's day.
 */
export function replayLogEntry(w: World, log: LogView, index: number): void {
  if (w.stores.run.day[0] !== log.day[index]) {
    throw new Error(
      `replayLogEntry: entry ${index} is for day ${log.day[index]}, world is on day ${w.stores.run.day[0]}`,
    );
  }
  const cmd = commandFromLog(log, index);
  logCommand(w.stores, cmd);
  applyCommandEffect(w, cmd);
  hashState(w.stores);
}

const TYPE_NAMES: string[] = [];
for (const k of Object.keys(TYPE_CODE)) TYPE_NAMES[TYPE_CODE[k] as number] = k;
