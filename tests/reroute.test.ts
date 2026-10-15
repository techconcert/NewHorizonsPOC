// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Command, RejectReason } from '../src/shared/commands';
import {
  REROUTE_PENALTY_FUEL,
  rangeFp,
  rerouteFuelCost,
  rerouteOptions,
  reroutePreview,
  rerouteRangeFp,
  type ReroutePoint,
  type RerouteTargets,
} from '../src/shared/loadout';
import { ExpeditionStatus } from '../src/shared/planetfall';
import { getLoggedCommand } from '../src/sim/commands';
import { G_LOG, G_PLANET, G_SYSTEM, ShipStateId } from '../src/sim/components';
import { shipXFp, shipYFp, spendableFuel } from '../src/sim/ships';
import { tickDay } from '../src/sim/tick';
import { checkReroute } from '../src/sim/reroute';
import { spawnEntity, submit, type World } from '../src/sim/world';
import { addShip, CARD, lineWorld, planetOf, send, stage, ticks } from './helpers/transit';

const { InTransit, Arrived } = ShipStateId;

function reroute(w: World, ship: number, target: number) {
  return send(w, { type: 'RerouteShip', ship, target });
}

function reason(w: World, ship: number, target: number): RejectReason | 'OK' {
  const r = submit(w, { type: 'RerouteShip', ship, target } as Command);
  if (r.ok) {
    // Drain the accepted command so the next probe starts clean (no state change is asserted here).
    return 'OK';
  }
  return r.reason;
}

describe('reroute cost = fixed penalty + the new distance (worked examples)', () => {
  it('the penalty is 200 fuel (transit.json) and the formula adds fuel for the new leg', () => {
    expect(REROUTE_PENALTY_FUEL).toBe(200);
    // 270 world units at Economy burn 5 fuel per unit: 1350, plus the penalty.
    expect(rerouteFuelCost(69120, 0)).toBe(1550);
    // Cruise burns 7.5 per unit; 191 units: ceil(1432.5) = 1433, plus the penalty.
    expect(rerouteFuelCost(48896, 1)).toBe(1633);
  });

  it('example 1: 5 days out, reroute to a planet 270 units away: pays 200 now, 1350 on the way', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    ticks(w, 5);
    expect(s.shipRoute.progress[e]).toBe(7680);
    expect(s.shipManifest.fuel[e]).toBe(3850);
    const target = planetOf(w, 3);

    // The preview the UI shows, from the same shared math.
    const p = reroutePreview(69120, {
      hull: 0,
      speed: 0,
      fuel: spendableFuel(w, e),
      supplies: s.shipManifest.supplies[e],
      colonists: 60,
      delay: 0,
    });
    expect(p.tripFuel).toBe(1350);
    expect(p.penaltyFuel).toBe(200);
    expect(p.totalFuel).toBe(1550);
    expect(p.fuelAfter).toBe(2300);
    expect(p.etaDays).toBe(45);
    expect(p.inRange).toBe(true);
    expect(p.supplyMarginPct).toBe(174); // 4700 supplies x 100 / (60 colonists x 45 days)

    expect(reroute(w, e, target)).toEqual({ ok: true });
    expect(s.shipManifest.fuel[e]).toBe(3650); // only the penalty is paid at once
    expect(s.shipRoute.destPlanet[e]).toBe(target);
    expect(s.shipRoute.distance[e]).toBe(69120);
    expect(s.shipRoute.progress[e]).toBe(0);
    expect([s.shipRoute.originX[e], s.shipRoute.originY[e]]).toEqual([130 * 256, 500 * 256]);
    expect(s.shipState.state[e]).toBe(InTransit);

    ticks(w, 44);
    expect(s.shipState.state[e]).toBe(InTransit);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.run.day[0]).toBe(5 + 45);
    expect(s.shipManifest.fuel[e]).toBe(p.fuelAfter); // the preview was exact
    expect(s.currPosition[e * 2]).toBe(400);
  });

  it('example 2: a Cruise ship with a half-burned unit pays on the spendable fuel (fuel - 1)', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { speed: 1 });
    tickDay(w);
    expect(s.shipManifest.fuel[e]).toBe(3933);
    expect(s.shipRoute.fuelFrac[e]).toBe(1_280_000);
    expect(spendableFuel(w, e)).toBe(3932);
    expect(shipXFp(w, e)).toBe(109 * 256);
    expect(shipYFp(w, e)).toBe(500 * 256);
    // Sys 2 is 191 units from x = 109: 48896 grid, 1433 fuel, 1633 in all.
    s.shipManifest.fuel[e] = 1633; // spendable 1632: one short
    expect(checkReroute(w, { type: 'RerouteShip', ship: e, target: planetOf(w, 2) })).toBe(
      'OUT_OF_RANGE',
    );
    s.shipManifest.fuel[e] = 1634; // spendable 1633: exactly enough
    expect(checkReroute(w, { type: 'RerouteShip', ship: e, target: planetOf(w, 2) })).toBeNull();
    expect(reroute(w, e, planetOf(w, 2))).toEqual({ ok: true });
    expect(s.shipManifest.fuel[e]).toBe(1434);
    // Fly it: the leg burns 1433 and the ship arrives with the unit it had to spare.
    ticks(w, 22);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipManifest.fuel[e]).toBe(1);
  });

  it('range boundary from the start: 1700 fuel reaches 300 units (1500 + 200), 1699 does not', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    const far = planetOf(w, 3);
    s.shipManifest.fuel[e] = 1699;
    expect(reason(w, e, far)).toBe('OUT_OF_RANGE');
    s.shipManifest.fuel[e] = 1700;
    expect(reason(w, e, far)).toBe('OK');
    // The range ring the UI draws has exactly that radius.
    expect(rerouteRangeFp(1700, 0)).toBe(76800);
    expect(rangeFp(1500, 0)).toBe(76800);
    expect(rerouteRangeFp(200, 0)).toBe(0);
    expect(rerouteRangeFp(100, 0)).toBe(0);
  });

  it('the new leg is flown at the ship speed setting and recomputes ETA from the exact position', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { hull: 1, speed: 2 }); // Ark, Hard Burn: 10 units a day
    ticks(w, 3);
    expect(shipXFp(w, e)).toBe(130 * 256);
    expect(reroute(w, e, planetOf(w, 2))).toEqual({ ok: true });
    expect(s.shipRoute.distance[e]).toBe(170 * 256);
    expect(s.ship.speedSetting[e]).toBe(2);
  });
});

