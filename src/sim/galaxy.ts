import type { Content } from './content';
import {
  Disposition,
  FP_SCALE,
  G_PLANET,
  G_REGION,
  G_SYSTEM,
  GALAXY_SIZE_FP,
  MAX_PLANETS_PER_SYSTEM,
  PlanetFlag,
  RNG_GALAXY_GEN,
  STAR_TYPE_COUNT,
  Survey,
  type Stores,
} from './components';
import { pickNativeVariant, variantStrength } from '../shared/planetfall';
import { generateRegions } from './regions';
import { nextInt, seedSlot } from './rng';

export const MIN_SYSTEMS = 30;
export const MAX_SYSTEMS_GENERATED = 60;
/** Minimum spacing between systems, in world units. */
const MIN_SPACING_UNITS = 70;
const MARGIN_UNITS = 40;

/** Base route hazard (0 to 100) per star type; PLACEHOLDER values. */
const STAR_HAZARD = [10, 20, 25, 40, 60];

/**
 * Planet type candidates per habitability band (indices into planetTypes.json:
 * 0 temperate, 1 arid, 2 jungle, 3 frozen, 4 barren, 5 ancient).
 */
const TYPES_HIGH = [0, 0, 2, 5];
const TYPES_MID = [0, 1, 2, 3, 5];
const TYPES_LOW = [1, 3, 4, 4, 5];

/** Natives: presence chance and disposition mix (percent). PLACEHOLDERS, see BALANCE.md. */
const NATIVE_CHANCE = 30;
const PEACEFUL_UNDER = 40;
const WARY_UNDER = 75;

function pick(list: number[], roll: number): number {
  return list[roll % list.length];
}

/**
 * Seeded galaxy generator. Integer fixed-point grid, no trig. Fills systems, planets, natives
 * and region maps. System 0 holds planet 0, the homeworld. Outside the tick, so it may allocate.
 */
export function generateGalaxy(s: Stores, c: Content, seed: number): void {
  const rng = s.rng;
  const slot = RNG_GALAXY_GEN;
  seedSlot(rng, slot, seed);

  const sys = s.system;
  const pl = s.planet;
  const nSys = nextInt(rng, slot, MIN_SYSTEMS, MAX_SYSTEMS_GENERATED);
  const minD2 = MIN_SPACING_UNITS * FP_SCALE * (MIN_SPACING_UNITS * FP_SCALE);
  const margin = MARGIN_UNITS * FP_SCALE;
  let planets = 0;

  for (let i = 0; i < nSys; i++) {
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 64; attempt++) {
      if (i === 0) {
        x = nextInt(rng, slot, Math.floor(GALAXY_SIZE_FP * 0.4), Math.floor(GALAXY_SIZE_FP * 0.6));
        y = nextInt(rng, slot, Math.floor(GALAXY_SIZE_FP * 0.4), Math.floor(GALAXY_SIZE_FP * 0.6));
        break;
      }
      x = nextInt(rng, slot, margin, GALAXY_SIZE_FP - margin);
      y = nextInt(rng, slot, margin, GALAXY_SIZE_FP - margin);
      let ok = true;
      for (let j = 0; j < i; j++) {
        const dx = x - sys.x[j];
        const dy = y - sys.y[j];
        if (dx * dx + dy * dy < minD2) {
          ok = false;
          break;
        }
      }
      if (ok) break;
    }
    sys.x[i] = x;
    sys.y[i] = y;
    const star = nextInt(rng, slot, 0, STAR_TYPE_COUNT - 1);
    sys.starType[i] = star;
    sys.hazard[i] = Math.min(100, STAR_HAZARD[star] + nextInt(rng, slot, 0, 20));
    const nPlanets = nextInt(rng, slot, 1, MAX_PLANETS_PER_SYSTEM);
    sys.planetStart[i] = planets;
    sys.planetCount[i] = nPlanets;

    for (let k = 0; k < nPlanets; k++) {
      const p = planets + k;
      pl.system[p] = i;
      pl.owner[p] = -1;
      pl.survey[p] = Survey.Unknown;
      if (i === 0 && k === 0) {
        // The homeworld: habitable, safe, no natives.
        pl.flags[p] = PlanetFlag.Homeworld;
        pl.habitability[p] = nextInt(rng, slot, 90, 100);
        pl.hazard[p] = nextInt(rng, slot, 0, 10);
        pl.richness[p] = nextInt(rng, slot, 40, 60);
        pl.planetType[p] = 0;
        pl.survey[p] = Survey.Explored;
        pl.nativePresence[p] = 0;
        continue;
      }
      const hab = (nextInt(rng, slot, 0, 100) + nextInt(rng, slot, 0, 100)) >> 1;
      pl.habitability[p] = hab;
      pl.hazard[p] = nextInt(rng, slot, 0, 100);
      pl.richness[p] = nextInt(rng, slot, 0, 100);
      const band = hab >= 70 ? TYPES_HIGH : hab >= 40 ? TYPES_MID : TYPES_LOW;
      pl.planetType[p] = pick(band, nextInt(rng, slot, 0, 99)) % c.planetTypeCount;
      if (i !== 0 && nextInt(rng, slot, 0, 99) < NATIVE_CHANCE) {
        pl.nativePresence[p] = 1;
        const roll = nextInt(rng, slot, 0, 99);
        const disp =
          roll < PEACEFUL_UNDER
            ? Disposition.Peaceful
            : roll < WARY_UNDER
              ? Disposition.Wary
              : Disposition.Hostile;
        s.native.disposition[p] = disp;
        const rawStrength = nextInt(rng, slot, 10, 90);
        const variant = pickNativeVariant(disp, rawStrength);
        s.native.variant[p] = variant;
        s.native.strength[p] = variantStrength(variant, rawStrength);
        s.native.revealed[p] = 0;
      }
    }
    planets += nPlanets;
    s.counts[G_SYSTEM] = i + 1;
    s.counts[G_PLANET] = planets;
  }

  s.counts[G_REGION] = 0;
  for (let p = 0; p < planets; p++) generateRegions(s, c, seed, p);
}

/** Planet index of the homeworld. */
export function findHomeworld(s: Stores): number {
  const n = s.counts[G_PLANET];
  for (let p = 0; p < n; p++) {
    if ((s.planet.flags[p] & PlanetFlag.Homeworld) !== 0) return p;
  }
  return -1;
}

/** Distance between systems in fixed-point grid units (sqrt of an exact integer sum). */
export function systemDistanceFp(s: Stores, a: number, b: number): number {
  const dx = s.system.x[a] - s.system.x[b];
  const dy = s.system.y[a] - s.system.y[b];
  return Math.sqrt(dx * dx + dy * dy);
}
