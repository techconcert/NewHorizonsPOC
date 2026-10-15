import type { FormExpeditionCommand } from '../shared/commands';
import {
  exploreKitPct,
  hazardChancePct,
  nativesExplorePct,
  PF,
  STANCE_COUNT,
  STANCE_NAMES,
  stanceRegionsPerRound,
  stanceRoundDays,
  stanceSuccessPct,
  teamSizePct,
  explorationChancePct,
} from '../shared/planetfall';
import { isParkedState } from '../shared/planetSnapshot';
import type { Snapshot } from '../shared/snapshot';
import { explorationBreakdown, type BreakdownRow } from './rollModel';

/**
 * Pure model of the expedition formation panel: the five choices (explorers, guards, supplies,
 * kit, stance), clamped to what the ship carries, and the live exploration chance with every
 * factor shown. The terrain is not known for the first target, so the base is a range over the
 * six terrains and the chance is shown as the range it gives. Nothing here touches the DOM.
 */

export interface FormationLimits {
  /** True when the ship is waiting in orbit (FormExpedition needs an Arrived ship). */
  ready: boolean;
  /** The planet already holds a colony. */
  planetOwned: boolean;
  colonists: number;
  security: number;
  supplies: number;
  kit: number;
  fuel: number;
}

export function formationLimitsOf(
  snap: Snapshot,
  shipRow: number,
  planetOwned: boolean,
): FormationLimits {
  if (shipRow < 0) {
    return { ready: false, planetOwned, colonists: 0, security: 0, supplies: 0, kit: 0, fuel: 0 };
  }
  return {
    ready: isParkedState(snap.shipState[shipRow]),
    planetOwned,
    colonists: snap.shipColonists[shipRow],
    security: snap.shipSecurity[shipRow],
    supplies: snap.shipSupplies[shipRow],
    kit: snap.shipKit[shipRow],
    fuel: snap.shipFuel[shipRow],
  };
}

export interface FormationState {
  /** Ship entity these values belong to; a different ship resets them. */
  ship: number;
  explorers: number;
  guards: number;
  supplies: number;
  kit: number;
  stance: number;
}

export function createFormationState(): FormationState {
  return { ship: -1, explorers: 0, guards: 0, supplies: 0, kit: 0, stance: 1 };
}

/** Days of food per head the default sends down. */
export const DEFAULT_FOOD_DAYS = 40;

/** Sensible defaults: a full-size team, all escort and kit, 40 days of food, Balanced. */
export function resetFormation(st: FormationState, limits: FormationLimits, ship: number): void {
  st.ship = ship;
  st.explorers = Math.min(limits.colonists, PF.team.fullExplorers);
  st.guards = limits.security;
  st.supplies = Math.min(limits.supplies, st.explorers * DEFAULT_FOOD_DAYS);
  st.kit = limits.kit;
  st.stance = 1;
}

