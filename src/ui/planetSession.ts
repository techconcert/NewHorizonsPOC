import {
  colonyRowOfPlanet,
  expeditionRowOnPlanet,
  liveExpeditionRowOfShip,
  parkedShipRowAt,
  parkedShipRowOfEntity,
} from '../shared/planetSnapshot';
import { ExpeditionStatus, isLiveStatus } from '../shared/planetfall';
import { splitAvailable } from './expeditionModel';
import { META_PLANET_COUNT, X_STATUS, EXPEDITION_STRIDE, type Snapshot } from '../shared/snapshot';
import { FOG_VISIBLE } from '../shared/fog';

/**
 * Pure state of the view switch (galaxy <-> planet) and of what the player has picked on the
 * planet (region, second region, split). No DOM and no three.js. The planet view opens from the
 * galaxy view for a planet that has a ship waiting in orbit or an expedition, and closes by
 * itself when nothing is left to act on (the ship flew away, the planet is gone).
 */

export type ViewMode = 'galaxy' | 'planet';

export interface PlanetSession {
  mode: ViewMode;
  /** Planet index shown in the planet view, or -1. */
  planet: number;
  /** Ship entity the view acts for (the one parked at the planet), or -1. */
  ship: number;
  /** Selected local region, or -1. */
  region: number;
  /** Explicit second region (Bold's second, or a split team's), or -1 for none / automatic. */
  region2: number;
  /** Split the team in two (Balanced and Cautious only). */
  split: boolean;
  /** An expedition was on the ground at the last snapshot (so its loss can be acknowledged). */
  hadLive: boolean;
  /** The last expedition died: the view stays open until the player leaves it. */
  ended: boolean;
}

export function createPlanetSession(): PlanetSession {
  return {
    mode: 'galaxy',
    planet: -1,
    ship: -1,
    region: -1,
    region2: -1,
    split: false,
    hadLive: false,
    ended: false,
  };
}

/** What the planet view works with for one planet: ship row, expedition row, colony row. */
export interface PlanetContext {
  planet: number;
  shipRow: number;
  shipEntity: number;
  /** Expedition row to show (live one of the ship first, any live one, else the newest finished). */
  expRow: number;
  colonyRow: number;
}

export function createPlanetContext(): PlanetContext {
  return { planet: -1, shipRow: -1, shipEntity: -1, expRow: -1, colonyRow: -1 };
}

/** Fill `out` for `planet`; `preferShip` is the entity the session has been working with. */
export function fillPlanetContext(
  snap: Snapshot,
  planet: number,
  preferShip: number,
  out: PlanetContext,
): PlanetContext {
  out.planet = planet;
  out.shipRow = -1;
  out.shipEntity = -1;
  out.expRow = -1;
  out.colonyRow = -1;
  if (planet < 0 || planet >= snap.meta[META_PLANET_COUNT]) return out;
  // The ship the player picked stays the one shown while it is still parked here.
  let parked = preferShip >= 0 ? parkedShipRowOfEntity(snap, planet, preferShip) : -1;
  if (parked < 0) parked = parkedShipRowAt(snap, planet);
  out.shipRow = parked;
  out.shipEntity = parked >= 0 ? snap.shipEntity[parked] : -1;
  let ship = out.shipEntity >= 0 ? out.shipEntity : preferShip;
  // A lost depot is gone from the rows; its expedition goes on and is found by the planet.
  if (ship >= 0 && out.shipEntity < 0 && liveExpeditionRowOfShip(snap, ship) < 0) ship = -1;
  out.expRow = expeditionRowOnPlanet(snap, planet, ship);
  out.colonyRow = colonyRowOfPlanet(snap, planet);
  return out;
}

const scratch = createPlanetContext();

/**
 * True when the planet view has something to act on for this planet: a ship waiting in orbit, an
 * expedition on the ground, or a colony founded by an expedition (its result stays readable).
 */
export function canLand(snap: Snapshot, planet: number): boolean {
  if (planet < 0 || planet >= snap.meta[META_PLANET_COUNT]) return false;
  if (parkedShipRowAt(snap, planet) >= 0) return true;
  const x = expeditionRowOnPlanet(snap, planet, -1);
  if (x < 0) return false;
  if (isLiveStatus(snap.expeditions[x * EXPEDITION_STRIDE + X_STATUS])) return true;
  return snap.planetOwned[planet] !== 0;
}

