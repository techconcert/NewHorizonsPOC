// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/data';
import {
  colonyModPct,
  District,
  districtOutput,
  eatPerDay,
  growthPerDay,
  housingCap,
  workPct,
} from '../src/shared/colony';
import { MAX_REGIONS_PER_PLANET } from '../src/sim/components';
import { tickDay } from '../src/sim/tick';
import { addColony, setDistrict, setTerrain } from './helpers/colony';
import { lineWorld, planetOf, send, ticks } from './helpers/transit';
import { BuildDistrictFor } from './helpers/colonyCommands';

const FARM = District.Farm;

describe('colony economy math (pure)', () => {
  it('district yield = base x terrain x workers x tech x modifier, floored once', () => {
    // Farm on Plains (150%) at full workers: 900 x 1.5 = 1350.
    expect(districtOutput(FARM, 0, 100, 0, 100)).toBe(1350);
    // Hydroponics (tech 3, +50%): 2025.
    expect(districtOutput(FARM, 0, 100, 1 << 3, 100)).toBe(2025);
    // Mine on Highlands: 35 x 1.5 = 52.5 floors to 52; with Deep Core Drills (tech 8): 78.75 floors to 78.
    expect(districtOutput(District.Mine, 1, 100, 0, 100)).toBe(52);
    expect(districtOutput(District.Mine, 1, 100, 1 << 8, 100)).toBe(78);
    // Refinery on Ice: 60 x 1.5 = 90; Fuel Cracking (tech 2): 135.
    expect(districtOutput(District.Refinery, 3, 100, 0, 100)).toBe(90);
    expect(districtOutput(District.Refinery, 3, 100, 1 << 2, 100)).toBe(135);
    // Research lab on Ruins (160%): 8 x 1.6 = 12.8 floors to 12; Laboratories (tech 6): 19.2 floors to 19.
    expect(districtOutput(District.Research, 5, 100, 0, 100)).toBe(12);
    expect(districtOutput(District.Research, 5, 100, 1 << 6, 100)).toBe(19);
    // The Spaceport makes nothing.
    expect(districtOutput(District.Spaceport, 0, 100, 0, 100)).toBe(0);
  });

  it('workers: colonists share the working districts, 150 for full output, never under 20%', () => {
    expect(workPct(600, 4)).toBe(100);
    expect(workPct(50, 1)).toBe(33);
    expect(workPct(10, 1)).toBe(ECONOMY.minWorkPct);
    expect(workPct(10_000, 1)).toBe(100);
    expect(workPct(0, 0)).toBe(100);
  });

  it('modifier: Struggling halves, the Coexist bonus adds 10%, both multiply', () => {
    expect(colonyModPct(0, false)).toBe(100);
    expect(colonyModPct(5, false)).toBe(50);
    expect(colonyModPct(0, true)).toBe(110);
    expect(colonyModPct(5, true)).toBe(55);
  });

  it('housing, eating and growth', () => {
    expect(housingCap(0)).toBe(1000);
    expect(housingCap(2)).toBe(2200);
    expect(eatPerDay(300, 0)).toBe(300);
    expect(eatPerDay(300, 1 << 4)).toBe(240); // Water Recycling, -20%
    expect(eatPerDay(7, 1 << 4)).toBe(6); // rounded up: 5.6 -> 6
    // 500 people with room for 500 more: Thriving 150% gives 3.75 -> 3, Struggling 2.5 -> 2.
    expect(growthPerDay(500, 1000, 2)).toBe(3);
    expect(growthPerDay(500, 1000, 1)).toBe(2);
    // At least one birth while there is room; none at the cap or with nobody.
    expect(growthPerDay(300, 400, 2)).toBe(1);
    expect(growthPerDay(400, 400, 2)).toBe(0);
    expect(growthPerDay(0, 400, 2)).toBe(0);
  });
});

