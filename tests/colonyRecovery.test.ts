// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  daysToExtinction,
  District,
  pushMinPopulation,
  settlementSupplies,
  starterFood,
  starvationDeaths,
} from '../src/shared/colony';
import {
  C_POPULATION,
  C_SUPPLIES,
  COLONY_STRIDE,
  createSnapshot,
  EC_HUNGER,
  EC_SUPPLIES,
  ECON_STRIDE,
} from '../src/shared/snapshot';
import { FoundTier, LR_RESULT } from '../src/shared/planetfall';
import { MAX_REGIONS_PER_PLANET } from '../src/sim/components';
import { isColony } from '../src/sim/launch';
import { tickDay } from '../src/sim/tick';
import { buildColonyView } from '../src/ui/colonyPanelModel';
import { fillSnapshot } from '../src/worker/fill';
import { addColony, setDistrict } from './helpers/colony';
import { BuildDistrictFor } from './helpers/colonyCommands';
import { arrivedShip, form, found, rollRecord } from './helpers/planetfall';
import { lineWorld, send, ticks } from './helpers/transit';

describe('M5 review: a poorly supplied colony can recover (D-101, D-102)', () => {
  it('pure rules: settlement trickle, starter food, starvation deaths', () => {
    expect(settlementSupplies(0)).toBe(40);
    expect(settlementSupplies(400)).toBe(120);
    expect(starterFood(400)).toBe(12000); // 30 days of eating
    expect(starterFood(10_000)).toBe(40000); // capped
    expect(starvationDeaths(760)).toBe(23); // ceil(22.8)
    expect(starvationDeaths(1)).toBe(1);
  });

  it('founding grants 260 Production and 30 days of food even when the ship carried little', () => {
    // Low supplies cut the odds, so walk the seeds (a fixed list: each world is deterministic)
    // until one landing founds. Every founded colony must then hold the grant.
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 1; seed++) {
      const L = arrivedShip(seed, { kit: 8 });
      L.w.stores.shipManifest.supplies[L.ship] = 2500; // the long trip ate the rest
      const e = form(L, { explorers: 100, supplies: 2000, kit: 8 });
      expect(found(L.w, e, L.lz)).toEqual({ ok: true });
      if (rollRecord(L.w, e)[LR_RESULT] === FoundTier.Failed) continue;
      const s = L.w.stores;
      const c = s.planet.owner[L.planet];
      expect(s.colony.population[c]).toBe(400); // no guards were sent
      expect(s.stockpile.production[c]).toBe(260);
      expect(s.stockpile.supplies[c]).toBe(12000); // 400 x 30 days, above the 2500 carried
      expect(s.colony.hunger[c]).toBe(0);
      checked++;
    }
    expect(checked).toBe(1);
  });

  it('a colony that carried more than the starter food keeps it', () => {
    const L = arrivedShip(3, { kit: 8, supplies: 20000 });
    const e = form(L, { explorers: 100, supplies: 8000, kit: 8 });
    const s = L.w.stores;
    const carried = s.expeditionTeam.supplies[e] + s.shipManifest.supplies[L.ship];
    expect(carried).toBe(13200);
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const c = s.planet.owner[L.planet];
    expect(s.stockpile.supplies[c]).toBe(13200);
  });

  it('a hungry colony with a starter grant builds a Farm and ends up fed and growing', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 4200, production: 120 });
    expect(send(w, BuildDistrictFor(c, 0, District.Farm))).toEqual({ ok: true });
    ticks(w, 60);
    expect(s.colony.hunger[c]).toBe(0);
    expect(s.stockpile.supplies[c]).toBeGreaterThan(0);
    expect(s.colony.population[c]).toBeGreaterThan(300);
  });

  it('with no food and no farm the colony starves slowly: grace, then 3% of the shortfall', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 400, supplies: 0, production: 0 });
    ticks(w, 10);
    expect(s.colony.hunger[c]).toBe(10);
    expect(s.colony.population[c]).toBe(400);
    tickDay(w);
    // Income 40 + 80 = 120 for 400 mouths: 280 unfed, ceil(8.4) = 9 die.
    expect(s.colony.population[c]).toBe(391);
  });

  it('daysToExtinction counts the grace days left and the shrinking shortfall', () => {
    expect(daysToExtinction(100, 0, 0, 0)).toBe(70);
    expect(daysToExtinction(100, 0, 0, 2)).toBe(68);
    expect(daysToExtinction(1000, 0, 0, 0)).toBe(141);
    // With enough income the people shrink to what it feeds and stop dying: no extinction.
    expect(daysToExtinction(1000, 500, 0, 0)).toBe(-1);
  });
});

