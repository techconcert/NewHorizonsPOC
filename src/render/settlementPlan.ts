import { hash32, hashUnit } from './background';
import { FOG_HIDDEN, NATIVE_TINTS } from './hexPalette';

/**
 * What stands on the land besides terrain props (pure, no three.js): district buildings, the
 * colony core, native huts and the small crowd dots. Everything is placed from the snapshot's
 * district rows and a render-local hash of (planet seed, region id); no unit is ever a pick
 * target, these are decoration that mirrors macro state.
 */

export const Model = {
  Farm: 0,
  Mine: 1,
  Refinery: 2,
  Habitat: 3,
  Research: 4,
  Spaceport: 5,
  Core: 6,
  Hut: 7,
  Dot: 8,
} as const;
export const MODEL_COUNT = 9;
export const SITE_CAPACITY = 320;

/** District kind ids (shared/colony.ts District) are 1..6 and map to models 0..5. */
export const DISTRICT_KIND_MAX = 6;
/** A district still under construction is drawn this much smaller and greyed. */
export const BUILDING_SCALE = 0.55;
export const BUILDING_TINT = 0xa8a8a8;
export const COLONIST_TINT = 0xfff1d0;

export interface SiteList {
  count: number;
  model: Uint8Array;
  region: Uint8Array;
  x: Float32Array;
  z: Float32Array;
  scale: Float32Array;
  rot: Float32Array;
  tint: Int32Array;
}

export function createSiteList(capacity: number): SiteList {
  return {
    count: 0,
    model: new Uint8Array(capacity),
    region: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    z: new Float32Array(capacity),
    scale: new Float32Array(capacity),
    rot: new Float32Array(capacity),
    tint: new Int32Array(capacity),
  };
}

export interface SiteInput {
  count: number;
  fog: ArrayLike<number>;
  /** 1 on a native home region once the natives have been met. */
  native: ArrayLike<number>;
  /** Native disposition 1 Peaceful, 2 Wary, 3 Hostile; 0 until contact. */
  nativeKind: number;
  /** District kind per region (0 none) and build days left. */
  district: ArrayLike<number>;
  districtLeft: ArrayLike<number>;
  /** Region of the colony core, or -1. */
  colonyRegion: number;
  /** Crowd dots to scatter round the core. */
  colonyDots: number;
}

function add(
  out: SiteList,
  model: number,
  region: number,
  x: number,
  z: number,
  scale: number,
  rot: number,
  tint: number,
): void {
  if (out.count >= out.model.length) return;
  const o = out.count++;
  out.model[o] = model;
  out.region[o] = region;
  out.x[o] = x;
  out.z[o] = z;
  out.scale[o] = scale;
  out.rot[o] = rot;
  out.tint[o] = tint;
}

/** Number of colonist dots for a population (0 for none, at most 12). */
export function colonistDots(population: number): number {
  if (population <= 0) return 0;
  const n = 2 + Math.floor(population / 64);
  return n > 12 ? 12 : n;
}

/** Fill `out` from the input. Regions that are hidden get nothing (no leaks through the fog). */
export function planSites(planetSeed: number, inp: SiteInput, out: SiteList): void {
  out.count = 0;
  for (let i = 0; i < inp.count; i++) {
    if (inp.fog[i] === FOG_HIDDEN) continue;
    const seed = hash32(planetSeed, i, 0x7a11c0de);
    const kind = inp.district[i];
    const building = inp.districtLeft[i] > 0;
    const core = i === inp.colonyRegion;
    const hasDistrict = kind >= 1 && kind <= DISTRICT_KIND_MAX;
    if (hasDistrict) {
      const s = building ? BUILDING_SCALE : core ? 0.75 : 1;
      const dx = core ? 0.26 : 0;
      const dz = core ? 0.14 : 0;
      add(out, kind - 1, i, dx, dz, s, core ? -0.4 : 0, building ? BUILDING_TINT : 0xffffff);
    }
    if (core) {
      const off = hasDistrict ? -0.3 : 0;
      add(out, Model.Core, i, off, hasDistrict ? -0.14 : 0, hasDistrict ? 0.8 : 1, 0, 0xffffff);
      const dots = inp.colonyDots;
      for (let j = 0; j < dots; j++) {
        const ang = ((j + hashUnit(seed, 20 + j, 2) * 0.8) / dots) * Math.PI * 2;
        const rad = 0.55 + 0.15 * hashUnit(seed, 40 + j, 3);
        add(
          out,
          Model.Dot,
          i,
          Math.cos(ang) * rad,
          Math.sin(ang) * rad,
          0.9 + 0.2 * hashUnit(seed, 60 + j, 4),
          0,
          COLONIST_TINT,
        );
      }
    }
    if (inp.native[i] === 1 && inp.nativeKind > 0 && !hasDistrict) {
      const tint = NATIVE_TINTS[inp.nativeKind] ?? 0xffffff;
      const huts = 3 + Math.floor(hashUnit(seed, 5, 5) * 3);
      for (let j = 0; j < huts; j++) {
        const ang = ((j + hashUnit(seed, 80 + j, 6) * 0.6) / huts) * Math.PI * 2;
        const rad = 0.22 + 0.2 * hashUnit(seed, 100 + j, 7);
        add(
          out,
          Model.Hut,
          i,
          Math.cos(ang) * rad,
          Math.sin(ang) * rad,
          0.85 + 0.3 * hashUnit(seed, 120 + j, 8),
          hashUnit(seed, 140 + j, 9) * Math.PI * 2,
          tint,
        );
      }
      const dots = 2 + Math.floor(hashUnit(seed, 6, 5) * 3);
      for (let j = 0; j < dots; j++) {
        const ang = hashUnit(seed, 160 + j, 10) * Math.PI * 2;
        const rad = 0.5 + 0.18 * hashUnit(seed, 180 + j, 11);
        add(out, Model.Dot, i, Math.cos(ang) * rad, Math.sin(ang) * rad, 1, 0, tint);
      }
    }
  }
}
