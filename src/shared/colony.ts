import { ECONOMY } from '../data';
import { PF } from './planetfall';
import { TE, techBonus } from './research';

/**
 * Colony economy tables and pure formulas shared by the sim, the snapshot and the UI (docs/GAME_DESIGN.md
 * sections 7 and 8, D-093 to D-097). Integers only; the numbers are in src/data/economy.json.
 */

export const District = {
  None: 0,
  Farm: 1,
  Mine: 2,
  Refinery: 3,
  Habitat: 4,
  Research: 5,
  Spaceport: 6,
} as const;
export const DISTRICT_KINDS = 7; // None plus the six types

/** Index by district kind (0 = empty region). */
export const DISTRICT_NAMES: readonly string[] = ['Empty', ...ECONOMY.districts.map((d) => d.name)];
export const DISTRICT_COST: readonly number[] = [0, ...ECONOMY.districts.map((d) => d.buildCost)];
export const DISTRICT_DAYS: readonly number[] = [0, ...ECONOMY.districts.map((d) => d.buildDays)];
/** What each district makes, for the panel. */
export const DISTRICT_MAKES: readonly string[] = [
  '',
  'Supplies',
  'Production',
  'Fuel',
  'Housing and some Supplies',
  'Research points',
  'Lets the colony build and launch ships',
];

/** The player may build these with BuildDistrict; the Spaceport has its own command. */
export function isBuildableDistrict(kind: number): boolean {
  return kind >= District.Farm && kind <= District.Research;
}

export const Stance = { Coexist: 0, Defend: 1, PushOut: 2 } as const;
export const STANCE_COUNT = 3;
export const STANCE_NAMES: readonly string[] = ['Coexist', 'Defend', 'Push out'];
export const STANCE_TEXT: readonly string[] = [
  'Live beside the natives. Peaceful natives give a yield bonus; wary ones may calm down. Hostile ones keep raiding.',
  'Guard the colony. Raids are rarer and do less harm; costs Production every day while wary or hostile natives are near; wary natives may turn hostile.',
  'Claim their regions one by one at a cost in colonists. The natives grow angrier.',
];

export const NATIVE_NAMES: readonly string[] = ['None', 'Peaceful', 'Wary', 'Hostile'];

export const E = ECONOMY;
export const STOCK_CAP = ECONOMY.stockCap;

/** Region terrain percent for a district kind (Farm..Research), 100 for the others. */
function terrainPctOf(kind: number, terrain: number): number {
  const t = ECONOMY.terrainPct;
  switch (kind) {
    case District.Farm:
      return t.farm[terrain];
    case District.Mine:
      return t.mine[terrain];
    case District.Refinery:
      return t.refinery[terrain];
    case District.Habitat:
      return t.habitat[terrain];
    case District.Research:
      return t.research[terrain];
    default:
      return 0;
  }
}

function baseOutputOf(kind: number): number {
  const o = ECONOMY.output;
  switch (kind) {
    case District.Farm:
      return o.farmSupplies;
    case District.Mine:
      return o.mineProduction;
    case District.Refinery:
      return o.refineryFuel;
    case District.Habitat:
      return o.habitatSupplies;
    case District.Research:
      return o.researchPoints;
    default:
      return 0;
  }
}

/** Tech percent bonus that scales this district's yield. */
export function districtTechPct(kind: number, techMask: number): number {
  switch (kind) {
    case District.Farm:
      return techBonus(techMask, TE.Farm);
    case District.Mine:
      return techBonus(techMask, TE.Mine);
    case District.Refinery:
      return techBonus(techMask, TE.Refinery);
    case District.Research:
      return techBonus(techMask, TE.Research);
    default:
      return 0;
  }
}

/**
 * Percent of full output the colony's people deliver: colonists share the working districts
 * evenly; `workersFull` of them per district give 100%, never below `minWorkPct`.
 */
export function workPct(population: number, working: number): number {
  if (working <= 0) return 100;
  const p = Math.floor((population * 100) / (working * ECONOMY.workersFull));
  return p > 100 ? 100 : p < ECONOMY.minWorkPct ? ECONOMY.minWorkPct : p;
}

/** Percent modifier for the whole colony: the Struggling penalty and the Coexist bonus. */
export function colonyModPct(penaltyDays: number, coexistBonus: boolean): number {
  const pen = penaltyDays > 0 ? ECONOMY.penaltyOutputPct : 100;
  const bonus = coexistBonus ? 100 + ECONOMY.coexistBonusPct : 100;
  return Math.floor((pen * bonus) / 100);
}

/**
 * One finished district's daily yield: base x terrain x workers x tech x colony modifier, each a
 * percent, floored ONCE on the whole product. The resource is set by the kind (Farm and Habitat:
 * Supplies, Mine: Production, Refinery: Fuel, Research: points; the Spaceport makes nothing).
 */
export function districtOutput(
  kind: number,
  terrain: number,
  work: number,
  techMask: number,
  modPct: number,
): number {
  const base = baseOutputOf(kind);
  if (base === 0) return 0;
  return Math.floor(
    (base * terrainPctOf(kind, terrain) * work * (100 + districtTechPct(kind, techMask)) * modPct) /
      100_000_000,
  );
}