describe('colony panel: starving line and Push out note', () => {
  function snapOf(pop: number, stance: number, supplies = 100000) {
    const w = lineWorld();
    const c = addColony(w, { population: pop, supplies, explored: 4, stance });
    setDistrict(w, c, 0, District.Farm);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    return { w, c, snap };
  }

  it('a fed colony shows no starving line', () => {
    const { snap } = snapOf(600, 0);
    expect(buildColonyView(snap, 1, -1)?.starving).toBe('');
  });

  it('a colony short of food says how many days to extinction (or that it will shrink)', () => {
    const { snap } = snapOf(600, 0);
    snap.colonies[COLONY_STRIDE + C_POPULATION] = 100;
    snap.colonies[COLONY_STRIDE + C_SUPPLIES] = 0;
    snap.colonyEcon[ECON_STRIDE + EC_SUPPLIES] = 0;
    snap.colonyEcon[ECON_STRIDE + EC_HUNGER] = 2;
    expect(buildColonyView(snap, 1, -1)?.starving).toBe('starving: 68 days to extinction');
    snap.colonyEcon[ECON_STRIDE + EC_SUPPLIES] = 60;
    expect(buildColonyView(snap, 1, -1)?.starving).toBe(
      'starving: the colony shrinks until it can feed itself',
    );
  });

  it('Push out says so when the colony is too small to pay a step', () => {
    expect(pushMinPopulation()).toBe(16);
    const small = snapOf(15, 2);
    // Natives on the planet make Push out meaningful.
    const w = small.w;
    const planet = w.stores.colony.planet[small.c];
    w.stores.native.disposition[planet] = 3;
    w.stores.native.homeRegionMask[planet] = 1 << 3;
    w.stores.native.revealed[planet] = 1;
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(buildColonyView(snap, 1, -1)?.pushNote).toBe(
      'Push out does nothing: the colony is too small (it needs 16 people).',
    );
    w.stores.colony.population[small.c] = 600;
    fillSnapshot(w, snap, 0);
    expect(buildColonyView(snap, 1, -1)?.pushNote).toBe('');
  });
});

describe('a colony with nobody left is gone (D-101)', () => {
  it('clears its districts, releases the planet, zeroes its flow and survives more days', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 100000 });
    setDistrict(w, c, 0, District.Farm);
    setDistrict(w, c, 1, District.Habitat, 3);
    tickDay(w);
    const planet = s.colony.planet[c];
    expect(isColony(s, c)).toBe(true);
    expect(s.colonyFlow.supplies[c]).toBeGreaterThan(0);
    s.colony.population[c] = 0;
    tickDay(w);
    expect(isColony(s, c)).toBe(false);
    expect(s.planet.owner[planet]).toBe(-1);
    for (let i = 0; i < MAX_REGIONS_PER_PLANET; i++) {
      expect(s.district.kind[c * MAX_REGIONS_PER_PLANET + i]).toBe(0);
      expect(s.district.left[c * MAX_REGIONS_PER_PLANET + i]).toBe(0);
    }
    expect(s.colonyFlow.supplies[c]).toBe(0);
    expect(s.colonyFlow.production[c]).toBe(0);
    expect(s.colonyFlow.eat[c]).toBe(0);
    expect(s.colonyFlow.housing[c]).toBe(0);
    ticks(w, 5);
    expect(s.planet.owner[planet]).toBe(-1);
    expect(s.colony.population[c]).toBe(0);
  });
});
