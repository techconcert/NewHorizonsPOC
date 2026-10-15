import type {
  BuildDistrictCommand,
  BuildSpaceportCommand,
  ColonyRejectReason,
  SetColonyStanceCommand,
} from '../shared/commands';
import {
  colonyModPct,
  District,
  DISTRICT_COST,
  DISTRICT_DAYS,
  districtOutput,
  eatPerDay,
  growthPerDay,
  housingCap,
  HOMEWORLD_FLOW,
  isBuildableDistrict,
  settlementSupplies,
  SETTLEMENT,
  STANCE_COUNT,
  Stance,
  starvationDeaths,
  STARVATION,
  STOCK_CAP,
  workPct,
} from '../shared/colony';
import { Disp } from '../shared/planetfall';
import { G_ENTITY, MAX_REGIONS_PER_PLANET } from './components';
import { isColony } from './launch';
import { effectiveDisposition, FOG_EXPLORED, inNativeHome } from './planet';
import type { World } from './world';

/**
 * Colony economy (M5, D-093 to D-097): districts, daily production, upkeep and growth, plus the
 * three colony commands. Integer math from src/shared/colony.ts; the numbers are in
 * src/data/economy.json. Colonies run in ascending entity id; no allocation.
 */

type Reject = ColonyRejectReason | null;

// ---- Commands ----------------------------------------------------------------------------------

export function checkSetStance(w: World, cmd: SetColonyStanceCommand): Reject {
  if (!isColony(w.stores, cmd.colony)) return 'NO_SUCH_COLONY';
  if (cmd.stance < 0 || cmd.stance >= STANCE_COUNT) return 'INVALID_STANCE';
  return null;
}

export function applySetStance(w: World, cmd: SetColonyStanceCommand): void {
  if (checkSetStance(w, cmd) !== null) return;
  w.stores.colony.nativeStance[cmd.colony] = cmd.stance;
}

/** The site rules both build commands share: explored, empty, not native ground, paid for. */
function checkSite(w: World, colony: number, region: number, kind: number): Reject {
  const s = w.stores;
  const planet = s.colony.planet[colony];
  if (region < 0 || region >= s.planet.regionCount[planet]) return 'INVALID_REGION';
  if (s.region.fog[s.planet.regionStart[planet] + region] !== FOG_EXPLORED)
    return 'REGION_NOT_EXPLORED';
  if (s.district.kind[colony * MAX_REGIONS_PER_PLANET + region] !== District.None)
    return 'DISTRICT_EXISTS';
  if (inNativeHome(s, planet, region)) return 'NATIVE_REGION';
  if (s.stockpile.production[colony] < DISTRICT_COST[kind]) return 'INSUFFICIENT_PRODUCTION';
  return null;
}

/** Order: colony, district kind, region, explored, empty, not native ground, Production. */
export function checkBuildDistrict(w: World, cmd: BuildDistrictCommand): Reject {
  if (!isColony(w.stores, cmd.colony)) return 'NO_SUCH_COLONY';
  if (!isBuildableDistrict(cmd.district)) return 'INVALID_DISTRICT';
  return checkSite(w, cmd.colony, cmd.region, cmd.district);
}

/** True when the colony has a Spaceport, finished or still being built. */
export function hasSpaceport(w: World, colony: number): boolean {
  const s = w.stores;
  if (s.colony.spaceport[colony] === 1) return true;
  const base = colony * MAX_REGIONS_PER_PLANET;
  for (let i = 0; i < MAX_REGIONS_PER_PLANET; i++) {
    if (s.district.kind[base + i] === District.Spaceport) return true;
  }
  return false;
}

/** Order: colony, no Spaceport yet, region, explored, empty, not native ground, Production. */
export function checkBuildSpaceport(w: World, cmd: BuildSpaceportCommand): Reject {
  if (!isColony(w.stores, cmd.colony)) return 'NO_SUCH_COLONY';
  if (hasSpaceport(w, cmd.colony)) return 'SPACEPORT_EXISTS';
  return checkSite(w, cmd.colony, cmd.region, District.Spaceport);
}

function startBuild(w: World, colony: number, region: number, kind: number): void {
  const s = w.stores;
  s.stockpile.production[colony] -= DISTRICT_COST[kind];
  s.district.kind[colony * MAX_REGIONS_PER_PLANET + region] = kind;
  s.district.left[colony * MAX_REGIONS_PER_PLANET + region] = DISTRICT_DAYS[kind];
}

/** Pay the Production now and start the build; a failed re-check drops the effect (the log keeps it). */
export function applyBuildDistrict(w: World, cmd: BuildDistrictCommand): void {
  if (checkBuildDistrict(w, cmd) !== null) return;
  startBuild(w, cmd.colony, cmd.region, cmd.district);
}

export function applyBuildSpaceport(w: World, cmd: BuildSpaceportCommand): void {
  if (checkBuildSpaceport(w, cmd) !== null) return;
  startBuild(w, cmd.colony, cmd.region, District.Spaceport);
}

// ---- ColonyEconomySystem (step 9) ----------------------------------------------------------------

function addCapped(stock: number, delta: number): number {
  const v = stock + delta;
  return v > STOCK_CAP ? STOCK_CAP : v;
}

/**
 * Each colony, every day: unfinished districts count down; finished ones yield (base x terrain x
 * workers x tech x colony modifier); the settlement adds a small trickle so a new colony can start
 * its first district; people eat 1 Supply each (less with Water Recycling) and the unfed starve
 * at the same rate as on a ship; fed colonies with room grow. The homeworld (colony 0) gets a
 * flat daily income instead and neither eats nor grows (D-094). What was made and used is stored
 * in `colonyFlow` for the panel.
 */
