import { FIND_UNKNOWN } from '../shared/planetfall';
import { G_ENTITY, RegionFlag, RNG_ENTITY_BASE, Survey, type Stores } from './components';
import { nextInt } from './rng';
import type { World } from './world';
import { ExpeditionStatus } from '../shared/planetfall';

/**
 * Low-level planet-surface helpers shared by the expedition rules and the event cards: the fog
 * (one byte per region), hex adjacency, native dispositions and the find roll. D-067, D-072.
 */

/** Fog values (same byte scale as Survey): hidden, visible next to explored land, explored. */
export const FOG_HIDDEN = 0;
export const FOG_VISIBLE = Survey.Scanned;
export const FOG_EXPLORED = Survey.Explored;

/** Global index of the planet's first region. */
export function regionBase(s: Stores, planet: number): number {
  return s.planet.regionStart[planet];
}

/** Local index of the planet's landing zone. */
export function landingZone(s: Stores, planet: number): number {
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  for (let i = 0; i < n; i++) {
    if ((s.region.flags[base + i] & RegionFlag.LandingZone) !== 0) return i;
  }
  return 0;
}

/** True when local regions a and b share a hex edge (axial coordinates). */
export function adjacent(s: Stores, base: number, a: number, b: number): boolean {
  const dq = s.region.q[base + a] - s.region.q[base + b];
  const dr = s.region.r[base + a] - s.region.r[base + b];
  return (
    (dq === 1 && dr === 0) ||
    (dq === 1 && dr === -1) ||
    (dq === 0 && dr === -1) ||
    (dq === -1 && dr === 0) ||
    (dq === -1 && dr === 1) ||
    (dq === 0 && dr === 1)
  );
}

/** Regions of the planet an expedition has explored. */
export function exploredCount(s: Stores, planet: number): number {
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  let c = 0;
  for (let i = 0; i < n; i++) if (s.region.fog[base + i] === FOG_EXPLORED) c++;
  return c;
}

/**
 * Mark a region explored and make every hidden neighbour visible (the frontier the player can
 * pick next). The fog is shared by all expeditions on the planet.
 */
export function markExplored(s: Stores, planet: number, local: number): void {
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  s.region.fog[base + local] = FOG_EXPLORED;
  for (let i = 0; i < n; i++) {
    if (s.region.fog[base + i] === FOG_HIDDEN && adjacent(s, base, local, i)) {
      s.region.fog[base + i] = FOG_VISIBLE;
    }
  }
}

/** Lowest local index of a visible, unexplored region other than `exclude`, or -1. */
export function firstFrontier(s: Stores, planet: number, exclude: number): number {
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  for (let i = 0; i < n; i++) {
    if (i !== exclude && s.region.fog[base + i] === FOG_VISIBLE) return i;
  }
  return -1;
}

/**
 * The frontier region a Bold team rolls second when the player named none: the lowest visible
 * unexplored region other than `exclude` that is not a native home, else the lowest visible one.
 */
export function autoSecondRegion(s: Stores, planet: number, exclude: number): number {
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  let any = -1;
  for (let i = 0; i < n; i++) {
    if (i === exclude || s.region.fog[base + i] !== FOG_VISIBLE) continue;
    if (!inNativeHome(s, planet, i)) return i;
    if (any < 0) any = i;
  }
  return any;
}

/** True when `ship` has an expedition on the ground, stranded or waiting on a card. */
export function shipHasLiveExpedition(s: Stores, ship: number): boolean {
  const n = s.counts[G_ENTITY];
  for (let e = 0; e < n; e++) {
    const x = s.expedition.status[e];
    if (
      s.expedition.ship[e] === ship &&
      (x === ExpeditionStatus.Active ||
        x === ExpeditionStatus.Stranded ||
        x === ExpeditionStatus.Event)
    )
      return true;
  }
  return false;
}

/** Native disposition now (1 Peaceful, 2 Wary, 3 Hostile; 0 no natives): base plus mood shifts. */
export function effectiveDisposition(s: Stores, planet: number): number {
  const base = s.native.disposition[planet];
  if (base === 0 || s.native.expelled[planet] === 1) return 0;
  const v = base + s.native.shift[planet];
  return v < 1 ? 1 : v > 3 ? 3 : v;
}

/** True when the local region is a native home region of the planet (not claimed by a colony, D-095). */
export function inNativeHome(s: Stores, planet: number, local: number): boolean {
  return (
    s.native.disposition[planet] !== 0 &&
    s.native.expelled[planet] === 0 &&
    ((s.native.homeRegionMask[planet] >>> local) & 1) === 1 &&
    ((s.native.claimed[planet] >>> local) & 1) === 0
  );
}

/**
 * Natives grow calmer (delta -1) or angrier (+1), kept between Peaceful and Hostile. Only
 * natives the player has met can change mood.
 */
export function shiftNativeMood(s: Stores, planet: number, delta: number): void {
  const base = s.native.disposition[planet];
  if (base === 0 || s.native.revealed[planet] === 0 || delta === 0) return;
  let v = base + s.native.shift[planet] + delta;
  v = v < 1 ? 1 : v > 3 ? 3 : v;
  s.native.shift[planet] = v - base;
}

/**
 * Roll the find of a terrain with the entity's own RNG stream (one draw): walks the terrain's
 * find table, which sums to 100. Returns the find kind id.
 */
export function rollFind(w: World, e: number, terrain: number): number {
  const c = w.content;
  const kinds = c.findKindCount;
  const r = nextInt(w.stores.rng, RNG_ENTITY_BASE + e, 0, 99);
  let acc = 0;
  for (let k = 0; k < kinds; k++) {
    acc += c.terrainFinds[terrain * kinds + k];
    if (r < acc) return k;
  }
  return kinds - 1;
}

/**
 * Explore a region without a team roll (a card revealed it): fog and its neighbours update and
 * the find is rolled for it. Does nothing when the region is already explored.
 */
export function exploreFree(w: World, e: number, planet: number, local: number): void {
  const s = w.stores;
  const idx = s.planet.regionStart[planet] + local;
  if (s.region.fog[idx] === FOG_EXPLORED) return;
  markExplored(s, planet, local);
  if (s.region.find[idx] === FIND_UNKNOWN) {
    s.region.find[idx] = rollFind(w, e, s.region.terrain[idx]);
  }
}

/** Expeditions on the ground (Active, Stranded or waiting on a card). Scans entity ids. */
export function liveExpeditions(s: Stores): number {
  const n = s.counts[G_ENTITY];
  let c = 0;
  for (let e = 0; e < n; e++) {
    const st = s.expedition.status[e];
    if (
      st === ExpeditionStatus.Active ||
      st === ExpeditionStatus.Stranded ||
      st === ExpeditionStatus.Event
    )
      c++;
  }
  return c;
}
