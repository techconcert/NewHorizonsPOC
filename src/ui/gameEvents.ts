import { OUTCOME } from '../shared/colony';
import {
  LAST_ROLL_SLOTS,
  LR_DAY,
  LR_KIND,
  LR_REGION,
  LR_RESULT,
  LR_STRIDE,
  FoundTier,
} from '../shared/planetfall';
import {
  META_COLONY_COUNT,
  META_EXPEDITION_COUNT,
  META_OUTCOME,
  META_PENDING_COUNT,
  META_SHIP_COUNT,
  type Snapshot,
} from '../shared/snapshot';
import { SUPPLY_MARGIN_WARN_PCT } from '../shared/loadout';
import { SHIP_STATE } from '../shared/transit';

/**
 * Important game events read from snapshot changes (M8, D-141). One detector feeds both the audio
 * cues and the screen reader announcements, so a sound never plays for something that is not also
 * said. Pure and allocation-free per call: facts go into a preallocated struct and events leave
 * through a callback.
 */

export type GameEventKind =
  'card' | 'arrival' | 'founded' | 'foundFailed' | 'lowMargin' | 'won' | 'lost';

export interface GameFacts {
  pendingCards: number;
  /** Ships parked at their destination (arrived or in orbit). */
  arrivedShips: number;
  colonies: number;
  /** Flying ships with colonists whose supply margin is under the warning threshold. */
  lowMarginShips: number;
  /** Founding records whose result is Failed: their count and a key that changes with each new one. */
  failedFoundings: number;
  failedKey: number;
  outcome: number;
}

export function createGameFacts(): GameFacts {
  return {
    pendingCards: 0,
    arrivedShips: 0,
    colonies: 0,
    lowMarginShips: 0,
    failedFoundings: 0,
    failedKey: 0,
    outcome: 0,
  };
}

/** Fill `out` from a snapshot. Loops over ships and expedition records only. */
export function readGameFacts(snap: Snapshot, out: GameFacts): void {
  out.pendingCards = snap.meta[META_PENDING_COUNT];
  out.colonies = snap.meta[META_COLONY_COUNT];
  out.outcome = snap.meta[META_OUTCOME];
  let arrived = 0;
  let low = 0;
  const ships = snap.meta[META_SHIP_COUNT];
  for (let i = 0; i < ships; i++) {
    const st = snap.shipState[i];
    if (st === SHIP_STATE.Arrived || st === SHIP_STATE.InOrbit) arrived++;
    else if (
      (st === SHIP_STATE.InTransit || st === SHIP_STATE.Event) &&
      snap.shipColonists[i] > 0 &&
      snap.shipMargin[i] < SUPPLY_MARGIN_WARN_PCT
    )
      low++;
  }
  out.arrivedShips = arrived;
  out.lowMarginShips = low;
  let failed = 0;
  let key = 0;
  const exps = snap.meta[META_EXPEDITION_COUNT];
  for (let e = 0; e < exps; e++) {
    for (let s = 0; s < LAST_ROLL_SLOTS; s++) {
      const o = (e * LAST_ROLL_SLOTS + s) * LR_STRIDE;
      const r = snap.expeditionRolls;
      if (r[o + LR_KIND] === 2 && r[o + LR_RESULT] === FoundTier.Failed) {
        failed++;
        key += (r[o + LR_DAY] + 1) * 64 + r[o + LR_REGION] + 1;
      }
    }
  }
  out.failedFoundings = failed;
  out.failedKey = key;
}

export interface GameEventDetector {
  /** Compare with the previous facts and call `emit` for each new event. The first call only learns. */
  update(facts: GameFacts, emit: (kind: GameEventKind) => void): void;
  /** A new world (new game, load): forget the previous facts so nothing fires for the jump. */
  reset(): void;
}

export function createGameEventDetector(): GameEventDetector {
  let have = false;
  const prev = createGameFacts();
  return {
    reset() {
      have = false;
    },
    update(f, emit) {
      if (have) {
        if (f.pendingCards > prev.pendingCards) emit('card');
        if (f.arrivedShips > prev.arrivedShips) emit('arrival');
        if (f.colonies > prev.colonies) emit('founded');
        if (
          f.failedFoundings > 0 &&
          f.failedKey !== prev.failedKey &&
          f.failedFoundings >= prev.failedFoundings
        )
          emit('foundFailed');
        if (f.lowMarginShips > prev.lowMarginShips) emit('lowMargin');
        if (prev.outcome === OUTCOME.Running && f.outcome !== OUTCOME.Running) {
          emit(f.outcome === OUTCOME.Won ? 'won' : 'lost');
        }
      }
      have = true;
      prev.pendingCards = f.pendingCards;
      prev.arrivedShips = f.arrivedShips;
      prev.colonies = f.colonies;
      prev.lowMarginShips = f.lowMarginShips;
      prev.failedFoundings = f.failedFoundings;
      prev.failedKey = f.failedKey;
      prev.outcome = f.outcome;
    },
  };
}

/** The sentence a screen reader hears for an event. */
export function eventAnnouncement(kind: GameEventKind): string {
  switch (kind) {
    case 'card':
      return 'Event card pending. The game is paused until you answer it.';
    case 'arrival':
      return 'A ship has arrived at its destination.';
    case 'founded':
      return 'Colony founded.';
    case 'foundFailed':
      return 'Founding failed. The survivors are stranded on the ground.';
    case 'lowMargin':
      return 'Warning: a ship is flying with a low supply margin.';
    case 'won':
      return 'Game over: you won.';
    case 'lost':
      return 'Game over: you lost.';
  }
}
