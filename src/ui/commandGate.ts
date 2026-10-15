import { describeReject } from './missionModel';

/**
 * Double-send guard for commands the player confirms with a button (reroute, event choice).
 * Like the LaunchGate (D-047) the button stays off after a send, and it comes back on a rejection
 * or on the first snapshot that arrives after the accepted reply (the worker applies these
 * commands at once and posts snapshots in order, so that snapshot already shows the result).
 * A snapshot that was posted before the command and reaches the UI first does not unlock it.
 */
export interface CommandGate {
  awaiting: boolean;
  /** The accepted reply has arrived; the next snapshot unlocks. */
  replied: boolean;
}

export function createCommandGate(): CommandGate {
  return { awaiting: false, replied: false };
}

/** Try to send. Returns false (and changes nothing) when a send is already in flight. */
export function gateSend(g: CommandGate): boolean {
  if (g.awaiting) return false;
  g.awaiting = true;
  g.replied = false;
  return true;
}

/** The worker answered. A rejection unlocks at once; an accepted reply waits for the next snapshot. */
export function gateReply(g: CommandGate, ok: boolean): void {
  if (!g.awaiting) return;
  if (ok) g.replied = true;
  else {
    g.awaiting = false;
    g.replied = false;
  }
}

/** A snapshot arrived. Returns true when this unlocked the gate. */
export function gateSnapshot(g: CommandGate): boolean {
  if (g.awaiting && g.replied) {
    g.awaiting = false;
    g.replied = false;
    return true;
  }
  return false;
}

// ---- Which kind of command a reply belongs to ---------------------------------------------

export type CommandKind =
  | 'launch'
  | 'reroute'
  | 'event'
  | 'speed'
  /** Planetfall (M4b): FormExpedition, ExploreRegion, FoundColony, ReEmbark. */
  | 'form'
  | 'explore'
  | 'found'
  | 'embark'
  /** Colony economy and research (M5): SetColonyStance, BuildDistrict / BuildSpaceport, ChooseTech. */
  | 'stance'
  | 'build'
  | 'tech';

/** Real milliseconds without a reply after which a command counts as lost. */
export const REPLY_TIMEOUT_MS = 5000;
export const NO_REPLY_TEXT = 'No reply from the simulation. Try again.';

export interface ExpiredCommand {
  id: number;
  kind: CommandKind;
}

export interface CommandTracker {
  /** Remember what command `id` was and when (real ms, from an injectable clock) it was sent. */
  track(id: number, kind: CommandKind, nowMs?: number): void;
  /** Forget and return the kind of `id`; id 0 (setSpeed replies) and unknown ids are 'speed'. */
  take(id: number): CommandKind;
  /** Forget and return every command sent more than `timeoutMs` before `nowMs`. */
  expire(nowMs: number, timeoutMs?: number): ExpiredCommand[];
  /** Forget and return everything still waiting (worker error or restart). */
  drain(): ExpiredCommand[];
}

export function createCommandTracker(): CommandTracker {
  const sent = new Map<number, { kind: CommandKind; at: number }>();
  const collect = (keep: (at: number) => boolean): ExpiredCommand[] => {
    const out: ExpiredCommand[] = [];
    for (const [id, c] of sent) if (!keep(c.at)) out.push({ id, kind: c.kind });
    for (const e of out) sent.delete(e.id);
    return out;
  };
  return {
    track(id, kind, nowMs = 0) {
      sent.set(id, { kind, at: nowMs });
    },
    take(id) {
      const c = sent.get(id);
      sent.delete(id);
      return c?.kind ?? 'speed';
    },
    expire(nowMs, timeoutMs = REPLY_TIMEOUT_MS) {
      return collect((at) => nowMs - at <= timeoutMs);
    },
    drain() {
      return collect(() => false);
    },
  };
}

// ---- Human text for rejected commands ------------------------------------------------------

/** Reroute-specific wording where the shared launch text would be wrong ("Launch refused"). */
const REROUTE_TEXT: Record<string, string> = {
  OUT_OF_RANGE:
    'Reroute refused: the ship cannot afford the course change and the new leg. The ship moves each day, so try again after the next day.',
  INVALID_TARGET: 'Reroute refused: that is not a valid target planet.',
  NO_SUCH_SHIP: 'Reroute refused: there is no such ship.',
  SHIP_LOST: 'Reroute refused: that ship is lost.',
  SHIP_DRIFTING: 'Reroute refused: a drifting ship has no fuel to change course.',
  EVENT_PENDING: "Reroute refused: resolve the ship's event card first.",
  SHIP_NOT_IN_TRANSIT: 'Reroute refused: the ship is not in flight.',
  EXPEDITION_ACTIVE: 'Reroute refused: bring the expedition back aboard first.',
  SAME_TARGET: 'Reroute refused: the ship is already flying there.',
};

