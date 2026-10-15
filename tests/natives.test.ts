// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/data';
import { pushCost, raidChancePct, raidHarm, Stance } from '../src/shared/colony';
import { District } from '../src/shared/colony';
import { MAX_REGIONS_PER_PLANET } from '../src/sim/components';
import { nativeSystem } from '../src/sim/natives';
import { effectiveDisposition } from '../src/sim/planet';
import { tickDay } from '../src/sim/tick';
import { submit } from '../src/sim/world';
import { addColony, addNatives, setDistrict } from './helpers/colony';
import { BuildDistrictFor as build } from './helpers/colonyCommands';
import { lineWorld } from './helpers/transit';

describe('raid math (pure)', () => {
  it('only Hostile natives raid; strength 50 gives the table value, the stance scales it', () => {
    expect([0, 1, 2].map((d) => raidChancePct(d, 50, Stance.Coexist))).toEqual([0, 0, 0]);
    expect(raidChancePct(3, 50, Stance.Coexist)).toBe(50);
    expect(raidChancePct(3, 50, Stance.Defend)).toBe(25);
    expect(raidChancePct(3, 50, Stance.PushOut)).toBe(75);
    // Strength 10 and 90 move it by (50 + strength) / 100: 30 and 70 percent at Coexist.
    expect(raidChancePct(3, 10, Stance.Coexist)).toBe(30);
    expect(raidChancePct(3, 90, Stance.Coexist)).toBe(70);
    expect(raidChancePct(3, 90, Stance.PushOut)).toBe(95); // capped
  });

  it('harm: 4% of the colony at strength 50, half under Defend, halved again by Native Liaison, at least 1', () => {
    expect(raidHarm(1000, 50, Stance.Coexist, 0)).toBe(40);
    expect(raidHarm(1000, 50, Stance.Defend, 0)).toBe(20);
    expect(raidHarm(1000, 50, Stance.PushOut, 0)).toBe(40);
    expect(raidHarm(1000, 50, Stance.Coexist, 1 << 9)).toBe(20);
    expect(raidHarm(1000, 90, Stance.Coexist, 0)).toBe(56);
    expect(raidHarm(10, 50, Stance.Defend, 0)).toBe(1);
    expect(raidHarm(0, 50, Stance.Coexist, 0)).toBe(0);
  });

  it('Push out costs 2% of the colony (at least 5) and is refused to a colony under four times that', () => {
    expect(pushCost(1000)).toBe(20);
    expect(pushCost(100)).toBe(5);
    expect(pushCost(20)).toBe(5);
    expect(pushCost(15)).toBe(0);
  });
});

/** Run nativeSystem alone over `days` consecutive days, as the tick would call it. */
function runNatives(w: ReturnType<typeof lineWorld>, days: number, from = 1): void {
  for (let d = from; d < from + days; d++) {
    w.stores.run.day[0] = d;
    nativeSystem(w);
  }
}

describe('NativeSystem: raids', () => {
  function raidRun(stance: number, production = 1_000_000): { raids: number; harmOk: boolean } {
    const w = lineWorld(3);
    const s = w.stores;
    const c = addColony(w, { population: 100_000, production, stance });
    addNatives(w, c, { disposition: 3, strength: 50 });
    let raids = 0;
    let harmOk = true;
    for (let d = 1; d <= 6000; d++) {
      s.run.day[0] = d;
      const before = s.colony.population[c] as number;
      const lastRaid = s.colonyFlow.raidDay[c] as number;
      nativeSystem(w);
      if (s.colonyFlow.raidDay[c] !== lastRaid) {
        raids++;
        const eff = stance === Stance.Defend ? Stance.Defend : stance;
        const harm = before - (s.colony.population[c] as number);
        if (harm !== raidHarm(before, 50, eff, 0)) harmOk = false;
        expect(s.colonyFlow.raidLoss[c]).toBe(harm);
        expect(s.colonyFlow.raidDay[c]).toBe(d);
      }
    }
    return { raids, harmOk };
  }

  it('Hostile natives raid about half the time (200 checks in 6000 days) and each raid kills the formula share', () => {
    const r = raidRun(Stance.Coexist);
    expect(r.harmOk).toBe(true);
    expect(r.raids).toBeGreaterThan(70);
    expect(r.raids).toBeLessThan(130);
  });

  it('Defend halves the raids and the harm, for 3 Production a day', () => {
    const coexist = raidRun(Stance.Coexist);
    const defend = raidRun(Stance.Defend);
    expect(defend.harmOk).toBe(true);
    expect(defend.raids).toBeLessThan(coexist.raids);
    expect(defend.raids).toBeGreaterThan(20);
    const w = lineWorld(3);
    const c = addColony(w, { production: 100, stance: Stance.Defend });
    addNatives(w, c, { disposition: 3 });
    runNatives(w, 10);
    expect(w.stores.stockpile.production[c]).toBe(100 - 30);
  });

  it('a Defend colony that cannot pay the upkeep falls back to Coexist numbers that day', () => {
    const w = lineWorld(3);
    const c = addColony(w, { production: 2, stance: Stance.Defend });
    addNatives(w, c, { disposition: 3 });
    runNatives(w, 1);
    expect(w.stores.stockpile.production[c]).toBe(2); // not paid
  });

  it('Peaceful and Wary natives never raid', () => {
    for (const disposition of [1, 2]) {
      const w = lineWorld(3);
      const c = addColony(w, { population: 5000, stance: Stance.Coexist });
      addNatives(w, c, { disposition });
      runNatives(w, 3000);
      expect(w.stores.colonyFlow.raidDay[c]).toBe(-1);
      expect(w.stores.colony.population[c]).toBe(5000);
    }
  });

  it('a raid can destroy a district but never the Spaceport', () => {
    const w = lineWorld(3);
    const s = w.stores;
    const c = addColony(w, { population: 100_000, stance: Stance.Coexist });
    addNatives(w, c, { disposition: 3, strength: 90 });
    setDistrict(w, c, 0, District.Farm);
    setDistrict(w, c, 1, District.Spaceport);
    runNatives(w, 20_000);
    expect(s.district.kind[c * MAX_REGIONS_PER_PLANET]).toBe(District.None);
    expect(s.district.kind[c * MAX_REGIONS_PER_PLANET + 1]).toBe(District.Spaceport);
  });
});

