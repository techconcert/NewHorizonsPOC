import { TECHS } from '../data';

/**
 * Research tables and pure helpers shared by the sim, the snapshot and the UI (docs/GAME_DESIGN.md
 * section 8, D-092). About 10 techs in three branches; each has exactly one effect and the sim reads
 * the sum of the effects of the known techs (a bit mask, bit i = tech i). Integers only.
 */

/** Effect ids. The index is what the sim passes to techBonus. Equal to TECH_EFFECT_KEYS in validate.ts (tested). */
export const TECH_EFFECTS = [
  'burnCutPct',
  'hullRatingPct',
  'refineryPct',
  'farmPct',
  'eatCutPct',
  'foundingPts',
  'researchPct',
  'surveyPts',
  'minePct',
  'raidCutPct',
] as const;

export const TE = {
  BurnCut: 0,
  HullRating: 1,
  Refinery: 2,
  Farm: 3,
  EatCut: 4,
  Founding: 5,
  Research: 6,
  Survey: 7,
  Mine: 8,
  RaidCut: 9,
} as const;

export const TECH_COUNT = TECHS.techs.length;
export const TECH_BRANCHES: readonly string[] = TECHS.branches;
export const TECH_IDS: readonly string[] = TECHS.techs.map((t) => t.id);
export const TECH_NAMES: readonly string[] = TECHS.techs.map((t) => t.name);
export const TECH_TEXT: readonly string[] = TECHS.techs.map((t) => t.text);
export const TECH_BRANCH: readonly number[] = TECHS.techs.map((t) => t.branch);
export const TECH_COST: readonly number[] = TECHS.techs.map((t) => t.cost);
export const TECH_PREREQ: readonly number[] = TECHS.techs.map((t) => t.prereq);

const EFFECT_OF = new Uint8Array(TECH_COUNT);
const VALUE_OF = new Int32Array(TECH_COUNT);
TECHS.techs.forEach((t, i) => {
  EFFECT_OF[i] = (TECH_EFFECTS as readonly string[]).indexOf(t.effect);
  VALUE_OF[i] = t.value;
});

export function hasTech(mask: number, tech: number): boolean {
  return tech >= 0 && tech < TECH_COUNT && ((mask >>> tech) & 1) === 1;
}

/** Sum of the values of the known techs with this effect (one of TE). No allocation. */
export function techBonus(mask: number, effect: number): number {
  let v = 0;
  for (let i = 0; i < TECH_COUNT; i++) {
    if (((mask >>> i) & 1) === 1 && EFFECT_OF[i] === effect) v += VALUE_OF[i];
  }
  return v;
}

export type TechReject = 'INVALID_TECH' | 'TECH_KNOWN' | 'TECH_LOCKED';

/** Why a tech cannot be chosen now, or null. Order: valid index, not known, prerequisite known. */
export function techRejection(mask: number, tech: number): TechReject | null {
  if (!Number.isInteger(tech) || tech < 0 || tech >= TECH_COUNT) return 'INVALID_TECH';
  if (hasTech(mask, tech)) return 'TECH_KNOWN';
  const pre = TECH_PREREQ[tech];
  if (pre >= 0 && !hasTech(mask, pre)) return 'TECH_LOCKED';
  return null;
}

/** Whole percent of the tech's cost done, 0..100. */
export function techProgressPct(tech: number, progress: number): number {
  if (tech < 0 || tech >= TECH_COUNT) return 0;
  const p = Math.floor((progress * 100) / TECH_COST[tech]);
  return p > 100 ? 100 : p < 0 ? 0 : p;
}

/** Days to finish at `rate` points a day (rounded up), or -1 when nothing is being made. */
export function techDaysLeft(tech: number, progress: number, rate: number): number {
  if (tech < 0 || tech >= TECH_COUNT || rate <= 0) return -1;
  const left = TECH_COST[tech] - progress;
  return left <= 0 ? 0 : Math.floor((left + rate - 1) / rate);
}

export function knownTechCount(mask: number): number {
  let c = 0;
  for (let i = 0; i < TECH_COUNT; i++) if (((mask >>> i) & 1) === 1) c++;
  return c;
}
