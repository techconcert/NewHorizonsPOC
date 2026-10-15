// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { etaDays, foundingOddsBand, supplyMarginPct } from '../src/shared/loadout';
import { LostReason, ShipStateId, Survey } from '../src/sim/components';
import { tickDay } from '../src/sim/tick';
import { addShip, lineWorld, planetOf, ticks } from './helpers/transit';

const { InTransit, Arrived, Drifting, Lost } = ShipStateId;

describe('TravelSystem: movement and fuel burn', () => {
  it('a Scout at Economy flies 1536 grid units a day and burns 30 fuel a day', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    expect(s.shipRoute.distance[e]).toBe(25600);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(InTransit);
    expect(s.shipRoute.progress[e]).toBe(1536);
    expect(s.shipManifest.fuel[e]).toBe(3970);
    expect(s.shipRoute.fuelFrac[e]).toBe(0);
    // Render positions: previous and current, in world units (6 units a day along y = 500).
    expect([s.prevPosition[e * 2], s.prevPosition[e * 2 + 1]]).toEqual([100, 500]);
    expect([s.currPosition[e * 2], s.currPosition[e * 2 + 1]]).toEqual([106, 500]);
    tickDay(w);
    expect([s.prevPosition[e * 2], s.currPosition[e * 2]]).toEqual([106, 112]);
  });

  it('arrives on day 17 (the LoadoutMath ETA) after burning exactly 500 fuel, then stays put', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    expect(etaDays(25600, 0, 0)).toBe(17);
    ticks(w, 16);
    expect(s.shipState.state[e]).toBe(InTransit);
    expect(s.shipRoute.progress[e]).toBe(24576);
    expect(s.shipManifest.fuel[e]).toBe(3520);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipRoute.progress[e]).toBe(25600);
    expect(s.shipManifest.fuel[e]).toBe(3500);
    expect(s.shipLog.arrivedDay[e]).toBe(17);
    expect(s.currPosition[e * 2]).toBe(200);
    // The supply of the arrival day is eaten too: 17 days x 60.
    expect(s.shipManifest.supplies[e]).toBe(5000 - 17 * 60);
    ticks(w, 5);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipManifest.fuel[e]).toBe(3500);
    // A ship in orbit keeps feeding its colonists: 5 more days x 60 (D-080).
    expect(s.shipManifest.supplies[e]).toBe(5000 - 22 * 60);
    expect(s.prevPosition[e * 2]).toBe(200);
  });

  it('Cruise flies 2304 a day, burns 67.5 fuel a day with the half unit carried, arrives day 12 with 750 burned', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { speed: 1 });
    expect(etaDays(25600, 0, 1)).toBe(12);
    tickDay(w);
    expect(s.shipRoute.progress[e]).toBe(2304);
    expect(s.shipManifest.fuel[e]).toBe(3933);
    expect(s.shipRoute.fuelFrac[e]).toBe(1_280_000); // half a fuel unit (2,560,000 per unit)
    tickDay(w);
    expect(s.shipManifest.fuel[e]).toBe(3865);
    expect(s.shipRoute.fuelFrac[e]).toBe(0);
    ticks(w, 10);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipManifest.fuel[e]).toBe(3250);
  });

  it('a Heavy Ark at Hard Burn flies 1920 a day, burns 12.5 fuel per world unit, arrives day 14 with 1250 burned', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { hull: 2, speed: 2 });
    expect(etaDays(25600, 2, 2)).toBe(14);
    tickDay(w);
    expect(s.shipRoute.progress[e]).toBe(1920);
    expect(s.shipManifest.fuel[e]).toBe(3907);
    expect(s.shipRoute.fuelFrac[e]).toBe(1_920_000);
    ticks(w, 12);
    expect(s.shipState.state[e]).toBe(InTransit);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipManifest.fuel[e]).toBe(2750);
  });

  it('a delay stands the ship still while supplies keep burning', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    s.shipRoute.delay[e] = 3;
    ticks(w, 3);
    expect(s.shipRoute.progress[e]).toBe(0);
    expect(s.shipRoute.delay[e]).toBe(0);
    expect(s.shipManifest.fuel[e]).toBe(4000);
    expect(s.shipManifest.supplies[e]).toBe(5000 - 180);
    tickDay(w);
    expect(s.shipRoute.progress[e]).toBe(1536);
  });

  it('a target in the same system is reached on the first day', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { destPlanet: planetOf(w, 0) + 1 }); // the second planet of the home system
    expect(s.shipRoute.distance[e]).toBe(0);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipManifest.fuel[e]).toBe(4000);
  });
});