/** Housing: people the colony can hold before growth stops. */
export function housingCap(habitats: number): number {
  return ECONOMY.housing.base + habitats * ECONOMY.housing.perHabitat;
}

/** Supplies the colony eats a day: 1 per person, less the Water Recycling tech (rounded up). */
export function eatPerDay(population: number, techMask: number): number {
  const cut = techBonus(techMask, TE.EatCut);
  return Math.floor((population * (100 - cut) + 99) / 100);
}

/**
 * People born a day: population x rate x room left in housing x tier percent (Failed colonies do
 * not exist; Struggling 100, Thriving more). At least 1 while there is room and the rate is above 0.
 */
export function growthPerDay(population: number, cap: number, tier: number): number {
  const tierPct = ECONOMY.growth.tierPct[tier] ?? 0;
  if (population <= 0 || population >= cap || tierPct === 0 || ECONOMY.growth.permillePerDay === 0)
    return 0;
  const g = Math.floor(
    (population * ECONOMY.growth.permillePerDay * (cap - population) * tierPct) / (cap * 100_000),
  );
  return g < 1 ? 1 : g;
}

/** Raid chance per raid interval in percent: Hostile only, scaled by native strength and the stance. */
export function raidChancePct(disp: number, strength: number, stance: number): number {
  const n = ECONOMY.natives;
  const base = n.raidChancePct[disp] ?? 0;
  if (base === 0) return 0;
  const c = Math.floor(
    (base * n.stanceChancePct[stance] * (PF.natives.strengthBase + strength)) /
      (100 * 2 * PF.natives.strengthBase),
  );
  return c > 95 ? 95 : c;
}

/** Colonists killed by one raid: a share of the colony, by stance, native strength and Native Liaison. */
export function raidHarm(
  population: number,
  strength: number,
  stance: number,
  techMask: number,
): number {
  const n = ECONOMY.natives;
  const cut = techBonus(techMask, TE.RaidCut);
  const h = Math.floor(
    (population *
      n.raidHarmPct *
      n.stanceHarmPct[stance] *
      (PF.natives.strengthBase + strength) *
      (100 - cut)) /
      (100 * 100 * 2 * PF.natives.strengthBase * 100),
  );
  const out = h < 1 ? 1 : h;
  return out > population ? population : out;
}

/** Colonists a Push out step costs, or 0 when the colony is too small to pay it. */
export function pushCost(population: number): number {
  const n = ECONOMY.natives;
  const c = Math.max(n.pushCostMin, Math.floor((population * n.pushCostPct + 99) / 100));
  return population > 3 * c ? c : 0;
}

/** True when a colony counts toward the win: big enough and out of its Struggling penalty. */
export function colonySustains(population: number, penaltyDays: number): boolean {
  return penaltyDays <= 0 && population >= ECONOMY.win.population;
}

export const WIN_COLONIES = ECONOMY.win.colonies;
export const WIN_POPULATION = ECONOMY.win.population;
export const WIN_HOLD_DAYS = ECONOMY.win.holdDays;
export const MIN_LAUNCH_PASSENGERS = ECONOMY.lose.minLaunchPassengers;
export const HOMEWORLD_FLOW = ECONOMY.homeworld;
export const SETTLEMENT = ECONOMY.settlement;
export const FOUNDING_GRANT = ECONOMY.founding;
export const STARVATION = ECONOMY.starvation;

/** Daily Supplies a settlement adds: the flat part plus one per `suppliesPopDivisor` people. */
export function settlementSupplies(population: number): number {
  return SETTLEMENT.supplies + Math.floor(population / SETTLEMENT.suppliesPopDivisor);
}

/** Starter food of a new colony: `starterFoodDays` of eating, capped (D-101). */
export function starterFood(population: number): number {
  const f = population * FOUNDING_GRANT.starterFoodDays;
  return f > FOUNDING_GRANT.starterFoodCap ? FOUNDING_GRANT.starterFoodCap : f;
}

/** Colonists that die in one starving day: a share of the shortfall (rounded up). */
export function starvationDeaths(shortfall: number): number {
  return Math.floor((shortfall * STARVATION.pctPerDay + 99) / 100);
}

/**
 * Days until a colony that is short of food has no people left, counting the grace days still to
 * go, or -1 when the shortfall closes on its own before that (the people shrink to what the
 * supply can feed). `have` is the Supplies available a day (stock plus daily income).
 */
export function daysToExtinction(
  population: number,
  have: number,
  techMask: number,
  hungerDays: number,
): number {
  let p = population;
  let days = hungerDays < STARVATION.graceDays ? STARVATION.graceDays - hungerDays : 0;
  for (let i = 0; i < 100000 && p > 0; i++) {
    const shortfall = eatPerDay(p, techMask) - have;
    if (shortfall <= 0) return -1;
    p -= starvationDeaths(shortfall);
    days++;
  }
  return p > 0 ? -1 : days;
}

/** Smallest population for which a Push out step can happen (see pushCost). */
export function pushMinPopulation(): number {
  let p = 1;
  while (pushCost(p) === 0 && p < 10_000_000) p++;
  return p;
}

/** Run outcome codes as the snapshot carries them (equal to RunOutcome in src/sim/components.ts; tested). */
export const OUTCOME = { Running: 0, Won: 1, LostHomeworld: 2, LostAllDead: 3 } as const;
