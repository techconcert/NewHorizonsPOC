import { ECONOMY } from '../data';
import { District, pushCost, raidChancePct, raidHarm, Stance } from '../shared/colony';
import { Disp } from '../shared/planetfall';
import { G_ENTITY, MAX_REGIONS_PER_PLANET, RNG_ENTITY_BASE } from './components';
import { isColony } from './launch';
import { effectiveDisposition, shiftNativeMood } from './planet';
import { nextInt } from './rng';
import type { World } from './world';

/**
 * NativeSystem (step 8): what natives do to a colony on their planet (docs/GAME_DESIGN.md section 7,
 * D-095). The colony's stance is macro policy:
 *  - Coexist: Peaceful natives give a yield bonus (economy); Wary natives may calm down (Hostile ones stay Hostile).
 *  - Defend: raids come less often and kill fewer people, for a daily Production upkeep (owed only
 *    against Wary or Hostile natives); if the colony cannot pay it that day the stance counts as Coexist. Wary natives may turn Hostile.
 *  - Push out: every few days the colony claims one native home region at a cost in colonists and
 *    angers the natives; with every home claimed the natives are gone and the regions are buildable.
 * Only Hostile natives raid. A raid kills a share of the colony and may destroy one district.
 * All timers are `(day + colony id) % interval`, so no timer state exists and replay is exact.
 * Every roll uses the colony's own RNG stream. Colonies in ascending entity id; no allocation.
 */
export function nativeSystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const day = s.run.day[0];
  const home = s.run.homeColony[0];
  const N = ECONOMY.natives;
  const mask = s.research.mask[0];
  for (let e = 0; e < n; e++) {
    if (e === home || !isColony(s, e)) continue;
    const planet = s.colony.planet[e];
    s.colonyFlow.upkeep[e] = 0;
    s.colonyFlow.defendUnpaid[e] = 0;
    if (s.native.disposition[planet] === Disp.None || s.native.expelled[planet] === 1) continue;
    // The colony lives next to the natives: contact is made.
    s.native.revealed[planet] = 1;
    const stance = s.colony.nativeStance[e];
    let eff = stance;
    if (stance === Stance.Defend) {
      // Upkeep is owed only against natives who can turn on the colony: Wary or Hostile (D-109).
      const watchers = effectiveDisposition(s, planet);
      if (watchers === Disp.Wary || watchers === Disp.Hostile) {
        if (s.stockpile.production[e] >= N.defendUpkeepProduction) {
          s.stockpile.production[e] -= N.defendUpkeepProduction;
          s.colonyFlow.upkeep[e] = N.defendUpkeepProduction;
        } else {
          eff = Stance.Coexist;
          s.colonyFlow.defendUnpaid[e] = 1;
        }
      }
    }
    const t = day + e;
    const slot = RNG_ENTITY_BASE + e;

    if (stance === Stance.PushOut && t % N.pushIntervalDays === 0) pushStep(w, e, planet);

    const disp = effectiveDisposition(s, planet);
    if (disp === Disp.None) continue;

    if (t % N.driftIntervalDays === 0) {
      // Unpaid Defend upkeep means the colony acts as Coexist today (eff), as for raids (D-103).
      const chance = N.driftChancePct[eff];
      if (eff === Stance.Coexist && disp === Disp.Wary) {
        if (nextInt(s.rng, slot, 0, 99) < chance) shiftNativeMood(s, planet, -1);
      } else if (eff === Stance.Defend && disp === Disp.Wary) {
        if (nextInt(s.rng, slot, 0, 99) < chance) shiftNativeMood(s, planet, 1);
      } else if (eff === Stance.PushOut) {
        if (nextInt(s.rng, slot, 0, 99) < chance) shiftNativeMood(s, planet, 1);
      }
    }

    if (t % N.raidIntervalDays === 0) {
      const chance = raidChancePct(effectiveDisposition(s, planet), s.native.strength[planet], eff);
      if (chance > 0 && nextInt(s.rng, slot, 0, 99) < chance) raid(w, e, eff, mask);
    }
  }
}

/** Claim the lowest unclaimed native home region; the colony pays in colonists. */
function pushStep(w: World, e: number, planet: number): void {
  const s = w.stores;
  const homes = s.native.homeRegionMask[planet];
  const unclaimed = (homes & ~s.native.claimed[planet]) >>> 0;
  if (unclaimed === 0) {
    s.native.expelled[planet] = 1;
    return;
  }
  const cost = pushCost(s.colony.population[e]);
  if (cost === 0) return;
  const bit = (unclaimed & -unclaimed) >>> 0;
  s.native.claimed[planet] = (s.native.claimed[planet] | bit) >>> 0;
  s.colony.population[e] -= cost;
  shiftNativeMood(s, planet, 1);
  if ((homes & ~s.native.claimed[planet]) >>> 0 === 0) s.native.expelled[planet] = 1;
}

/** A raid: colonists die; with some chance one finished or building district (not the Spaceport) is lost. */
function raid(w: World, e: number, stance: number, mask: number): void {
  const s = w.stores;
  const planet = s.colony.planet[e];
  const pop = s.colony.population[e];
  const harm = raidHarm(pop, s.native.strength[planet], stance, mask);
  s.colony.population[e] = pop - harm;
  s.colonyFlow.raidDay[e] = s.run.day[0];
  s.colonyFlow.raidLoss[e] = harm;
  const slot = RNG_ENTITY_BASE + e;
  if (nextInt(s.rng, slot, 0, 99) >= ECONOMY.natives.raidDistrictPct) return;
  const dBase = e * MAX_REGIONS_PER_PLANET;
  const count = s.planet.regionCount[planet];
  let hittable = 0;
  for (let i = 0; i < count; i++) {
    const k = s.district.kind[dBase + i];
    if (k !== District.None && k !== District.Spaceport) hittable++;
  }
  if (hittable === 0) return;
  let pick = nextInt(s.rng, slot, 0, hittable - 1);
  for (let i = 0; i < count; i++) {
    const k = s.district.kind[dBase + i];
    if (k === District.None || k === District.Spaceport) continue;
    if (pick === 0) {
      s.district.kind[dBase + i] = District.None;
      s.district.left[dBase + i] = 0;
      return;
    }
    pick--;
  }
}