describe('fuel runs out: Drifting, then Lost', () => {
  it('with 100 fuel the ship flies 3 days, then as far as the last 10 fuel allow, then drifts', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { fuel: 100 });
    ticks(w, 3);
    expect(s.shipManifest.fuel[e]).toBe(10);
    expect(s.shipState.state[e]).toBe(InTransit);
    tickDay(w); // 10 fuel buy 512 grid units
    expect(s.shipRoute.progress[e]).toBe(3 * 1536 + 512);
    expect(s.shipManifest.fuel[e]).toBe(0);
    expect(s.shipState.state[e]).toBe(Drifting);
    expect(s.currPosition[e * 2]).toBe(120);
    tickDay(w);
    expect(s.shipRoute.progress[e]).toBe(5120); // coasting ships do not move
    expect(s.shipRoute.drift[e]).toBe(1);
  });

  it('a drifting ship is Lost (OutOfFuel) on the 10th drifting day, day 14, and counts as lost', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { fuel: 100 });
    ticks(w, 13);
    expect(s.shipState.state[e]).toBe(Drifting);
    expect(s.shipRoute.drift[e]).toBe(9);
    expect(s.run.shipsLost[0]).toBe(0);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Lost);
    expect(s.shipLog.lostReason[e]).toBe(LostReason.OutOfFuel);
    expect(s.shipLog.lostDay[e]).toBe(14);
    expect(s.run.shipsLost[0]).toBe(1);
    ticks(w, 3);
    expect(s.run.shipsLost[0]).toBe(1); // counted once
  });

  it('fuel for exactly the trip arrives with 0; one unit less drifts 52 grid units short', () => {
    const exact = lineWorld();
    const e1 = addShip(exact, { fuel: 500 });
    ticks(exact, 17);
    expect(exact.stores.shipState.state[e1]).toBe(Arrived);
    expect(exact.stores.shipManifest.fuel[e1]).toBe(0);

    const short = lineWorld();
    const e2 = addShip(short, { fuel: 499 });
    ticks(short, 17);
    expect(short.stores.shipState.state[e2]).toBe(Drifting);
    expect(short.stores.shipRoute.progress[e2]).toBe(25548);
  });

  it('a ship that starves while drifting is Lost as AllDead before the drift timer ends', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { fuel: 100, colonists: 5, supplies: 0 });
    ticks(w, 10);
    expect(s.shipState.state[e]).toBe(Lost);
    expect(s.shipLog.lostReason[e]).toBe(LostReason.AllDead);
  });
});

