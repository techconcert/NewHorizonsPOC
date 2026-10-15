// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TECHS } from '../src/data';
import { TECH_EFFECT_KEYS } from '../src/data/validate';
import { eventChancePermille } from '../src/shared/loadout';
import {
  hasTech,
  knownTechCount,
  TE,
  TECH_COST,
  TECH_COUNT,
  TECH_EFFECTS,
  techBonus,
  techDaysLeft,
  techProgressPct,
  techRejection,
} from '../src/shared/research';
import { District } from '../src/shared/colony';
import { FR_RESEARCH, foundingChanceOf, LR_CHANCE } from '../src/shared/planetfall';
import { ShipStateId } from '../src/sim/components';
import { surveySystem } from '../src/sim/survey';
import { tickDay } from '../src/sim/tick';
import { submit } from '../src/sim/world';
import { addColony, setDistrict, setTerrain } from './helpers/colony';
import { ChooseTech } from './helpers/colonyCommands';
import { addShip, lineWorld, send, ticks } from './helpers/transit';
import { arrivedShip, form, found, rollRecord } from './helpers/planetfall';

describe('tech tables', () => {
  it('ten techs in three branches, effect ids line up with the validator and the sim', () => {
    expect(TECH_COUNT).toBe(10);
    expect([...TECH_EFFECTS]).toEqual(TECH_EFFECT_KEYS);
    expect(TECHS.branches).toEqual(['Propulsion', 'Life Support', 'Exploration']);
    const perBranch = [0, 0, 0];
    for (const t of TECHS.techs) perBranch[t.branch]++;
    expect(perBranch).toEqual([3, 3, 4]);
    expect(TE.Survey).toBe(TECH_EFFECTS.indexOf('surveyPts'));
    expect(TE.RaidCut).toBe(TECH_EFFECTS.indexOf('raidCutPct'));
  });

  it('bonuses add up per effect and ignore unknown techs', () => {
    expect(techBonus(0, TE.Farm)).toBe(0);
    expect(techBonus(1 << 3, TE.Farm)).toBe(50);
    expect(techBonus(1 << 3, TE.Mine)).toBe(0);
    expect(techBonus(0b1111111111, TE.BurnCut)).toBe(15);
    expect(hasTech(1 << 5, 5)).toBe(true);
    expect(hasTech(1 << 5, 4)).toBe(false);
    expect(hasTech(1, -1)).toBe(false);
    expect(knownTechCount(0b1010101)).toBe(4);
  });

  it('choosing: valid index, not known, prerequisite known', () => {
    expect(techRejection(0, -1)).toBe('INVALID_TECH');
    expect(techRejection(0, 10)).toBe('INVALID_TECH');
    expect(techRejection(0, 1.5)).toBe('INVALID_TECH');
    expect(techRejection(0, 1)).toBe('TECH_LOCKED'); // Reinforced Hulls needs Ion Drive
    expect(techRejection(0, 0)).toBeNull();
    expect(techRejection(1, 0)).toBe('TECH_KNOWN');
    expect(techRejection(1, 1)).toBeNull();
    expect(techRejection(0, 6)).toBeNull(); // Laboratories starts the Exploration branch
  });

  it('progress and days left', () => {
    expect(techProgressPct(0, 300)).toBe(50);
    expect(techProgressPct(0, 9999)).toBe(100);
    expect(techProgressPct(-1, 5)).toBe(0);
    expect(techDaysLeft(6, 0, 12)).toBe(42); // 500 points at 12 a day
    expect(techDaysLeft(6, 495, 12)).toBe(1);
    expect(techDaysLeft(6, 0, 0)).toBe(-1);
    expect(techDaysLeft(-1, 0, 5)).toBe(-1);
  });
});