/** Local index of the landing zone of a planet, or -1. */
export function landingRegion(snap: Snapshot, planet: number): number {
  const start = snap.planetRegionStart[planet];
  const n = snap.planetRegionCount[planet];
  for (let i = 0; i < n; i++) if (snap.regionLanding[start + i] === 1) return i;
  return -1;
}

/** Open the planet view for `planet`. Returns false (and changes nothing) when it cannot open. */
export function openPlanet(s: PlanetSession, snap: Snapshot, planet: number): boolean {
  if (!canLand(snap, planet)) return false;
  if (s.mode === 'planet' && s.planet === planet) return true;
  s.mode = 'planet';
  s.planet = planet;
  s.region = landingRegion(snap, planet);
  s.region2 = -1;
  s.split = false;
  s.hadLive = false;
  s.ended = false;
  fillPlanetContext(snap, planet, -1, scratch);
  s.ship = scratch.shipEntity;
  return true;
}

export function closePlanet(s: PlanetSession): void {
  s.mode = 'galaxy';
  s.planet = -1;
  s.ship = -1;
  s.region = -1;
  s.region2 = -1;
  s.split = false;
  s.hadLive = false;
  s.ended = false;
}

/** Pick which parked ship the view acts for (ignored when it is not parked at the planet). */
export function pickShip(s: PlanetSession, snap: Snapshot, entity: number): void {
  if (s.mode !== 'planet') return;
  if (parkedShipRowOfEntity(snap, s.planet, entity) >= 0) s.ship = entity;
}

export type Reconciled = 'galaxy' | 'kept' | 'closed';

/**
 * After a snapshot: keep the planet view open while it still has something to act on, close it
 * when the planet is gone or the last ship and expedition left. Also drops a second region that
 * is no longer next to explored land (or equals the first), and a selection past the region count.
 */
export function reconcile(s: PlanetSession, snap: Snapshot): Reconciled {
  if (s.mode === 'galaxy') return 'galaxy';
  if (!canLand(snap, s.planet)) {
    // The last expedition died: keep the view open once so the loss is seen, not a silent exit.
    if (s.ended) return 'kept';
    const x = expeditionRowOnPlanet(snap, s.planet, -1);
    if (
      s.hadLive &&
      x >= 0 &&
      snap.expeditions[x * EXPEDITION_STRIDE + X_STATUS] === ExpeditionStatus.Dead
    ) {
      s.ended = true;
      s.hadLive = false;
      s.split = false;
      s.region2 = -1;
      return 'kept';
    }
    closePlanet(s);
    return 'closed';
  }
  s.ended = false;
  fillPlanetContext(snap, s.planet, s.ship, scratch);
  if (scratch.shipEntity >= 0) s.ship = scratch.shipEntity;
  s.hadLive =
    scratch.expRow >= 0 &&
    isLiveStatus(snap.expeditions[scratch.expRow * EXPEDITION_STRIDE + X_STATUS]);
  // A split that can no longer happen must not stay ticked (checked but disabled in the panel).
  if (s.split && !splitAvailable(snap, s.planet, scratch.expRow)) setSplit(s, false);
  const n = snap.planetRegionCount[s.planet];
  if (s.region >= n) s.region = -1;
  if (s.region2 >= 0) {
    const start = snap.planetRegionStart[s.planet];
    if (
      s.region2 >= n ||
      s.region2 === s.region ||
      snap.regionFog[start + s.region2] !== FOG_VISIBLE
    ) {
      s.region2 = -1;
    }
  }
  return 'kept';
}

/** The player picked a region (map click or list): select it and drop a stale second region. */
export function selectRegion(s: PlanetSession, snap: Snapshot, region: number): void {
  if (s.mode !== 'planet') return;
  const n = snap.planetRegionCount[s.planet];
  s.region = region >= 0 && region < n ? region : -1;
  if (s.region2 === s.region) s.region2 = -1;
}

export function setSecondRegion(s: PlanetSession, region2: number): void {
  s.region2 = region2 === s.region ? -1 : region2;
}

export function setSplit(s: PlanetSession, on: boolean): void {
  s.split = on;
  if (!on) s.region2 = -1;
}