describe('SupplySystem: one supply per colonist per day, then attrition', () => {
  it('60 colonists eat 60 supplies a day', () => {
    const w = lineWorld();
    const e = addShip(w, { dest: 5 });
    tickDay(w);
    expect(w.stores.shipManifest.supplies[e]).toBe(4940);
    ticks(w, 9);
    expect(w.stores.shipManifest.supplies[e]).toBe(4400);
    expect(w.stores.shipManifest.colonists[e]).toBe(60);
  });

  it('130 supplies for 60 colonists: fed for two days, then 10% of the unfed die each day (rounded up)', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { dest: 5, supplies: 130 });
    const colonists: number[] = [];
    const supplies: number[] = [];
    for (let d = 0; d < 14; d++) {
      tickDay(w);
      colonists.push(s.shipManifest.colonists[e]);
      supplies.push(s.shipManifest.supplies[e]);
    }
    expect(supplies).toEqual([70, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Day 3: 50 unfed, ceil(5.0) = 5 die; day 4: 55 unfed, ceil(5.5) = 6; and so on.
    expect(colonists).toEqual([60, 60, 55, 49, 44, 39, 35, 31, 27, 24, 21, 18, 16, 14]);
    expect(s.shipState.state[e]).toBe(InTransit);
  });

  it('partly fed: 40 supplies for 60 colonists leaves 20 unfed, 2 die', () => {
    const w = lineWorld();
    const e = addShip(w, { dest: 5, supplies: 40 });
    tickDay(w);
    expect(w.stores.shipManifest.supplies[e]).toBe(0);
    expect(w.stores.shipManifest.colonists[e]).toBe(58);
  });

  it('supplies exactly equal to the colonists feed everyone; the next day starts the attrition', () => {
    const w = lineWorld();
    const e = addShip(w, { dest: 5, supplies: 60 });
    tickDay(w);
    expect(w.stores.shipManifest.supplies[e]).toBe(0);
    expect(w.stores.shipManifest.colonists[e]).toBe(60);
    tickDay(w);
    expect(w.stores.shipManifest.colonists[e]).toBe(54);
  });

  it('passengers never go below 0; the last colonists die and the ship is Lost (AllDead) on day 3', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { dest: 5, colonists: 3, supplies: 0 });
    tickDay(w);
    expect(s.shipManifest.colonists[e]).toBe(2);
    tickDay(w);
    expect(s.shipManifest.colonists[e]).toBe(1);
    expect(s.shipState.state[e]).toBe(InTransit);
    tickDay(w);
    expect(s.shipManifest.colonists[e]).toBe(0);
    expect(s.shipState.state[e]).toBe(Lost);
    expect(s.shipLog.lostReason[e]).toBe(LostReason.AllDead);
    expect(s.shipLog.lostDay[e]).toBe(3);
    ticks(w, 3);
    expect(s.shipManifest.colonists[e]).toBe(0);
  });

  it('a Lost ship stops everything: no movement, no fuel, no supplies', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { dest: 5, colonists: 1, supplies: 0 });
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Lost);
    const progress = s.shipRoute.progress[e];
    const fuel = s.shipManifest.fuel[e];
    ticks(w, 5);
    expect(s.shipRoute.progress[e]).toBe(progress);
    expect(s.shipManifest.fuel[e]).toBe(fuel);
  });
});