describe('ChooseTech and ResearchSystem', () => {
  it('refuses bad choices with a reason and accepts a good one', () => {
    const w = lineWorld();
    const r = (tech: number) => {
      const x = submit(w, ChooseTech(tech));
      return x.ok ? 'ACCEPTED' : x.reason;
    };
    expect(r(99)).toBe('INVALID_TECH');
    expect(r(1)).toBe('TECH_LOCKED');
    w.stores.research.mask[0] = 1;
    expect(r(0)).toBe('TECH_KNOWN');
    expect(r(1)).toBe('ACCEPTED');
  });

  it('a Research lab on Ruins makes 12 points a day: Laboratories (500) is learned on day 42, then research idles', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 1_000_000 });
    setTerrain(w, c, 0, 5);
    setDistrict(w, c, 0, District.Research);
    expect(send(w, ChooseTech(6))).toEqual({ ok: true });
    expect(s.research.current[0]).toBe(6);
    ticks(w, 41);
    expect(s.research.progress[0]).toBe(41 * 12);
    expect(hasTech(s.research.mask[0] as number, 6)).toBe(false);
    tickDay(w);
    expect(hasTech(s.research.mask[0] as number, 6)).toBe(true);
    expect(s.research.current[0]).toBe(-1);
    expect(s.research.progress[0]).toBe(0);
    // Laboratories lifts the lab to 19 a day right away.
    tickDay(w);
    expect(s.colonyFlow.research[c]).toBe(19);
    expect(s.research.progress[0]).toBe(0); // nothing chosen, nothing gained
  });

  it('switching restarts the points; choosing the tech already under way keeps them', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 300, supplies: 1_000_000 });
    setDistrict(w, c, 0, District.Research);
    send(w, ChooseTech(6));
    ticks(w, 10);
    const had = s.research.progress[0] as number;
    expect(had).toBeGreaterThan(0);
    send(w, ChooseTech(6));
    expect(s.research.progress[0]).toBe(had);
    send(w, ChooseTech(3));
    expect(s.research.current[0]).toBe(3);
    expect(s.research.progress[0]).toBe(0);
    expect(TECH_COST[3]).toBe(600);
  });
});

describe('techs inside the formulas', () => {
  it('Ion Drive: a ship burns 15% less fuel on the same trip', () => {
    const used = (mask: number): number => {
      const w = lineWorld();
      w.stores.research.mask[0] = mask;
      const e = addShip(w, { fuel: 4000 });
      ticks(w, 40);
      expect(w.stores.shipState.state[e]).toBe(ShipStateId.Arrived);
      return 4000 - (w.stores.shipManifest.fuel[e] as number);
    };
    const base = used(0);
    expect(base).toBe(500); // 100 units at 5 fuel a unit
    const tech = used(1 << 0);
    expect(tech).toBeGreaterThanOrEqual(424);
    expect(tech).toBeLessThanOrEqual(426);
  });

  it('Reinforced Hulls: the event chance of a Scout drops from 13 to 10 permille on a hazard 40 route', () => {
    expect(eventChancePermille(40, 0, 0)).toBe(13);
    expect(eventChancePermille(40, 0, 0, 25)).toBe(10);
  });

  it('Medical Bay: the founding roll records +8 and the chance is multiplied by 1.08', () => {
    const run = (mask: number): { research: number; chance: number } => {
      const L = arrivedShip(5);
      L.w.stores.research.mask[0] = mask;
      const e = form(L, { explorers: 100, supplies: 5000, kit: 4 });
      expect(found(L.w, e, L.lz)).toEqual({ ok: true });
      const rec = rollRecord(L.w, e, 0);
      return { research: rec[FR_RESEARCH] as number, chance: rec[LR_CHANCE] as number };
    };
    const base = run(0);
    const tech = run(1 << 5);
    expect(base.research).toBe(0);
    expect(tech.research).toBe(8);
    expect(tech.chance).toBeGreaterThanOrEqual(base.chance);
    expect(foundingChanceOf(80, 80, 100, 100, 100, 100, 8)).toBe(
      Math.min(100, Math.floor((80 * 80 * 100 * 100 * 100 * 100 * 108) / 1_000_000_000_000)),
    );
  });

  it('Orbital Scanning: a target 65% of the way out is scanned, where without the tech it is not', () => {
    const probe = (mask: number): number => {
      const w = lineWorld();
      w.stores.research.mask[0] = mask;
      const e = addShip(w, { dest: 3 });
      const route = w.stores.shipRoute;
      route.progress[e] = Math.floor(((route.distance[e] as number) * 35) / 100);
      surveySystem(w);
      return w.stores.planet.survey[w.stores.shipRoute.destPlanet[e] as number] as number;
    };
    expect(probe(0)).toBe(0); // Unknown: 65% left, the Scanned line is 60%
    expect(probe(1 << 7)).toBe(1); // Scanned: the line moved to 70%
  });
});
