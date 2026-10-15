import {
  TERRAIN_HAZARD_LEVEL,
  TERRAIN_HAZARD_TEXT,
  findLabel,
  terrainFlavour,
  terrainName,
} from '../shared/terrain';
import { FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE } from '../shared/fog';
import type { Snapshot } from '../shared/snapshot';

/**
 * Region facts for the planet panel and tooltip (pure). Everything shown comes from the snapshot,
 * which already withholds terrain of hidden regions, finds of unexplored ones and the native homes
 * until contact, so these texts cannot leak what the player has not learned.
 */

export { FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE };

/** A frontier region: next to explored land and not explored itself (the only legal targets). */
export function isFrontier(fog: number): boolean {
  return fog === FOG_VISIBLE;
}

export interface RegionInfo {
  /** Local index, or -1 for no region. */
  region: number;
  fog: number;
  /** "Region 5" (players count from 1). */
  name: string;
  state: 'unknown' | 'seen' | 'explored';
  stateText: string;
  terrain: string;
  hazard: string;
  find: string;
  landing: boolean;
  nativeHome: boolean;
  frontier: boolean;
  explored: boolean;
  /** One-line summary for the tooltip and the region list. */
  summary: string;
  /** Detail lines for the region card. */
  lines: string[];
}

export function regionName(local: number): string {
  return `Region ${local + 1}`;
}

/** Facts of local region `local` of `planet`. Allocates; call on change, not per frame. */
export function regionInfo(snap: Snapshot, planet: number, local: number): RegionInfo {
  const start = snap.planetRegionStart[planet];
  const n = snap.planetRegionCount[planet];
  const none: RegionInfo = {
    region: -1,
    fog: FOG_HIDDEN,
    name: 'No region selected',
    state: 'unknown',
    stateText: '',
    terrain: '',
    hazard: '',
    find: '',
    landing: false,
    nativeHome: false,
    frontier: false,
    explored: false,
    summary: 'No region selected',
    lines: ['Click a region on the map or pick one from the list.'],
  };
  if (local < 0 || local >= n) return none;
  const g = start + local;
  const fog = snap.regionFog[g];
  const state = fog === FOG_EXPLORED ? 'explored' : fog === FOG_VISIBLE ? 'seen' : 'unknown';
  const revealed = state !== 'unknown';
  const t = revealed ? snap.regionTerrain[g] : 255;
  const terrain = revealed ? terrainName(t) : 'Unknown';
  let hazard = '';
  if (revealed && t < TERRAIN_HAZARD_TEXT.length) {
    hazard =
      TERRAIN_HAZARD_LEVEL[t] === 0 ? 'Variable (changes each visit)' : TERRAIN_HAZARD_TEXT[t];
  }
  const explored = fog === FOG_EXPLORED;
  const findText = explored ? findLabel(snap.regionFind[g]) : '';
  const landing = snap.regionLanding[g] === 1;
  const nativeHome = snap.regionNative[g] === 1;
  const stateText =
    state === 'explored'
      ? 'Explored'
      : state === 'seen'
        ? 'Seen, not explored: next to explored land, so it can be explored'
        : 'Unknown: fogged, not next to explored land';
  const lines: string[] = [stateText];
  if (revealed) {
    lines.push(`Terrain: ${terrain}. Hazard: ${hazard}`);
    lines.push(terrainFlavour(t));
  }
  if (explored) lines.push(findText !== '' ? `Find: ${findText}` : 'Find: none recorded');
  if (landing) {
    lines.push(explored ? 'Landing zone' : 'Landing zone: will be explored on landing');
  }
  if (nativeHome) lines.push('Native home region (natives met)');
  const bits = [regionName(local), revealed ? terrain : 'unknown', state];
  if (landing) bits.push('landing zone');
  if (explored && findText !== '' && findText !== 'Nothing') bits.push(findText);
  if (nativeHome) bits.push('native home');
  return {
    region: local,
    fog,
    name: regionName(local),
    state,
    stateText,
    terrain,
    hazard,
    find: findText,
    landing,
    nativeHome,
    frontier: isFrontier(fog),
    explored,
    summary: bits.join(', '),
    lines,
  };
}
