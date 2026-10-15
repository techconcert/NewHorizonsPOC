import { FOG_EXPLORED } from '../shared/fog';

/**
 * Which markers the planet view draws, as index lists (pure, no three.js). Finds appear only on
 * explored regions, the native marker only once contact is made, the landing zone is always
 * known, and one marker is drawn per expedition team.
 */

export const MARKER_CAPACITY = 24;

export interface MarkerInput {
  count: number;
  fog: ArrayLike<number>;
  find: ArrayLike<number>;
  landing: ArrayLike<number>;
  native: ArrayLike<number>;
  /** True once the natives have been met (the snapshot's planetNative > 0). */
  nativeMet: boolean;
  /** Find kind id that is never drawn ('nothing'), or -1. */
  noneFind: number;
  /** Local region of the colony on this planet, or -1. */
  colonyRegion: number;
  /** Regions the expedition teams stand on (-1 entries are skipped), `teamCount` of them. */
  teams: ArrayLike<number>;
  teamCount: number;
}

export interface MarkerLists {
  finds: Int16Array;
  findKinds: Uint8Array;
  findCount: number;
  natives: Int16Array;
  nativeCount: number;
  landing: Int16Array;
  landingCount: number;
  teams: Int16Array;
  teamCount: number;
  colony: Int16Array;
  colonyCount: number;
}

export function createMarkerLists(): MarkerLists {
  return {
    finds: new Int16Array(MARKER_CAPACITY),
    findKinds: new Uint8Array(MARKER_CAPACITY),
    findCount: 0,
    natives: new Int16Array(MARKER_CAPACITY),
    nativeCount: 0,
    landing: new Int16Array(MARKER_CAPACITY),
    landingCount: 0,
    teams: new Int16Array(MARKER_CAPACITY),
    teamCount: 0,
    colony: new Int16Array(4),
    colonyCount: 0,
  };
}

/** Fill `out` from the input. No allocation. */
export function planMarkers(input: MarkerInput, out: MarkerLists): void {
  out.findCount = 0;
  out.nativeCount = 0;
  out.landingCount = 0;
  out.teamCount = 0;
  out.colonyCount = 0;
  const n = input.count < MARKER_CAPACITY ? input.count : MARKER_CAPACITY;
  for (let i = 0; i < n; i++) {
    const f = input.find[i];
    if (input.fog[i] === FOG_EXPLORED && f >= 0 && f < 255 && f !== input.noneFind) {
      out.finds[out.findCount] = i;
      out.findKinds[out.findCount] = f;
      out.findCount++;
    }
    if (input.nativeMet && input.native[i] === 1) out.natives[out.nativeCount++] = i;
    if (input.landing[i] === 1) out.landing[out.landingCount++] = i;
  }
  for (let t = 0; t < input.teamCount && out.teamCount < MARKER_CAPACITY; t++) {
    const r = input.teams[t];
    if (r >= 0 && r < input.count) out.teams[out.teamCount++] = r;
  }
  if (input.colonyRegion >= 0 && input.colonyRegion < input.count) {
    out.colony[out.colonyCount++] = input.colonyRegion;
  }
}

/**
 * Regions the teams of an expedition stand on: while a round is out the target regions (team A,
 * and team B or a Bold team's second region), else the region it last worked in. Writes into
 * `out` from `at` and returns the new length. Expeditions that are over have no team.
 */
export function teamRegions(
  live: boolean,
  target: number,
  target2: number,
  lastRegion: number,
  out: Int16Array,
  at: number,
): number {
  if (!live || at >= out.length) return at;
  if (target >= 0) {
    out[at++] = target;
    if (target2 >= 0 && at < out.length) out[at++] = target2;
  } else if (lastRegion >= 0) {
    out[at++] = lastRegion;
  }
  return at;
}
