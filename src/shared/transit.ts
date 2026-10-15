import { LOADOUT } from '../data';
import {
  DISTANCE_FP,
  etaDays,
  eventChancePermille,
  rerouteOptions,
  rerouteRangeFp,
  type RerouteOption,
  type ReroutePoint,
  type RerouteTargets,
} from './loadout';
import type { RerouteRejectReason } from './commands';
import { isLiveStatus } from './planetfall';
import {
  EXPEDITION_STRIDE,
  META_EXPEDITION_COUNT,
  META_PLANET_COUNT,
  META_SHIP_COUNT,
  META_SYSTEM_COUNT,
  SHIP_POS_STRIDE,
  SNAPSHOT_MAX_SYSTEMS,
  X_SHIP,
  X_STATUS,
  type Snapshot,
} from './snapshot';

/**
 * Transit helpers shared by the render and ui layers (M3 part B): ship state ids and kinds, the
 * expected-events figure for Mission Command, and the reroute range / option math read from a
 * snapshot. Pure functions, no DOM and no three.js.
 */

/** Ship state ids as written by the sim (ShipStateId in src/sim/components.ts; a test asserts equality). */
export const SHIP_STATE = {
  Building: 1,
  Launching: 2,
  Cruising: 3,
  Event: 4,
  Arriving: 5,
  InOrbit: 6,
  Lost: 7,
  InTransit: 8,
  Arrived: 9,
  Drifting: 10,
} as const;

/** The five looks a ship marker can have (render palette) and list rows can show. */
export type ShipKind = 'transit' | 'event' | 'drifting' | 'arrived' | 'lost';

export const SHIP_KINDS: readonly ShipKind[] = ['transit', 'event', 'drifting', 'arrived', 'lost'];

/** Display kind of a state id. Pre-flight states and Cruising count as in transit. */
export function shipKindOf(state: number): ShipKind {
  switch (state) {
    case SHIP_STATE.Event:
      return 'event';
    case SHIP_STATE.Drifting:
      return 'drifting';
    case SHIP_STATE.Arrived:
    case SHIP_STATE.InOrbit:
    case SHIP_STATE.Arriving:
      return 'arrived';
    case SHIP_STATE.Lost:
      return 'lost';
    default:
      return 'transit';
  }
}

export const SHIP_KIND_LABEL: Record<ShipKind, string> = {
  transit: 'In transit',
  event: 'Event pending',
  drifting: 'Drifting',
  arrived: 'Arrived',
  lost: 'Lost',
};

/** True for states in which the ship moves along its leg (it needs a route line and a trail). */
export function isFlying(state: number): boolean {
  return state === SHIP_STATE.InTransit || state === SHIP_STATE.Cruising;
}

/** The snapshot's margin cap stands for "plenty / nobody aboard" (LoadoutMath). */
export const SUPPLY_MARGIN_CAP_PCT: number = LOADOUT.supplyMarginCapPct;

// ---- Expected events (Mission Command) ----------------------------------------------------

/**
 * Expected number of event cards on a trip, x100: days in flight x the daily chance (permille)
 * / 1000, rounded. Uses the same ETA and the same chance formula as the sim, so a faster speed
 * setting shows fewer events (fewer days and a lower speed factor). Integer math.
 */
export function expectedEventsX100(
  distanceFp: number,
  hull: number,
  speed: number,
  hazard: number,
): number {
  const days = etaDays(distanceFp, hull, speed);
  return Math.round((days * eventChancePermille(hazard, hull, speed)) / 10);
}

/** "0.22", "1.05": two decimals from a x100 integer. */
export function formatExpectedEvents(x100: number): string {
  const whole = Math.floor(x100 / 100);
  const frac = x100 % 100;
  return `${whole}.${frac < 10 ? '0' : ''}${frac}`;
}

// ---- Reroute data from a snapshot -------------------------------------------------------------

/** Reusable buffers for reroute math, so repeated calls allocate only their results. */
export interface TransitScratch {
  systemXFp: Int32Array;
  systemYFp: Int32Array;
}

export function createTransitScratch(): TransitScratch {
  return {
    systemXFp: new Int32Array(SNAPSHOT_MAX_SYSTEMS),
    systemYFp: new Int32Array(SNAPSHOT_MAX_SYSTEMS),
  };
}

/** Round the snapshot's system positions to the sim's fixed-point grid (exact: grid / 256 is a float). */
export function loadSystemGrid(snap: Snapshot, scratch: TransitScratch): void {
  const n = Math.min(snap.meta[META_SYSTEM_COUNT], SNAPSHOT_MAX_SYSTEMS);
  for (let i = 0; i < n; i++) {
    scratch.systemXFp[i] = Math.round(snap.positions[i * 2] * DISTANCE_FP);
    scratch.systemYFp[i] = Math.round(snap.positions[i * 2 + 1] * DISTANCE_FP);
  }
}

/** Snapshot row of a ship entity, or -1. */
export function shipRowOf(snap: Snapshot, entity: number): number {
  const n = snap.meta[META_SHIP_COUNT];
  for (let i = 0; i < n; i++) if (snap.shipEntity[i] === entity) return i;
  return -1;
}

/**
 * Why a ship in this state cannot be rerouted, in the sim's check order (D-052), or null.
 * (Lost ships are not in the snapshot; SHIP_LOST is listed for completeness.)
 */