export function colonyEconomySystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const mask = s.research.mask[0];
  const home = s.run.homeColony[0];
  const flow = s.colonyFlow;
  for (let e = 0; e < n; e++) {
    if (!isColony(s, e)) continue;
    const planet = s.colony.planet[e];
    const rBase = s.planet.regionStart[planet];
    const count = s.planet.regionCount[planet];
    const dBase = e * MAX_REGIONS_PER_PLANET;
    const pop = s.colony.population[e];
    const isHome = e === home;

    // Pass 1: builds count down; count working districts and habitats.
    let working = 0;
    let habitats = 0;
    for (let i = 0; i < count; i++) {
      const kind = s.district.kind[dBase + i];
      if (kind === District.None) continue;
      let left = s.district.left[dBase + i];
      if (left > 0) {
        left--;
        s.district.left[dBase + i] = left;
        if (left === 0 && kind === District.Spaceport) s.colony.spaceport[e] = 1;
      }
      if (left > 0) continue;
      if (kind === District.Habitat) habitats++;
      if (kind !== District.Spaceport) working++;
    }

    // Pass 2: yields.
    const disp = effectiveDisposition(s, planet);
    const coexistBonus =
      disp === Disp.Peaceful &&
      s.native.revealed[planet] === 1 &&
      s.colony.nativeStance[e] === Stance.Coexist;
    const mod = colonyModPct(s.colony.penaltyDays[e], coexistBonus);
    const work = workPct(pop, working);
    let supplies = isHome ? SETTLEMENT.supplies : settlementSupplies(pop);
    let fuel = 0;
    let production = SETTLEMENT.production;
    let research = 0;
    for (let i = 0; i < count; i++) {
      const kind = s.district.kind[dBase + i];
      if (kind === District.None || s.district.left[dBase + i] > 0) continue;
      const out = districtOutput(kind, s.region.terrain[rBase + i], work, mask, mod);
      if (kind === District.Farm || kind === District.Habitat) supplies += out;
      else if (kind === District.Mine) production += out;
      else if (kind === District.Refinery) fuel += out;
      else if (kind === District.Research) research += out;
    }
    if (isHome) {
      supplies += HOMEWORLD_FLOW.supplies;
      fuel += HOMEWORLD_FLOW.fuel;
      production += HOMEWORLD_FLOW.production;
    }

    // Upkeep and growth.
    const cap = housingCap(habitats);
    let eat = 0;
    let stock = s.stockpile.supplies[e];
    let fed = true;
    if (isHome) {
      stock = addCapped(stock, supplies);
    } else {
      eat = eatPerDay(pop, mask);
      const have = stock + supplies;
      if (have >= eat) {
        stock = addCapped(have - eat, 0);
        s.colony.hunger[e] = 0;
      } else {
        // Hungry: a few days of grace, then a share of the shortfall dies (own rate, D-102).
        fed = false;
        stock = 0;
        const hungry = s.colony.hunger[e] < 255 ? s.colony.hunger[e] + 1 : 255;
        s.colony.hunger[e] = hungry;
        if (hungry > STARVATION.graceDays) {
          s.colony.population[e] = Math.max(0, pop - starvationDeaths(eat - have));
        }
      }
    }
    s.stockpile.supplies[e] = stock;
    s.stockpile.fuel[e] = addCapped(s.stockpile.fuel[e], fuel);
    s.stockpile.production[e] = addCapped(s.stockpile.production[e], production);
    if (!isHome && fed && s.colony.penaltyDays[e] <= 0) {
      s.colony.population[e] = pop + growthPerDay(pop, cap, s.colony.tier[e]);
    }
    if (s.colony.penaltyDays[e] > 0) s.colony.penaltyDays[e] = s.colony.penaltyDays[e] - 1;

    flow.supplies[e] = supplies;
    flow.fuel[e] = fuel;
    flow.production[e] = production;
    flow.research[e] = research;
    flow.eat[e] = eat;
    flow.housing[e] = isHome ? 0 : cap;

    if (!isHome && s.colony.population[e] <= 0) collapseColony(w, e, planet);
  }
}

/**
 * A colony with nobody left is gone (D-101): its districts are cleared, the planet is released
 * (owner -1, so it can be settled again), and its flow and hunger are zeroed. The entity id stays
 * (ids are never reused) but it is no longer a colony.
 */
function collapseColony(w: World, e: number, planet: number): void {
  const s = w.stores;
  const dBase = e * MAX_REGIONS_PER_PLANET;
  for (let i = 0; i < MAX_REGIONS_PER_PLANET; i++) {
    s.district.kind[dBase + i] = District.None;
    s.district.left[dBase + i] = 0;
  }
  s.planet.owner[planet] = -1;
  s.colony.population[e] = 0;
  s.colony.spaceport[e] = 0;
  s.colony.penaltyDays[e] = 0;
  s.colony.hunger[e] = 0;
  const flow = s.colonyFlow;
  flow.supplies[e] = 0;
  flow.fuel[e] = 0;
  flow.production[e] = 0;
  flow.research[e] = 0;
  flow.eat[e] = 0;
  flow.housing[e] = 0;
  flow.upkeep[e] = 0;
  flow.defendUnpaid[e] = 0;
}
