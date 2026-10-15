import { MIN_REGIONS_PER_PLANET_LIMIT, MAX_REGIONS_PER_PLANET_LIMIT } from '../data';
import type { Content } from './content';
import {
  G_REGION,
  RNG_REGION_GEN,
  RegionFlag,
  Survey,
  Terrain,
  type Stores,
  Disposition,
  PlanetFlag,
} from './components';
import { mix32, nextInt, seedSlot } from './rng';

/** Axial hex neighbour offsets. */
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];

/**
 * Generate the hex region map of one planet (7 to 19 regions, axial coordinates), appending to
 * the region store. Depends only on (seed, planet index), so planets generate independently.
 */
export function generateRegions(s: Stores, c: Content, seed: number, planet: number): void {
  const rng = s.rng;
  const slot = RNG_REGION_GEN;
  seedSlot(rng, slot, mix32(seed ^ mix32(planet + 0x5eed)));

  const p = s.planet;
  const reg = s.region;
  const n = nextInt(rng, slot, MIN_REGIONS_PER_PLANET_LIMIT, MAX_REGIONS_PER_PLANET_LIMIT);
  const start = s.counts[G_REGION];
  p.regionStart[planet] = start;
  p.regionCount[planet] = n;

  // Grow a connected blob: pick uniformly among (hex, direction) pairs leading to a free cell.
  reg.q[start] = 0;
  reg.r[start] = 0;
  let filled = 1;
  while (filled < n) {
    let cand = 0;
    for (let i = 0; i < filled; i++) {
      for (let d = 0; d < 6; d++) {
        if (!occupied(s, start, filled, reg.q[start + i] + DQ[d], reg.r[start + i] + DR[d])) cand++;
      }
    }
    let k = nextInt(rng, slot, 0, cand - 1);
    let placed = false;
    for (let i = 0; i < filled && !placed; i++) {
      for (let d = 0; d < 6; d++) {
        const nq = reg.q[start + i] + DQ[d];
        const nr = reg.r[start + i] + DR[d];
        if (occupied(s, start, filled, nq, nr)) continue;
        if (k === 0) {
          reg.q[start + filled] = nq;
          reg.r[start + filled] = nr;
          filled++;
          placed = true;
          break;
        }
        k--;
      }
    }
  }

  // Terrain from the planet type's weights.
  const type = p.planetType[planet];
  const tc = c.terrainCount;
  for (let i = 0; i < n; i++) {
    const roll = nextInt(rng, slot, 0, 99);
    let acc = 0;
    let terrain = tc - 1;
    for (let t = 0; t < tc; t++) {
      acc += c.planetTypeTerrainWeights[type * tc + t];
      if (roll < acc) {
        terrain = t;
        break;
      }
    }
    reg.terrain[start + i] = terrain;
    reg.flags[start + i] = 0;
    reg.fog[start + i] = 0;
  }

  // One landing zone (always Plains), the only region visible at first.
  const lz = nextInt(rng, slot, 0, n - 1);
  reg.terrain[start + lz] = Terrain.Plains;
  reg.flags[start + lz] = RegionFlag.LandingZone;
  reg.fog[start + lz] = Survey.Scanned;

  // Native home regions (hidden until contact).
  if (s.native.disposition[planet] !== Disposition.None) {
    let mask = 0;
    for (let i = 0; i < n; i++) {
      if (i !== lz && nextInt(rng, slot, 0, 99) < 40) mask |= 1 << i;
    }
    if (mask === 0) mask = 1 << (lz === 0 ? 1 : 0);
    s.native.homeRegionMask[planet] = mask >>> 0;
  }

  if ((p.flags[planet] & PlanetFlag.Homeworld) !== 0) {
    for (let i = 0; i < n; i++) reg.fog[start + i] = Survey.Explored;
  }

  s.counts[G_REGION] = start + n;
}

function occupied(s: Stores, start: number, filled: number, q: number, r: number): boolean {
  for (let i = 0; i < filled; i++) {
    if (s.region.q[start + i] === q && s.region.r[start + i] === r) return true;
  }
  return false;
}