export function rerouteBlocker(state: number, hasExpedition = false): RerouteRejectReason | null {
  if (state === SHIP_STATE.Lost) return 'SHIP_LOST';
  if (state === SHIP_STATE.Drifting) return 'SHIP_DRIFTING';
  if (state === SHIP_STATE.Event) return 'EVENT_PENDING';
  // A ship waiting in orbit may leave like one in flight (D-081), unless an expedition is out.
  if (state === SHIP_STATE.Arrived || state === SHIP_STATE.InOrbit) {
    return hasExpedition ? 'EXPEDITION_ACTIVE' : null;
  }
  if (state !== SHIP_STATE.InTransit) return 'SHIP_NOT_IN_TRANSIT';
  return null;
}

/** True when the ship entity has an expedition on the ground, stranded or waiting on a card. */
export function shipHasLiveExpedition(snap: Snapshot, ship: number): boolean {
  const n = snap.meta[META_EXPEDITION_COUNT];
  for (let i = 0; i < n; i++) {
    const o = i * EXPEDITION_STRIDE;
    if (snap.expeditions[o + X_SHIP] === ship && isLiveStatus(snap.expeditions[o + X_STATUS])) {
      return true;
    }
  }
  return false;
}

/** The reroute blocker of the ship at snapshot row `row`, expedition included. */
export function rerouteBlockerOfRow(snap: Snapshot, row: number): RerouteRejectReason | null {
  return rerouteBlocker(snap.shipState[row], shipHasLiveExpedition(snap, snap.shipEntity[row]));
}

/**
 * Fuel the UI treats as spendable. The snapshot does not carry the sim's part-burned fraction, and
 * a flying ship nearly always has a unit part burned, so the UI assumes one unit less (D-052's
 * `spendableFuel`). This never promises a reroute the sim would refuse; it can hide one that is
 * exactly one fuel unit from the limit.
 */
export function uiSpendableFuel(fuel: number, state: number): number {
  const parked = state === SHIP_STATE.Arrived || state === SHIP_STATE.InOrbit;
  const f = state === SHIP_STATE.InTransit || parked ? fuel - 1 : fuel;
  return f < 0 ? 0 : f;
}

/** The ship at snapshot row `row` as a reroute point (grid position, spendable fuel). Allocates. */
export function shipFlightOf(snap: Snapshot, row: number): ReroutePoint {
  const o = row * SHIP_POS_STRIDE;
  const state = snap.shipState[row];
  return {
    hull: snap.shipHull[row],
    speed: snap.shipSpeed[row],
    fuel: uiSpendableFuel(snap.shipFuel[row], state),
    supplies: snap.shipSupplies[row],
    colonists: snap.shipColonists[row],
    delay: snap.shipDelay[row],
    xFp: Math.round(snap.shipPos[o + 2] * DISTANCE_FP),
    yFp: Math.round(snap.shipPos[o + 3] * DISTANCE_FP),
    destPlanet: snap.shipDest[row],
  };
}

/** Planet targets for `rerouteOptions` from a snapshot. `loadSystemGrid` must have run. */
export function rerouteTargetsOf(snap: Snapshot, scratch: TransitScratch): RerouteTargets {
  return {
    count: snap.meta[META_PLANET_COUNT],
    planetSystem: snap.planetSystem,
    systemXFp: scratch.systemXFp,
    systemYFp: scratch.systemYFp,
    planetOwned: snap.planetOwned,
  };
}

/**
 * Every planet this ship could be rerouted to now (empty when the ship cannot be rerouted), with
 * the shared preview numbers. Allocates; call when the selection or the snapshot changes.
 */
export function rerouteOptionsFor(
  snap: Snapshot,
  row: number,
  scratch: TransitScratch,
): RerouteOption[] {
  if (row < 0 || rerouteBlockerOfRow(snap, row) !== null) return [];
  loadSystemGrid(snap, scratch);
  return rerouteOptions(shipFlightOf(snap, row), rerouteTargetsOf(snap, scratch));
}

/** Radius of the range ring in world units: what the fuel left after the penalty covers (0 if none). */
export function rangeRadiusWorld(snap: Snapshot, row: number): number {
  if (row < 0 || rerouteBlockerOfRow(snap, row) !== null) return 0;
  const fuel = uiSpendableFuel(snap.shipFuel[row], snap.shipState[row]);
  return rerouteRangeFp(fuel, snap.shipSpeed[row]) / DISTANCE_FP;
}

/**
 * Mark the systems that have at least one reachable planet: `out[system] = 1`, others 0.
 * Returns the number of lit systems. No allocation.
 */
export function reachableSystems(
  options: readonly RerouteOption[],
  planetSystem: ArrayLike<number>,
  out: Uint8Array,
): number {
  out.fill(0);
  let lit = 0;
  for (const o of options) {
    const sys = planetSystem[o.planet];
    if (sys < out.length && out[sys] === 0) {
      out[sys] = 1;
      lit++;
    }
  }
  return lit;
}

/**
 * Start of the current leg, in world units, written to `out[off], out[off + 1]`. A ship at
 * progress p of distance d sits at origin + (target - origin) x p / d, so the origin follows from
 * its position and the target. Falls back to the ship's position when the leg is (nearly) done.
 */
export function legOrigin(
  x: number,
  y: number,
  tx: number,
  ty: number,
  progress: number,
  distance: number,
  out: Float32Array,
  off: number,
): void {
  if (distance <= 0 || progress <= 0 || progress >= distance * 0.999) {
    out[off] = x;
    out[off + 1] = y;
    return;
  }
  const f = progress / distance;
  out[off] = (x - tx * f) / (1 - f);
  out[off + 1] = (y - ty * f) / (1 - f);
}
