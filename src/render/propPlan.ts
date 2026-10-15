import { hash32, hashUnit } from './background';
import { BEVEL, INNER_RADIUS, OUTER_RADIUS } from './terrainMesh';

/**
 * Deterministic prop placement for the planet view (pure, no three.js). Every number comes from a
 * render-local integer hash of (planet seed, region id), never Math.random and never the sim RNG,
 * so a planet looks the same every time it is opened and each region's props never change when
 * another region is revealed. Positions are offsets from the hex centre in hex units.
 */

export const PropKind = {
  Pine: 0,
  Round: 1,
  Rock: 2,
  Crystal: 3,
  Pillar: 4,
  Slab: 5,
  Tuft: 6,
} as const;
export const PROP_KINDS = 7;
/** At most this many props in one region (the table below stays far under it). */
export const PROP_REGION_MAX = 32;
/** Props stay this far from the hex centre, so they never cross the bevel. */
export const PROP_MAX_RADIUS = 0.74;

interface Entry {
  kind: number;
  min: number;
  max: number;
  /** Base size multiplier. */
  size: number;
}

/** Per terrain id (plains, highlands, jungle, ice, crater, ruins): what grows or lies there. */
const TABLE: readonly (readonly Entry[])[] = [
  [
    { kind: PropKind.Tuft, min: 9, max: 14, size: 1 },
    { kind: PropKind.Round, min: 1, max: 3, size: 0.9 },
    { kind: PropKind.Rock, min: 0, max: 1, size: 0.7 },
  ],
  [
    { kind: PropKind.Rock, min: 3, max: 5, size: 1.1 },
    { kind: PropKind.Pine, min: 2, max: 4, size: 1 },
    { kind: PropKind.Tuft, min: 3, max: 5, size: 0.9 },
  ],
  [
    { kind: PropKind.Round, min: 6, max: 9, size: 1.15 },
    { kind: PropKind.Tuft, min: 4, max: 6, size: 1.1 },
  ],
  [
    { kind: PropKind.Crystal, min: 3, max: 5, size: 1 },
    { kind: PropKind.Rock, min: 1, max: 2, size: 0.8 },
  ],
  [
    { kind: PropKind.Rock, min: 4, max: 6, size: 1 },
    { kind: PropKind.Crystal, min: 1, max: 3, size: 0.8 },
  ],
  [
    { kind: PropKind.Pillar, min: 3, max: 5, size: 1 },
    { kind: PropKind.Slab, min: 3, max: 5, size: 1 },
    { kind: PropKind.Rock, min: 0, max: 2, size: 0.7 },
  ],
];

/** Per terrain and prop kind: 0xRRGGBB multiplier applied through the instance colour. */
export const PROP_TINTS: readonly (readonly number[])[] = [
  // Pine, Round, Rock, Crystal, Pillar, Slab, Tuft
  [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff], // plains
  [0xd8f0d8, 0xffffff, 0xe8d8c0, 0xffffff, 0xffffff, 0xffffff, 0xd8e8b0], // highlands
  [0xffffff, 0xa8ffc0, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xb8ffd0], // jungle
  [0xffffff, 0xffffff, 0xf2f8ff, 0xbfe8ff, 0xffffff, 0xffffff, 0xffffff], // ice
  [0xffffff, 0xffffff, 0xd0c8d8, 0xe08cff, 0xffffff, 0xffffff, 0xffffff], // crater
  [0xffffff, 0xffffff, 0xe0d4b8, 0xffffff, 0xffffff, 0xffffff, 0xffffff], // ruins
];

export interface PropList {
  capacity: number;
  count: number;
  kind: Uint8Array;
  region: Uint8Array;
  terrain: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  rot: Float32Array;
  /** Brightness variation, 0.85 .. 1.15. */
  shade: Float32Array;
}

export function createPropList(capacity: number): PropList {
  return {
    capacity,
    count: 0,
    kind: new Uint8Array(capacity),
    region: new Uint8Array(capacity),
    terrain: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    scale: new Float32Array(capacity),
    rot: new Float32Array(capacity),
    shade: new Float32Array(capacity),
  };
}