describe('NativeSystem: push out and mood drift', () => {
  it('Push out claims the lowest native home region every 20 days, pays colonists, angers the natives, and ends with the natives gone', () => {
    const w = lineWorld(3);
    const s = w.stores;
    const c = addColony(w, { population: 1000, stance: Stance.PushOut });
    addNatives(w, c, { disposition: 1, homes: [1, 3] });
    const planet = s.colony.planet[c];
    expect(submit(w, build(c, 1, District.Farm))).toEqual({ ok: false, reason: 'NATIVE_REGION' });
    // The push day is when (day + colony id) is a multiple of 20.
    const first = 20 - (c % 20);
    runNatives(w, first - 1);
    expect(s.native.claimed[planet]).toBe(0);
    runNatives(w, 1, first);
    expect(s.native.claimed[planet]).toBe(1 << 1);
    expect(s.colony.population[c]).toBe(1000 - 20);
    expect(s.native.shift[planet]).toBe(1); // Peaceful -> Wary
    expect(effectiveDisposition(s, planet)).toBe(2);
    expect(s.native.expelled[planet]).toBe(0);
    runNatives(w, 20, first + 1);
    expect(s.native.claimed[planet]).toBe((1 << 1) | (1 << 3));
    expect(s.native.expelled[planet]).toBe(1);
    expect(effectiveDisposition(s, planet)).toBe(0);
    // The ground is free now.
    expect(submit(w, build(c, 1, District.Farm))).toEqual({ ok: true });
    expect(submit(w, build(c, 3, District.Mine))).toEqual({ ok: true });
  });

  it('Coexist lets Wary natives drift calmer, Defend lets them turn Hostile, over 60-day checks', () => {
    const drift = (stance: number): number => {
      const w = lineWorld(5);
      const c = addColony(w, { stance, production: 100000 });
      addNatives(w, c, { disposition: 2 });
      runNatives(w, 60 * 40);
      return effectiveDisposition(w.stores, w.stores.colony.planet[c] as number);
    };
    expect(drift(Stance.Coexist)).toBe(1); // 40 checks at 40%: calmed (and then stays Peaceful)
    expect(drift(Stance.Defend)).toBe(3); // 40 checks at 20%: turned Hostile
  });

  it('Defend with its upkeep unpaid drifts like Coexist (effective stance), not like Defend', () => {
    const w = lineWorld(5);
    const c = addColony(w, { stance: Stance.Defend, production: 0 });
    addNatives(w, c, { disposition: 2 });
    runNatives(w, 60 * 40); // no Production, so the upkeep never gets paid
    expect(effectiveDisposition(w.stores, w.stores.colony.planet[c] as number)).toBe(1);
  });

  it('contact: living next to natives reveals them', () => {
    const w = lineWorld(3);
    const c = addColony(w);
    addNatives(w, c, { disposition: 2 });
    const planet = w.stores.colony.planet[c] as number;
    w.stores.native.revealed[planet] = 0;
    tickDay(w);
    expect(w.stores.native.revealed[planet]).toBe(1);
  });

  it('Peaceful natives under Coexist give a 10% yield bonus', () => {
    const w = lineWorld(3);
    const c = addColony(w, { population: 300, supplies: 100000 });
    addNatives(w, c, { disposition: 1 });
    setDistrict(w, c, 0, District.Farm);
    tickDay(w);
    // 900 x 1.5 x 1.10 = 1485.
    expect(w.stores.colonyFlow.supplies[c]).toBe(100 + 1485);
    w.stores.colony.nativeStance[c] = Stance.Defend;
    tickDay(w);
    expect(w.stores.colonyFlow.supplies[c]).toBe(100 + 1350);
    expect(ECONOMY.coexistBonusPct).toBe(10);
  });
});