describe('reroute rejects with a specific reason', () => {
  it('NO_SUCH_SHIP: a colony, an empty id, a negative id, a huge id', () => {
    const w = lineWorld();
    const t = planetOf(w, 2);
    addShip(w);
    expect(reason(w, w.homeColony, t)).toBe('NO_SUCH_SHIP');
    expect(reason(w, 50, t)).toBe('NO_SUCH_SHIP');
    expect(reason(w, -1, t)).toBe('NO_SUCH_SHIP');
    expect(reason(w, 2 ** 31 - 1, t)).toBe('NO_SUCH_SHIP');
  });

  it('SHIP_LOST', () => {
    const w = lineWorld();
    const e = addShip(w, { dest: 5, colonists: 1, supplies: 0 });
    tickDay(w);
    expect(w.stores.shipState.state[e]).toBe(ShipStateId.Lost);
    expect(reason(w, e, planetOf(w, 2))).toBe('SHIP_LOST');
  });

  it('SHIP_DRIFTING', () => {
    const w = lineWorld();
    const e = addShip(w, { fuel: 100 });
    ticks(w, 4);
    expect(w.stores.shipState.state[e]).toBe(ShipStateId.Drifting);
    expect(reason(w, e, planetOf(w, 2))).toBe('SHIP_DRIFTING');
  });

  it('EVENT_PENDING: resolve the card first', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Micrometeor);
    expect(reason(w, e, planetOf(w, 2))).toBe('EVENT_PENDING');
  });

  it('an arrived ship with nobody on the ground may leave; with an expedition out it must re-embark first', () => {
    const w = lineWorld();
    const e = addShip(w);
    ticks(w, 17);
    expect(w.stores.shipState.state[e]).toBe(Arrived);
    expect(reason(w, e, planetOf(w, 2))).toBe('OK');
    const x = spawnEntity(w);
    w.stores.expedition.status[x] = ExpeditionStatus.Active;
    w.stores.expedition.ship[x] = e;
    expect(reason(w, e, planetOf(w, 2))).toBe('EXPEDITION_ACTIVE');
    w.stores.expedition.status[x] = ExpeditionStatus.Returned;
    expect(reason(w, e, planetOf(w, 2))).toBe('OK');
  });

  it('INVALID_TARGET: negative, past the last planet, huge', () => {
    const w = lineWorld();
    const e = addShip(w);
    const n = w.stores.counts[G_PLANET];
    expect(reason(w, e, -1)).toBe('INVALID_TARGET');
    expect(reason(w, e, n)).toBe('INVALID_TARGET');
    expect(reason(w, e, 2 ** 31 - 1)).toBe('INVALID_TARGET');
    expect(reason(w, e, n - 1)).toBe('OUT_OF_RANGE'); // the last planet exists (parked far away)
  });

  it('SAME_TARGET: already flying there', () => {
    const w = lineWorld();
    const e = addShip(w);
    expect(reason(w, e, planetOf(w, 1))).toBe('SAME_TARGET');
  });

  it('OUT_OF_RANGE: not enough fuel for penalty plus leg, also with no fuel at all', () => {
    const w = lineWorld();
    const e = addShip(w, { fuel: 1000 });
    expect(reason(w, e, planetOf(w, 3))).toBe('OUT_OF_RANGE');
    w.stores.shipManifest.fuel[e] = 150; // less than the penalty alone
    expect(reason(w, e, planetOf(w, 2))).toBe('OUT_OF_RANGE');
  });

  it('checks run in order: a lost ship with a bad target says SHIP_LOST', () => {
    const w = lineWorld();
    const e = addShip(w);
    w.stores.shipState.state[e] = ShipStateId.Lost;
    expect(reason(w, e, -5)).toBe('SHIP_LOST');
  });

  it('a rejected command is neither queued, logged nor applied', () => {
    const w = lineWorld();
    const e = addShip(w);
    const fuel = w.stores.shipManifest.fuel[e];
    expect(submit(w, { type: 'RerouteShip', ship: e, target: planetOf(w, 1) })).toEqual({
      ok: false,
      reason: 'SAME_TARGET',
    });
    expect(w.queue.count).toBe(0);
    expect(w.stores.counts[G_LOG]).toBe(0);
    expect(w.stores.shipManifest.fuel[e]).toBe(fuel);
  });

  it('a malformed reroute is INVALID_SHAPE', () => {
    const w = lineWorld();
    expect(submit(w, { type: 'RerouteShip', ship: 2.5, target: 1 })).toEqual({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
    expect(submit(w, { type: 'RerouteShip', ship: 2 })).toEqual({
      ok: false,
      reason: 'INVALID_SHAPE',
    });
  });

  it('a reroute that was valid when queued but not when applied is dropped, and stays in the log', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    expect(submit(w, { type: 'RerouteShip', ship: e, target: planetOf(w, 2) })).toEqual({
      ok: true,
    });
    s.shipState.state[e] = ShipStateId.Drifting; // fate intervenes before the next tick
    tickDay(w);
    expect(s.shipRoute.destPlanet[e]).toBe(planetOf(w, 1));
    expect(s.shipManifest.fuel[e]).toBe(4000);
    expect(s.counts[G_LOG]).toBe(1);
    expect(getLoggedCommand(s, 0)).toEqual({
      type: 'RerouteShip',
      ship: e,
      target: planetOf(w, 2),
    });
  });
});