describe('ColonyEconomySystem', () => {
  it('a new colony with no districts: settlement trickle, eating, one birth', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 10000, production: 100 });
    tickDay(w);
    expect(s.stockpile.supplies[c]).toBe(10000 + 100 - 300); // trickle 40 + 300 / 5
    expect(s.stockpile.production[c]).toBe(100 + 8);
    expect(s.stockpile.fuel[c]).toBe(0);
    expect(s.colony.population[c]).toBe(303); // 3.15 births, floored
    expect(s.colonyFlow.supplies[c]).toBe(100);
    expect(s.colonyFlow.production[c]).toBe(8);
    expect(s.colonyFlow.eat[c]).toBe(300);
    expect(s.colonyFlow.housing[c]).toBe(1000);
  });

  it('each district yields by terrain: Farm on Plains, Mine on Highlands, Refinery on Ice, Lab on Ruins', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 600, supplies: 100000 });
    setTerrain(w, c, 1, 1);
    setTerrain(w, c, 2, 3);
    setTerrain(w, c, 3, 5);
    setDistrict(w, c, 0, FARM);
    setDistrict(w, c, 1, District.Mine);
    setDistrict(w, c, 2, District.Refinery);
    setDistrict(w, c, 3, District.Research);
    tickDay(w);
    // 600 colonists over 4 working districts is exactly 150 each: full output.
    expect(s.colonyFlow.supplies[c]).toBe(160 + 1350); // trickle 40 + 600 / 5
    expect(s.colonyFlow.production[c]).toBe(8 + 52);
    expect(s.colonyFlow.fuel[c]).toBe(90);
    expect(s.colonyFlow.research[c]).toBe(12);
    expect(s.stockpile.fuel[c]).toBe(90);
    expect(s.stockpile.production[c]).toBe(100 + 60);
    // The same colony with Hydroponics, Fuel Cracking, Deep Core Drills and Laboratories.
    s.research.mask[0] = (1 << 3) | (1 << 2) | (1 << 8) | (1 << 6);
    tickDay(w);
    expect(s.colonyFlow.supplies[c]).toBe(160 + 2025);
    expect(s.colonyFlow.production[c]).toBe(8 + 78);
    expect(s.colonyFlow.fuel[c]).toBe(135);
    expect(s.colonyFlow.research[c]).toBe(19);
  });

  it('a district under construction makes nothing until its last build day, then yields at once', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 100000, production: 100 });
    expect(send(w, BuildDistrictFor(c, 0, FARM))).toEqual({ ok: true });
    expect(s.stockpile.production[c]).toBe(60); // 40 paid now
    expect(s.district.left[c * MAX_REGIONS_PER_PLANET]).toBe(10);
    ticks(w, 9);
    expect(s.district.left[c * MAX_REGIONS_PER_PLANET]).toBe(1);
    // Three births a day so far: 324 people at the start of day 9, trickle 40 + 64.
    expect(s.colonyFlow.supplies[c]).toBe(104);
    tickDay(w);
    expect(s.district.left[c * MAX_REGIONS_PER_PLANET]).toBe(0);
    expect(s.colonyFlow.supplies[c]).toBe(105 + 1350); // 327 people: trickle 40 + 65
  });

  it('few workers cut the yield: 50 colonists on one Farm give 445, 10 give the 20% floor (270)', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 50, supplies: 100000 });
    setDistrict(w, c, 0, FARM);
    tickDay(w);
    expect(s.colonyFlow.supplies[c]).toBe(50 + 445); // trickle 40 + 50 / 5
    s.colony.population[c] = 10;
    tickDay(w);
    expect(s.colonyFlow.supplies[c]).toBe(42 + 270);
  });

  it('a Habitat raises housing by 600 and lets a Thriving colony grow faster than a Struggling one', () => {
    const grow = (tier: number): number => {
      const w = lineWorld();
      const c = addColony(w, { population: 500, supplies: 100000, tier });
      setDistrict(w, c, 0, District.Habitat);
      tickDay(w);
      expect(w.stores.colonyFlow.housing[c]).toBe(1600);
      // Habitat on Plains: 40 x 1.2 = 48 supplies on top of the settlement's 40 + 500 / 5.
      expect(w.stores.colonyFlow.supplies[c]).toBe(188);
      return w.stores.colony.population[c] as number;
    };
    expect(grow(2)).toBe(505); // housing 1600: 5.15 births
    expect(grow(1)).toBe(503); // 3.43 births
  });

  it('no growth at the housing cap, and no overshoot', () => {
    const w = lineWorld();
    // Housing is 1000: two births fill it (the last is the minimum of one) and nothing goes over.
    const c = addColony(w, { population: 998, supplies: 100000 });
    ticks(w, 5);
    expect(w.stores.colony.population[c]).toBe(1000);
  });

  it('starvation: 10 grace days, then 3% of the shortfall a day (rounded up), and nobody is born', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 1000, supplies: 100 });
    ticks(w, 10);
    // 100 + 240 for 1000 mouths on day 1, then 240 a day: hungry, but nobody dies yet.
    expect(s.stockpile.supplies[c]).toBe(0);
    expect(s.colony.hunger[c]).toBe(10);
    expect(s.colony.population[c]).toBe(1000);
    tickDay(w);
    // 240 for 1000: 760 unfed, ceil(22.8) = 23 die.
    expect(s.colony.hunger[c]).toBe(11);
    expect(s.colony.population[c]).toBe(977);
    tickDay(w);
    // 235 for 977: 742 unfed, ceil(22.26) = 23 die.
    expect(s.colony.population[c]).toBe(954);
  });

  it('a Struggling colony makes half, does not grow, and recovers when the penalty ends', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 100000, tier: 1, penaltyDays: 3 });
    setDistrict(w, c, 0, FARM);
    tickDay(w);
    expect(s.colonyFlow.supplies[c]).toBe(100 + 675);
    expect(s.colony.penaltyDays[c]).toBe(2);
    ticks(w, 2);
    expect(s.colony.penaltyDays[c]).toBe(0);
    expect(s.colony.population[c]).toBe(300);
    tickDay(w);
    expect(s.colonyFlow.supplies[c]).toBe(100 + 1350);
    expect(s.colony.population[c]).toBe(302); // Struggling pace: 2.1 births
  });

  it('Water Recycling cuts what the colony eats', () => {
    const w = lineWorld();
    const s = w.stores;
    s.research.mask[0] = 1 << 4;
    const c = addColony(w, { population: 300, supplies: 10000 });
    tickDay(w);
    expect(s.stockpile.supplies[c]).toBe(10000 + 100 - 240);
  });

  it('the homeworld gets a flat income and neither eats nor grows', () => {
    const w = lineWorld();
    const s = w.stores;
    const home = w.homeColony;
    tickDay(w);
    expect(s.stockpile.supplies[home]).toBe(500000 + 40 + 130);
    expect(s.stockpile.fuel[home]).toBe(20000 + 12);
    expect(s.stockpile.production[home]).toBe(5000 + 8 + 25);
    expect(s.colony.population[home]).toBe(100000);
    expect(s.colonyFlow.eat[home]).toBe(0);
  });

  it('stockpiles stop at the cap instead of overflowing', () => {
    const w = lineWorld();
    const c = addColony(w, { population: 1, supplies: 999_999_990 });
    tickDay(w);
    expect(w.stores.stockpile.supplies[c]).toBe(ECONOMY.stockCap);
  });

  it('colonies are independent: two colonies tick the same as each alone', () => {
    const alone = lineWorld();
    const a = addColony(alone, { population: 300 });
    ticks(alone, 20);
    const both = lineWorld();
    addColony(both, { system: 3, population: 999 });
    const b = addColony(both, { population: 300 });
    ticks(both, 20);
    expect(both.stores.colony.population[b]).toBe(alone.stores.colony.population[a]);
    expect(both.stores.stockpile.supplies[b]).toBe(alone.stores.stockpile.supplies[a]);
    expect(planetOf(both, 2)).toBe(planetOf(alone, 2));
  });
});