const EVENT_TEXT: Record<string, string> = {
  NO_PENDING_EVENT: 'That event card was already answered.',
  INVALID_CHOICE: 'That choice does not exist on this card.',
};

/** Wording for the planetfall commands where the shared launch text would be wrong. */
const PLANETFALL_TEXT: Record<string, string> = {
  NO_SUCH_SHIP: 'there is no such ship.',
  SHIP_LOST: 'the ship was lost.',
  SHIP_NOT_ARRIVED: 'the ship is not in orbit at the planet.',
  PLANET_OWNED: 'a colony already holds this planet.',
  EXPEDITION_EXISTS: 'this ship already has an expedition out.',
  EXPEDITION_LIMIT: 'too many expeditions are out at once.',
  INSUFFICIENT_SUPPLIES: 'the ship does not carry that many supplies.',
  ENTITY_LIMIT: 'the world is full; no new expedition or colony can be created.',
  EVENT_PENDING: 'answer the event card first; the expedition stands still until you do.',
  ROUND_IN_PROGRESS: 'the expedition is still out on a round. Wait for it to finish.',
  EXPEDITION_NOT_ACTIVE: 'the expedition is not on the ground (finished, stranded or waiting).',
  NO_SUCH_EXPEDITION: 'there is no such expedition.',
  NOT_ADJACENT: 'pick a region next to explored land.',
  ALREADY_EXPLORED: 'that region is already explored.',
  INVALID_SPLIT:
    'the team cannot split that way. Pick two different regions next to explored land.',
  REGION_NOT_EXPLORED: 'a colony can be founded only in an explored region.',
};

/** Wording for the colony and research commands where the shared launch text would be wrong. */
const COLONY_TEXT: Record<string, string> = {
  NO_SUCH_COLONY: 'there is no such colony.',
  INVALID_STANCE: 'that stance does not exist.',
  INVALID_DISTRICT: 'that district cannot be built.',
  SPACEPORT_EXISTS: 'this colony already has a Spaceport.',
  INVALID_REGION: 'that site does not exist.',
  REGION_NOT_EXPLORED: 'that site has not been explored yet.',
  DISTRICT_EXISTS: 'that site already has a district.',
  NATIVE_REGION: 'that site is native ground. Push the natives out to claim it.',
  INSUFFICIENT_PRODUCTION: 'the colony does not have enough Production.',
  INVALID_TECH: 'that tech does not exist.',
  TECH_KNOWN: 'that tech is already known.',
  TECH_LOCKED: 'learn its prerequisite tech first.',
  GAME_ENDED: 'the run is over. Start a new game.',
};

const COLONY_PREFIX: Record<string, string> = {
  stance: 'Stance refused: ',
  build: 'Build refused: ',
  tech: 'Research refused: ',
};

/** Reasons the colony and research commands can be refused with that have their own wording (tested). */
export const COLONY_REJECT_REASONS: readonly string[] = Object.keys(COLONY_TEXT);

const PLANETFALL_PREFIX: Record<string, string> = {
  form: 'Landing refused: ',
  explore: 'Exploration refused: ',
  found: 'Founding refused: ',
  embark: 'Re-embark refused: ',
};

/** Reasons the planetfall commands can be refused with that have their own wording (tested). */
export const PLANETFALL_REJECT_REASONS: readonly string[] = Object.keys(PLANETFALL_TEXT);

/** Text for a rejected reply, by the kind of command it answered. */
export function describeRejectFor(kind: CommandKind, reason: string): string {
  if (kind === 'reroute') {
    const t = REROUTE_TEXT[reason];
    if (t !== undefined) return t;
  } else if (kind === 'event') {
    const t = EVENT_TEXT[reason];
    if (t !== undefined) return t;
  } else if (kind === 'form' || kind === 'explore' || kind === 'found' || kind === 'embark') {
    const t = PLANETFALL_TEXT[reason];
    if (t !== undefined) return PLANETFALL_PREFIX[kind] + t;
    // The generic launch wording would say "Launch refused"; this is a different command.
    return describeReject(reason).replace(/^Launch refused: /, PLANETFALL_PREFIX[kind]);
  } else if (kind === 'stance' || kind === 'build' || kind === 'tech') {
    const t = COLONY_TEXT[reason];
    if (t !== undefined) return COLONY_PREFIX[kind] + t;
    return describeReject(reason).replace(/^Launch refused: /, COLONY_PREFIX[kind]);
  }
  return describeReject(reason);
}

/** Reasons the reroute command can be refused with (each has reroute-specific text; tested). */
export const REROUTE_REJECT_REASONS: readonly string[] = Object.keys(REROUTE_TEXT);
