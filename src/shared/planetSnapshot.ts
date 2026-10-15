import { ExpeditionStatus, isLiveStatus } from './planetfall';
import {
  C_SYSTEM,
  CD_PLANET,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  EXPEDITION_STRIDE,
  META_COLONY_COUNT,
  META_EXPEDITION_COUNT,
  META_SHIP_COUNT,
  X_PLANET,
  X_SHIP,
  X_STATUS,
  X_TARGET,
  type Snapshot,
} from './snapshot';
import { SHIP_STATE } from './transit';

/**
 * Read-only lookups over the planetfall rows of a snapshot (expeditions, parked ships, colonies),
 * shared by the ui and render layers. Pure, no allocation.
 */

/** True for a ship waiting in orbit at its destination (Arrived, or the older InOrbit id). */
export function isParkedState(state: number): boolean {
  return state === SHIP_STATE.Arrived || state === SHIP_STATE.InOrbit;
}

/** Row of the live (Active, Stranded or waiting on a card) expedition of `ship`, or -1. */
export function liveExpeditionRowOfShip(snap: Snapshot, ship: number): number {
  const n = snap.meta[META_EXPEDITION_COUNT];
  for (let i = 0; i < n; i++) {
    const o = i * EXPEDITION_STRIDE;
    if (snap.expeditions[o + X_SHIP] === ship && isLiveStatus(snap.expeditions[o + X_STATUS])) {
      return i;
    }
  }
  return -1;
}

/**
 * Compact code of a ship's expedition for change keys and labels: 0 none, else status x 2 plus 1
 * while a round is out. Live expeditions only.
 */
export function expeditionCodeOfShip(snap: Snapshot, ship: number): number {
  const row = liveExpeditionRowOfShip(snap, ship);
  if (row < 0) return 0;
  const o = row * EXPEDITION_STRIDE;
  return snap.expeditions[o + X_STATUS] * 2 + (snap.expeditions[o + X_TARGET] >= 0 ? 1 : 0);
}

/**
 * Row of the expedition to show for a planet: the live one of `preferShip` (if given), any other
 * live one, else the newest finished one (rows list live first, then finished newest first). -1
 * when the planet never had an expedition in the rows.
 */
export function expeditionRowOnPlanet(snap: Snapshot, planet: number, preferShip: number): number {
  const n = snap.meta[META_EXPEDITION_COUNT];
  let anyLive = -1;
  let firstFinished = -1;
  for (let i = 0; i < n; i++) {
    const o = i * EXPEDITION_STRIDE;
    if (snap.expeditions[o + X_PLANET] !== planet) continue;
    if (isLiveStatus(snap.expeditions[o + X_STATUS])) {
      if (preferShip >= 0 && snap.expeditions[o + X_SHIP] === preferShip) return i;
      if (anyLive < 0) anyLive = i;
    } else if (firstFinished < 0) firstFinished = i;
  }
  return anyLive >= 0 ? anyLive : firstFinished;
}

/**
 * Ship row of a ship parked at `planet`: one with a live expedition first, else the lowest row.
 * -1 when none is parked there.
 */
export function parkedShipRowAt(snap: Snapshot, planet: number): number {
  const n = snap.meta[META_SHIP_COUNT];
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (!isParkedState(snap.shipState[i]) || snap.shipDest[i] !== planet) continue;
    if (liveExpeditionRowOfShip(snap, snap.shipEntity[i]) >= 0) return i;
    if (first < 0) first = i;
  }
  return first;
}

/** Row of the parked ship with entity `entity` at `planet`, or -1 (it left, was lost or is elsewhere). */
export function parkedShipRowOfEntity(snap: Snapshot, planet: number, entity: number): number {
  const n = snap.meta[META_SHIP_COUNT];
  for (let i = 0; i < n; i++) {
    if (
      snap.shipEntity[i] === entity &&
      isParkedState(snap.shipState[i]) &&
      snap.shipDest[i] === planet
    ) {
      return i;
    }
  }
  return -1;
}

/** Number of ships parked at `planet`. */
export function parkedShipCountAt(snap: Snapshot, planet: number): number {
  const n = snap.meta[META_SHIP_COUNT];
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (isParkedState(snap.shipState[i]) && snap.shipDest[i] === planet) c++;
  }
  return c;
}

/** Row of the `k`-th (0-based, ascending row order) ship parked at `planet`, or -1. */
export function nthParkedShipRowAt(snap: Snapshot, planet: number, k: number): number {
  const n = snap.meta[META_SHIP_COUNT];
  let c = 0;
  for (let i = 0; i < n; i++) {
    if (!isParkedState(snap.shipState[i]) || snap.shipDest[i] !== planet) continue;
    if (c === k) return i;
    c++;
  }
  return -1;
}

/** Colony row (into snap.colonies / colonyDetail) that owns `planet`, or -1. */
export function colonyRowOfPlanet(snap: Snapshot, planet: number): number {
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 0; i < n; i++) {
    if (snap.colonyDetail[i * COLONY_DETAIL_STRIDE + CD_PLANET] === planet) return i;
  }
  return -1;
}

/** Number of finished or live expedition statuses, for tests and labels. */
export function isFinishedStatus(status: number): boolean {
  return (
    status === ExpeditionStatus.Founded ||
    status === ExpeditionStatus.Dead ||
    status === ExpeditionStatus.Returned
  );
}

/** System index a colony row sits in. */
export function colonySystem(snap: Snapshot, row: number): number {
  return snap.colonies[row * COLONY_STRIDE + C_SYSTEM];
}

/**
 * Mark `out[system] = 1` for every system holding a colony founded off the homeworld (colony row 0
 * is the homeworld). Returns how many systems are marked. No allocation.
 */
export function colonisedSystems(snap: Snapshot, out: Uint8Array): number {
  out.fill(0);
  const n = snap.meta[META_COLONY_COUNT];
  let lit = 0;
  for (let i = 1; i < n; i++) {
    const sys = snap.colonies[i * COLONY_STRIDE + C_SYSTEM];
    if (sys >= 0 && sys < out.length && out[sys] === 0) {
      out[sys] = 1;
      lit++;
    }
  }
  return lit;
}