describe('unload at an own colony', () => {
  it('rerouting home: on arrival colonists, supplies and fuel move to the stockpile exactly', () => {
    const w = lineWorld();
    const s = w.stores;
    const home = w.homeColony;
    const e = addShip(w);
    ticks(w, 5);
    // 30 units out, 7680 grid back: 150 fuel and 5 days; the penalty is 200.
    expect(reroute(w, e, w.homePlanet)).toEqual({ ok: true });
    expect(s.shipRoute.distance[e]).toBe(7680);
    expect(s.shipManifest.fuel[e]).toBe(3650);
    ticks(w, 4);
    expect(s.shipState.state[e]).toBe(InTransit);
    expect(s.colony.population[home]).toBe(100000);
    tickDay(w);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.shipLog.arrivedDay[e]).toBe(10);
    // 9 days of eating (the arrival day's colonists are already ashore): 5000 - 540 = 4460.
    // The homeworld also earned 10 days of income (M5): 170 Supplies, 12 Fuel and 33 Production a day.
    expect(s.colony.population[home]).toBe(100000 + 60);
    expect(s.stockpile.supplies[home]).toBe(500000 + 4460 + 1700);
    expect(s.stockpile.fuel[home]).toBe(20000 + 3500 + 120);
    expect(s.shipManifest.colonists[e]).toBe(0);
    expect(s.shipManifest.supplies[e]).toBe(0);
    expect(s.shipManifest.fuel[e]).toBe(0);
    expect(s.stockpile.production[home]).toBe(5000 + 330);
    // An empty arrived ship is inert: nothing dies, nothing is Lost.
    ticks(w, 30);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.run.shipsLost[0]).toBe(0);
  });

  it('works for any own colony, not only the homeworld', () => {
    const w = lineWorld();
    const s = w.stores;
    const colony = spawnEntity(w);
    const planet = planetOf(w, 2);
    s.colony.planet[colony] = planet;
    s.colony.population[colony] = 1000;
    s.stockpile.supplies[colony] = 1_000_000;
    s.stockpile.fuel[colony] = 50;
    s.planet.owner[planet] = colony;
    const e = addShip(w, { colonists: 20, supplies: 1000, fuel: 3000 });
    expect(reroute(w, e, planet)).toEqual({ ok: true });
    // 200 units away: 200 x 5 = 1000 fuel, 34 days (ceil(51200 / 1536)).
    ticks(w, 34);
    expect(s.shipState.state[e]).toBe(Arrived);
    expect(s.colony.population[colony]).toBe(1020);
    // The colony's own economy (M5): +40 + population / 5 settlement supplies and 1 supply eaten per person every day;
    // the ship's 20 colonists ate for 33 days and the rest of its supplies are unloaded on day 34.
    expect(s.stockpile.supplies[colony]).toBe(
      1_000_000 + 1000 - 33 * 20 - 33 * (1000 - 240) - (1020 - 244),
    );
    expect(s.stockpile.fuel[colony]).toBe(50 + 3000 - 200 - 1000);
  });
});

