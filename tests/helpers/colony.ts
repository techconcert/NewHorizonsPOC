import { MAX_REGIONS_PER_PLANET } from '../../src/sim/components';
import { spawnEntity } from '../../src/sim/entities';
import type { World } from '../../src/sim/world';
import { planetOf } from './transit';

export interface ColonyOpts {
  /** System whose first planet the colony holds (default 2; line worlds keep 0 for the homeworld). */
  system?: number;
  population?: number;
  supplies?: number;
  fuel?: number;
  production?: number;
  /** FoundTier: 1 Struggling, 2 Thriving (default). */
  tier?: number;
  /** Terrain id of every region (default 0, Plains). */
  terrain?: number;
  /** Number of regions explored, lowest local index first (default all). The next one is visible. */
  explored?: number;
  spaceport?: boolean;
  stance?: number;
  penaltyDays?: number;
}

/**
 * Add a colony entity on the first planet of a system, with predictable regions (one terrain, the
 * first `explored` regions explored) and no natives. Nothing is logged; for scenario setup only.
 */
export function addColony(w: World, o: ColonyOpts = {}): number {
  const s = w.stores;
  const e = spawnEntity(w);
  const planet = planetOf(w, o.system ?? 2);
  s.colony.planet[e] = planet;
  s.colony.population[e] = o.population ?? 300;
  s.colony.tier[e] = o.tier ?? 2;
  s.colony.spaceport[e] = o.spaceport ? 1 : 0;
  s.colony.penaltyDays[e] = o.penaltyDays ?? 0;
  s.colony.nativeStance[e] = o.stance ?? 0;
  s.stockpile.supplies[e] = o.supplies ?? 10000;
  s.stockpile.fuel[e] = o.fuel ?? 0;
  s.stockpile.production[e] = o.production ?? 100;
  s.planet.owner[planet] = e;
  s.native.disposition[planet] = 0;
  s.native.homeRegionMask[planet] = 0;
  const base = s.planet.regionStart[planet];
  const n = s.planet.regionCount[planet];
  const explored = o.explored ?? n;
  for (let i = 0; i < n; i++) {
    s.region.terrain[base + i] = o.terrain ?? 0;
    s.region.fog[base + i] = i < explored ? 3 : i === explored ? 1 : 0;
  }
  return e;
}

/** Put a finished (left = 0) or unfinished district straight into a colony's region. */
export function setDistrict(
  w: World,
  colony: number,
  region: number,
  kind: number,
  left = 0,
): void {
  w.stores.district.kind[colony * MAX_REGIONS_PER_PLANET + region] = kind;
  w.stores.district.left[colony * MAX_REGIONS_PER_PLANET + region] = left;
}

/** Terrain of local region `region` of the colony's planet. */
export function setTerrain(w: World, colony: number, region: number, terrain: number): void {
  const s = w.stores;
  s.region.terrain[s.planet.regionStart[s.colony.planet[colony]] + region] = terrain;
}

export interface NativeOpts {
  /** 1 Peaceful, 2 Wary, 3 Hostile. */
  disposition: number;
  strength?: number;
  /** Local region indices that are native home regions. */
  homes?: number[];
}

/** Natives on the colony's planet (strength default 50, which makes the strength factor exactly 100%). */
export function addNatives(w: World, colony: number, o: NativeOpts): void {
  const s = w.stores;
  const planet = s.colony.planet[colony];
  s.native.disposition[planet] = o.disposition;
  s.native.strength[planet] = o.strength ?? 50;
  s.native.variant[planet] = 0; // kind unknown: the tests assert disposition-only texts
  s.native.shift[planet] = 0;
  s.native.revealed[planet] = 1;
  let mask = 0;
  for (const r of o.homes ?? []) mask |= 1 << r;
  s.native.homeRegionMask[planet] = mask >>> 0;
}