function clampInt(v: number, lo: number, hi: number): number {
  const n = Number.isFinite(v) ? Math.floor(v) : lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/** Keep every value inside what the ship carries (it changes with re-embark and events). */
export function clampFormation(st: FormationState, limits: FormationLimits): void {
  st.explorers = clampInt(st.explorers, limits.colonists > 0 ? 1 : 0, limits.colonists);
  st.guards = clampInt(st.guards, 0, limits.security);
  st.supplies = clampInt(st.supplies, 0, limits.supplies);
  st.kit = clampInt(st.kit, 0, limits.kit);
  st.stance = clampInt(st.stance, 0, STANCE_COUNT - 1);
}

/** Switch to `ship` (reset to defaults) or, for the same ship, re-clamp. */
export function syncFormation(st: FormationState, limits: FormationLimits, ship: number): void {
  if (st.ship !== ship) resetFormation(st, limits, ship);
  else clampFormation(st, limits);
}

export type FoodCue = 'LOW' | 'OK' | 'GOOD';

/** Days of food per head against the round length: under one round LOW, under three OK. */
export function foodCue(days: number, stance: number): FoodCue {
  const round = stanceRoundDays(stance);
  return days < round ? 'LOW' : days < 3 * round ? 'OK' : 'GOOD';
}

export interface FormationView {
  rows: BreakdownRow[];
  chanceLo: number;
  chanceHi: number;
  chanceText: string;
  stanceText: string;
  hazardText: string;
  foodDays: number;
  foodText: string;
  foodCue: FoodCue;
  depotText: string;
  nativesText: string;
  /** Why Form cannot be pressed, or null. */
  problem: string | null;
  command: FormExpeditionCommand | null;
}

function range(lo: number, hi: number, unit = '%'): string {
  return lo === hi ? `${lo}${unit}` : `${lo} to ${hi}${unit}`;
}

/**
 * Natives factor for the first exploration: guides once met and Peaceful (the landing zone is
 * never a native home); neutral otherwise. `disp` is the snapshot's planetNative (0 until met).
 */
export function formationNativesPct(disp: number): number {
  return disp > 0 ? nativesExplorePct(disp, true, false) : 100;
}

export function buildFormationView(
  st: FormationState,
  limits: FormationLimits,
  nativeDisp: number,
  shipEntity: number,
): FormationView {
  const team = teamSizePct(st.explorers);
  const kit = exploreKitPct(st.kit);
  const stance = stanceSuccessPct(st.stance);
  const natives = formationNativesPct(nativeDisp);
  let minBase = 101;
  let maxBase = -1;
  for (const b of PF.terrainExploreBasePct) {
    if (b < minBase) minBase = b;
    if (b > maxBase) maxBase = b;
  }
  const info = {
    terrain: 'varies by region',
    explorers: st.explorers,
    kitSteps: st.kit,
    stance: st.stance,
    nativesNote: nativeDisp > 0 ? 'natives met' : 'unknown until contact',
  };
  const lo = explorationBreakdown(minBase, team, kit, stance, natives, info);
  const hi = explorationBreakdown(maxBase, team, kit, stance, natives, info);
  const rows: BreakdownRow[] = lo.rows.map((r, i) => {
    const h = hi.rows[i];
    return {
      label: r.label,
      value: r.value === h.value ? r.value : `${minBase} to ${maxBase}%`,
      running: r.running === h.running ? r.running : `${r.running} to ${h.running}`,
      note: r.note,
    };
  });
  const foodDays = st.explorers > 0 ? Math.floor(st.supplies / st.explorers) : 0;
  const cue = foodCue(foodDays, st.stance);
  const h1 = hazardChancePct(1, st.stance, false);
  const h2 = hazardChancePct(2, st.stance, false);
  const h3 = hazardChancePct(3, st.stance, false);
  const regions = stanceRegionsPerRound(st.stance);
  let problem: string | null = null;
  if (!limits.ready) problem = 'The ship is not in orbit at the planet.';
  else if (limits.planetOwned) problem = 'A colony already holds this planet.';
  else if (limits.colonists < 1) problem = 'The ship carries no colonists to send down.';
  else if (st.explorers < 1) problem = 'Send at least one explorer.';
  const command: FormExpeditionCommand | null =
    problem === null
      ? {
          type: 'FormExpedition',
          ship: shipEntity,
          explorers: st.explorers,
          guards: st.guards,
          supplies: st.supplies,
          kit: st.kit,
          stance: st.stance,
        }
      : null;
  return {
    rows,
    chanceLo: lo.chance,
    chanceHi: hi.chance,
    chanceText: `${range(lo.chance, hi.chance)} per region (clamped to ${PF.successMinPct}..${PF.successMaxPct}%)`,
    stanceText: `${STANCE_NAMES[st.stance]}: ${stanceRoundDays(st.stance)} days per round, ${regions} ${regions === 1 ? 'region' : 'regions'} per round`,
    hazardText: `Hazard per region: Low ${h1}%, Medium ${h2}%, High ${h3}% (injury, death or lost supplies)`,
    foodDays,
    foodText: `${foodDays} days of food per head on the ground [${cue}]`,
    foodCue: cue,
    depotText: `Stays aboard: ${Math.max(0, limits.colonists - st.explorers)} colonists, ${Math.max(0, limits.supplies - st.supplies)} supplies, ${Math.max(0, limits.security - st.guards)} escort, ${Math.max(0, limits.kit - st.kit)} kits, ${limits.fuel} fuel. The ship keeps feeding its colonists.`,
    nativesText:
      nativeDisp > 0 ? 'Natives have been met on this planet.' : 'No contact with natives yet.',
    problem,
    command,
  };
}

/** Chance range of the first exploration for tests and tooltips: lowest and highest terrain. */
export function formationChanceRange(
  explorers: number,
  kitSteps: number,
  stance: number,
  natives: number,
): { lo: number; hi: number } {
  const team = teamSizePct(explorers);
  const kit = exploreKitPct(kitSteps);
  const sp = stanceSuccessPct(stance);
  let lo = 101;
  let hi = -1;
  for (const b of PF.terrainExploreBasePct) {
    const c = explorationChancePct(b, team, kit, sp, natives);
    if (c < lo) lo = c;
    if (c > hi) hi = c;
  }
  return { lo, hi };
}