describe('shared reroute options agree with the sim', () => {
  function targetsOf(w: World): RerouteTargets {
    const s = w.stores;
    const nSys = s.counts[G_SYSTEM];
    const nPl = s.counts[G_PLANET];
    return {
      count: nPl,
      planetSystem: Array.from(s.planet.system.subarray(0, nPl)),
      systemXFp: Array.from(s.system.x.subarray(0, nSys)),
      systemYFp: Array.from(s.system.y.subarray(0, nSys)),
      planetOwned: Array.from(s.planet.owner.subarray(0, nPl), (o) => (o >= 0 ? 1 : 0)),
    };
  }

  it('lists exactly the planets the sim would accept, with the sim fuel numbers', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { fuel: 2000 });
    ticks(w, 4);
    const point: ReroutePoint = {
      xFp: shipXFp(w, e),
      yFp: shipYFp(w, e),
      destPlanet: s.shipRoute.destPlanet[e],
      hull: 0,
      speed: 0,
      fuel: spendableFuel(w, e),
      supplies: s.shipManifest.supplies[e],
      colonists: s.shipManifest.colonists[e],
      delay: 0,
    };
    const options = rerouteOptions(point, targetsOf(w));
    const listed = options.map((o) => o.planet);
    const accepted: number[] = [];
    for (let p = 0; p < s.counts[G_PLANET]; p++) {
      if (checkReroute(w, { type: 'RerouteShip', ship: e, target: p }) === null) accepted.push(p);
    }
    expect(listed).toEqual(accepted);
    expect(listed.length).toBeGreaterThan(3);
    // Home is in range and unloads; the rest of the line within 2000 - 200 fuel too.
    const home = options.find((o) => o.planet === w.homePlanet);
    expect(home?.unloads).toBe(true);
    expect(home?.preview.totalFuel).toBe(200 + 120); // 24 units back at 5 per unit
    expect(options.every((o) => o.preview.inRange)).toBe(true);
    // Sorted ascending by planet index and the current destination is not offered.
    expect(listed.includes(s.shipRoute.destPlanet[e])).toBe(false);
    expect([...listed].sort((a, b) => a - b)).toEqual(listed);
  });
});