describe('SurveySystem: the destination is surveyed as the ship approaches', () => {
  function surveyDays(kit: number): { scanned: number; surveyed: number } {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { kit });
    const planet = s.shipRoute.destPlanet[e];
    let scanned = 0;
    let surveyed = 0;
    for (let d = 1; d <= 17; d++) {
      tickDay(w);
      if (scanned === 0 && s.planet.survey[planet] >= Survey.Scanned) scanned = d;
      if (surveyed === 0 && s.planet.survey[planet] >= Survey.Surveyed) surveyed = d;
    }
    return { scanned, surveyed };
  }

  it('without kit: Scanned when 60% of the leg is left (day 7), Surveyed at 25% (day 13)', () => {
    expect(surveyDays(0)).toEqual({ scanned: 7, surveyed: 13 });
  });

  it('each survey kit step adds 5 points to both thresholds: 2 kits give day 5 and day 11', () => {
    expect(surveyDays(2)).toEqual({ scanned: 5, surveyed: 11 });
  });

  it('the kit bonus is capped at 30 points: a huge kit (above 100%) cannot survey at launch', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { kit: 1000 }); // 5000 points uncapped
    const planet = s.shipRoute.destPlanet[e];
    expect(s.planet.survey[planet]).toBe(Survey.Unknown);
    tickDay(w);
    expect(s.planet.survey[planet]).toBe(Survey.Unknown);
    // Capped at 30: Scanned at 90% of the leg left (day 2), Surveyed at 55% left (day 8).
    expect(surveyDays(1000)).toEqual({ scanned: 2, surveyed: 8 });
    expect(surveyDays(6)).toEqual(surveyDays(1000));
  });

  it('the known habitability range narrows with the level and always contains the truth', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    const planet = s.shipRoute.destPlanet[e];
    const hab = s.planet.habitability[planet];
    expect(hab).toBe(73);
    expect([s.planetSurvey.habLo[planet], s.planetSurvey.habHi[planet]]).toEqual([0, 100]);
    ticks(w, 7);
    expect(s.planet.survey[planet]).toBe(Survey.Scanned);
    expect([s.planetSurvey.habLo[planet], s.planetSurvey.habHi[planet]]).toEqual([26, 76]);
    ticks(w, 6);
    expect(s.planet.survey[planet]).toBe(Survey.Surveyed);
    const lo = s.planetSurvey.habLo[planet];
    const hi = s.planetSurvey.habHi[planet];
    expect(hi - lo).toBeLessThanOrEqual(16);
    expect(lo).toBeGreaterThanOrEqual(26);
    expect(hi).toBeLessThanOrEqual(76);
    expect(lo <= hab && hab <= hi).toBe(true);
    expect([lo, hi]).toEqual([71, 76]);
  });

  it('the survey never decreases: a second ship, a reroute away and idle days leave it alone', () => {
    const w = lineWorld();
    const s = w.stores;
    const near = addShip(w);
    const planet = s.shipRoute.destPlanet[near];
    ticks(w, 13);
    expect(s.planet.survey[planet]).toBe(Survey.Surveyed);
    const lo = s.planetSurvey.habLo[planet];
    const hi = s.planetSurvey.habHi[planet];
    // A fresh ship that has barely left cannot lower it.
    addShip(w, { kit: 0 });
    let prev: number = s.planet.survey[planet];
    for (let d = 0; d < 20; d++) {
      tickDay(w);
      expect(s.planet.survey[planet]).toBeGreaterThanOrEqual(prev);
      prev = s.planet.survey[planet];
      expect(s.planetSurvey.habLo[planet]).toBeGreaterThanOrEqual(lo);
      expect(s.planetSurvey.habHi[planet]).toBeLessThanOrEqual(hi);
    }
    expect(s.planet.survey[planet]).toBe(Survey.Surveyed);
  });

  it('survey level ranks the founding odds band through LoadoutMath: it narrows at each level', () => {
    // Scout, 3 passengers (60 colonists), 5000 supplies over a 17-day trip: margin 490%.
    const margin = supplyMarginPct(5000, 60, 17);
    expect(margin).toBe(490);
    const unknown = foundingOddsBand(0, 100, Survey.Unknown, 5000, 60, 0, 17, 2, -1);
    const scanned = foundingOddsBand(26, 76, Survey.Scanned, 5000, 60, 0, 17, 2, -1);
    const surveyed = foundingOddsBand(71, 76, Survey.Surveyed, 5000, 60, 0, 17, 2, -1);
    expect(unknown).toEqual({ lo: 0, hi: 60 });
    expect(scanned).toEqual({ lo: 6, hi: 45 });
    expect(surveyed).toEqual({ lo: 17, hi: 44 });
    expect(unknown.hi - unknown.lo).toBeGreaterThan(scanned.hi - scanned.lo);
    expect(scanned.hi - scanned.lo).toBeGreaterThan(surveyed.hi - surveyed.lo);
  });

  it('survey is deterministic: two runs give the same ranges', () => {
    const run = (): number[] => {
      const w = lineWorld(7);
      const e = addShip(w);
      ticks(w, 13);
      const p = w.stores.shipRoute.destPlanet[e];
      return [w.stores.planetSurvey.habLo[p], w.stores.planetSurvey.habHi[p]];
    };
    expect(run()).toEqual(run());
  });
});