/** The render-local seed of one region. */
export function regionSeed(planetSeed: number, regionId: number): number {
  return hash32(planetSeed, regionId, 0x51ed270b);
}

/** Props the table gives a terrain in a region at full density (all entries). */
export function propCountFor(planetSeed: number, regionId: number, terrain: number): number {
  const table = TABLE[terrain];
  if (!table) return 0;
  const seed = regionSeed(planetSeed, regionId);
  let n = 0;
  for (let e = 0; e < table.length; e++) n += entryCount(seed, e, table[e]);
  return n;
}

function entryCount(seed: number, e: number, entry: Entry): number {
  return entry.min + Math.floor(hashUnit(seed, 0, e + 1) * (entry.max - entry.min + 1));
}

/**
 * Append the props of one region to `out`. `densityPct` thins them (100 explored, less for
 * visible ground); the first props of each entry are the same at any density, so more appear as
 * the land is explored and none move. `clearR` keeps a disc free in the middle for a building.
 * A terrain id outside the table (a hidden region) adds nothing.
 */
export function planRegionProps(
  planetSeed: number,
  regionId: number,
  terrain: number,
  densityPct: number,
  clearR: number,
  out: PropList,
): void {
  const table = TABLE[terrain];
  if (!table || clearR >= PROP_MAX_RADIUS) return;
  const seed = regionSeed(planetSeed, regionId);
  for (let e = 0; e < table.length; e++) {
    const entry = table[e];
    const full = entryCount(seed, e, entry);
    const n = Math.floor((full * densityPct + 50) / 100);
    const phase = hashUnit(seed, 1, e + 1);
    for (let j = 0; j < n; j++) {
      if (out.count >= out.capacity) return;
      const key = (j + 1) * 8;
      // Even spread in angle (jittered), random distance from the middle.
      const ang = ((j + hashUnit(seed, key, e + 1) * 0.8) / full + phase) * Math.PI * 2;
      const rad = clearR + Math.sqrt(hashUnit(seed, key + 1, e + 1)) * (PROP_MAX_RADIUS - clearR);
      const o = out.count++;
      out.kind[o] = entry.kind;
      out.region[o] = regionId;
      out.terrain[o] = terrain;
      out.x[o] = Math.cos(ang) * rad;
      out.z[o] = Math.sin(ang) * rad;
      out.scale[o] = entry.size * (0.8 + 0.5 * hashUnit(seed, key + 2, e + 1));
      out.rot[o] = hashUnit(seed, key + 3, e + 1) * Math.PI * 2;
      out.shade[o] = 0.85 + 0.3 * hashUnit(seed, key + 4, e + 1);
    }
  }
}

/**
 * Height of the tile surface above the tile top at distance `rad` (hex units) from the centre:
 * the centre lift fades linearly to the rim of the flat inner ring, then the bevel drops away.
 */
export function surfaceOffset(rad: number, lift: number): number {
  if (rad <= INNER_RADIUS) return lift * (1 - rad / INNER_RADIUS);
  const t = Math.min(1, (rad - INNER_RADIUS) / (OUTER_RADIUS - INNER_RADIUS));
  return -BEVEL * t;
}

/**
 * Write a column-major 4x4 matrix for a uniform scale, a turn about Y and a move to (x, y, z)
 * into `arr` at instance `n` (16 floats per instance).
 */
export function writeInstanceMatrix(
  arr: Float32Array,
  n: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  rotY: number,
): void {
  const b = n * 16;
  const c = Math.cos(rotY) * scale;
  const s = Math.sin(rotY) * scale;
  arr[b] = c;
  arr[b + 1] = 0;
  arr[b + 2] = -s;
  arr[b + 3] = 0;
  arr[b + 4] = 0;
  arr[b + 5] = scale;
  arr[b + 6] = 0;
  arr[b + 7] = 0;
  arr[b + 8] = s;
  arr[b + 9] = 0;
  arr[b + 10] = c;
  arr[b + 11] = 0;
  arr[b + 12] = x;
  arr[b + 13] = y;
  arr[b + 14] = z;
  arr[b + 15] = 1;
}
