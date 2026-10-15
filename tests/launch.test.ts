// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { LaunchShipCommand } from '../src/shared/commands';
import type { FromWorker } from '../src/shared/messages';
import { ceilDiv, fuelNeeded, supplyAmount } from '../src/shared/loadout';
import {
  C_ENTITY,
  C_FUEL,
  C_POPULATION,
  C_PRODUCTION,
  C_SPACEPORT,
  C_SUPPLIES,
  C_SYSTEM,
  createSnapshot,
  META_COLONY_COUNT,
  META_DAY,
  META_PLANET_COUNT,
  META_SHIP_COUNT,
  SHIP_POS_STRIDE,
  SNAPSHOT_MAX_SHIPS,
  type Snapshot,
} from '../src/shared/snapshot';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import {
  FP_SCALE,
  G_ENTITY,
  G_LOG,
  G_PLANET,
  MAX_ENTITIES,
  ShipStateId,
} from '../src/sim/components';
import { countShips, planetDistanceFp } from '../src/sim/launch';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { createWorld, submit, type World } from '../src/sim/world';
import { fillSnapshot } from '../src/worker/fill';
import { systemDistanceFpFromSnapshot } from '../src/ui/missionModel';
import { createHandler, MIN_SNAPSHOT_INTERVAL_MS } from '../src/worker/handler';

/** bitecs ids start at 1: the homeworld colony is entity 1 and the first ship entity 2. */
const HOME = 1;
const SHIP = 2;

/** Recorded state hash: seed 42, one Scout launch on day 10, hash after day 100. Review on purpose. */
const GOLDEN_LAUNCH_SEED42_DAY100 = 1559976635; // M7c re-record (D-136, SIM_VERSION 5): clock 8000, win 10 colonies; earlier: M7a re-record (D-132, SIM_VERSION 3): 30 cards, native variants, find tables; earlier: M5 review 2 (D-107 to D-111, SIM_VERSION 2); earlier M5 (D-098), D-101 to D-106

/** Planet (not owned) nearest to / farthest from the homeworld, ties to the lowest index. */
function targets(w: World): { near: number; far: number } {
  const s = w.stores;
  let near = -1;
  let far = -1;
  let nd = Infinity;
  let fd = -1;
  for (let p = 0; p < s.counts[G_PLANET]; p++) {
    if (s.planet.owner[p] >= 0) continue;
    const d = planetDistanceFp(s, w.homePlanet, p);
    if (d < nd) {
      nd = d;
      near = p;
    }
    if (d > fd) {
      fd = d;
      far = p;
    }
  }
  return { near, far };
}

/** The reference Scout loadout: 3 passengers, 10 supplies, 40 fuel, 2 kit, 2 security = 59 of 60 cargo. */
function scoutLaunch(
  w: World,
  target: number,
  over: Partial<LaunchShipCommand> = {},
): LaunchShipCommand {
  return {
    type: 'LaunchShip',
    colony: w.homeColony,
    target,
    hull: 0,
    passengers: 3,
    supplies: 10,
    fuel: 40,
    speed: 0,
    kit: 2,
    security: 2,
    ...over,
  };
}

function launch(w: World, cmd: LaunchShipCommand) {
  const r = submit(w, cmd);
  if (r.ok) applyCommandsNow(w);
  return r;
}

describe('LaunchShip accepts and spawns a ship', () => {
  it('deducts exactly: 60 colonists, 5000 supplies, 4000 fuel, 56 Production', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    const day = s.run.day[0];
    expect(launch(w, scoutLaunch(w, near))).toEqual({ ok: true });
    expect(s.colony.population[HOME]).toBe(100000 - 60);
    expect(s.stockpile.supplies[HOME]).toBe(500000 - 5000);
    expect(s.stockpile.fuel[HOME]).toBe(20000 - 4000);
    expect(s.stockpile.production[HOME]).toBe(5000 - 56); // hull 40 + 2 kit x 5 + 2 security x 3
    expect(s.run.day[0]).toBe(day); // launched at once, no tick needed
  });

  it('the ship entity carries the loadout and sits at the origin InTransit', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    launch(w, scoutLaunch(w, near));
    const e = SHIP;
    expect(w.homeColony).toBe(HOME);
    expect(s.counts[G_ENTITY]).toBe(3);
    expect(s.ship.hull[e]).toBe(0);
    expect(s.ship.speedSetting[e]).toBe(0);
    expect(s.ship.integrity[e]).toBe(100);
    expect(s.shipManifest.colonists[e]).toBe(60);
    expect(s.shipManifest.supplies[e]).toBe(5000);
    expect(s.shipManifest.fuel[e]).toBe(4000);
    expect(s.shipManifest.kit[e]).toBe(2);
    expect(s.shipManifest.security[e]).toBe(2);
    expect(s.shipRoute.destPlanet[e]).toBe(near);
    expect(s.shipRoute.originSystem[e]).toBe(s.planet.system[w.homePlanet]);
    expect(s.shipRoute.distance[e]).toBe(planetDistanceFp(s, w.homePlanet, near));
    expect(s.shipRoute.progress[e]).toBe(0);
    expect(s.shipState.state[e]).toBe(ShipStateId.InTransit);
    expect(ShipStateId.InTransit).toBe(8);
    const sys = s.planet.system[w.homePlanet];
    expect(s.currPosition[e * 2]).toBe(s.system.x[sys] / FP_SCALE);
    expect(s.currPosition[e * 2 + 1]).toBe(s.system.y[sys] / FP_SCALE);
    expect(countShips(s)).toBe(1);
  });

  it('the ship leaves its origin on the first tick: one day of Scout Economy flight (1536 grid units)', () => {
    const w = createWorld(42);
    const { far } = targets(w);
    launch(w, scoutLaunch(w, far));
    const x = w.stores.currPosition[SHIP * 2];
    tickDay(w);
    expect(w.stores.shipRoute.progress[SHIP]).toBe(1536);
    expect(w.stores.currPosition[SHIP * 2]).not.toBe(x);
    expect(w.stores.prevPosition[SHIP * 2]).toBe(x);
    expect(w.stores.shipState.state[SHIP]).toBe(ShipStateId.InTransit);
  });

  it('is logged with all nine arguments and round-trips', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    const cmd = scoutLaunch(w, near);
    launch(w, cmd);
    expect(w.stores.counts[G_LOG]).toBe(1);
    expect(getLoggedCommand(w.stores, 0)).toEqual(cmd);
  });

  it('a stockpile exactly equal to the cost is enough and ends at zero', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    s.colony.population[HOME] = 60;
    s.stockpile.supplies[HOME] = 5000;
    s.stockpile.fuel[HOME] = 4000;
    s.stockpile.production[HOME] = 56;
    expect(launch(w, scoutLaunch(w, near))).toEqual({ ok: true });
    expect(s.colony.population[HOME]).toBe(0);
    expect(s.stockpile.supplies[HOME]).toBe(0);
    expect(s.stockpile.fuel[HOME]).toBe(0);
    expect(s.stockpile.production[HOME]).toBe(0);
  });

  it('a loadout exactly at the hull cap launches (Scout 60: 10/30/10/5 kit/0)', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(
      launch(
        w,
        scoutLaunch(w, near, { passengers: 10, supplies: 30, fuel: 10, kit: 5, security: 0 }),
      ),
    ).toEqual({ ok: true });
  });
});

describe('LaunchShip rejects with a specific reason', () => {
  const reason = (w: World, cmd: LaunchShipCommand) => {
    const r = submit(w, cmd);
    return r.ok ? 'ACCEPTED' : r.reason;
  };

  it('NO_SUCH_COLONY: unknown entity, a ship, a negative id', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reason(w, scoutLaunch(w, near, { colony: 7 }))).toBe('NO_SUCH_COLONY');
    expect(reason(w, scoutLaunch(w, near, { colony: -1 }))).toBe('NO_SUCH_COLONY');
    launch(w, scoutLaunch(w, near)); // entity 2 is now a ship
    expect(reason(w, scoutLaunch(w, near, { colony: SHIP }))).toBe('NO_SUCH_COLONY');
    expect(reason(w, scoutLaunch(w, near, { colony: 0 }))).toBe('NO_SUCH_COLONY'); // id 0 is unused
  });

  it('NO_SPACEPORT', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    w.stores.colony.spaceport[HOME] = 0;
    expect(reason(w, scoutLaunch(w, near))).toBe('NO_SPACEPORT');
  });

  it('INVALID_TARGET: out of range, negative, or already colonised', () => {
    const w = createWorld(42);
    expect(reason(w, scoutLaunch(w, -1))).toBe('INVALID_TARGET');
    expect(reason(w, scoutLaunch(w, w.stores.counts[G_PLANET]))).toBe('INVALID_TARGET');
    expect(reason(w, scoutLaunch(w, w.homePlanet))).toBe('INVALID_TARGET');
  });

  it('INVALID_HULL and INVALID_SPEED_SETTING', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reason(w, scoutLaunch(w, near, { hull: 3 }))).toBe('INVALID_HULL');
    expect(reason(w, scoutLaunch(w, near, { hull: -1 }))).toBe('INVALID_HULL');
    expect(reason(w, scoutLaunch(w, near, { speed: 3 }))).toBe('INVALID_SPEED_SETTING');
    expect(reason(w, scoutLaunch(w, near, { speed: -1 }))).toBe('INVALID_SPEED_SETTING');
  });

  it('INVALID_LOADOUT for negative dials; INVALID_SHAPE for fractional ones', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reason(w, scoutLaunch(w, near, { passengers: -1 }))).toBe('INVALID_LOADOUT');
    expect(reason(w, scoutLaunch(w, near, { security: -5 }))).toBe('INVALID_LOADOUT');
    expect(reason(w, scoutLaunch(w, near, { fuel: 2.5 }))).toBe('INVALID_SHAPE');
    expect(reason(w, scoutLaunch(w, near, { kit: NaN }))).toBe('INVALID_SHAPE');
  });

  it('OVER_CAPACITY: one cargo over the cap fails, nothing is deducted or spawned', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    // 10 + 30 + 10 + 5 kit (10 cargo) + 1 security = 61 of 60.
    const over = { passengers: 10, supplies: 30, fuel: 10, kit: 5, security: 1 };
    expect(reason(w, scoutLaunch(w, near, over))).toBe('OVER_CAPACITY');
    expect(w.queue.count).toBe(0);
    expect(s.counts[G_ENTITY]).toBe(2);
    expect(s.colony.population[HOME]).toBe(100000);
    expect(s.stockpile.production[HOME]).toBe(5000);
    expect(s.counts[G_LOG]).toBe(0);
  });

  it('NO_PASSENGERS', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reason(w, scoutLaunch(w, near, { passengers: 0 }))).toBe('NO_PASSENGERS');
  });

  it('OUT_OF_RANGE: no fuel to a far planet; one fuel step short fails, enough passes', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { far } = targets(w);
    expect(reason(w, scoutLaunch(w, far, { fuel: 0 }))).toBe('OUT_OF_RANGE');
    const need = fuelNeeded(planetDistanceFp(s, w.homePlanet, far), 0);
    expect(need).toBeGreaterThan(0);
    const steps = ceilDiv(need, 100);
    // Keep within the Scout cap (60): few passengers and supplies leave room for the fuel.
    const fit = { passengers: 3, supplies: 1, kit: 0, security: 0 };
    expect(steps + 4).toBeLessThanOrEqual(60);
    expect((steps - 1) * 100).toBeLessThan(need);
    expect(reason(w, scoutLaunch(w, far, { ...fit, fuel: steps - 1 }))).toBe('OUT_OF_RANGE');
    expect(reason(w, scoutLaunch(w, far, { ...fit, fuel: steps }))).toBe('ACCEPTED');
  });

  it('INSUFFICIENT_*: one short fails, exactly enough passes', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    s.colony.population[HOME] = 59;
    expect(reason(w, scoutLaunch(w, near))).toBe('INSUFFICIENT_PASSENGERS');
    s.colony.population[HOME] = 60;
    s.stockpile.supplies[HOME] = 4999;
    expect(reason(w, scoutLaunch(w, near))).toBe('INSUFFICIENT_SUPPLIES');
    s.stockpile.supplies[HOME] = 5000;
    s.stockpile.fuel[HOME] = 3999;
    expect(reason(w, scoutLaunch(w, near))).toBe('INSUFFICIENT_FUEL');
    s.stockpile.fuel[HOME] = 4000;
    s.stockpile.production[HOME] = 55;
    expect(reason(w, scoutLaunch(w, near))).toBe('INSUFFICIENT_PRODUCTION');
    s.stockpile.production[HOME] = 56;
    expect(reason(w, scoutLaunch(w, near))).toBe('ACCEPTED');
  });

  it('ENTITY_LIMIT when ids run out', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    w.stores.counts[G_ENTITY] = MAX_ENTITIES;
    expect(reason(w, scoutLaunch(w, near))).toBe('ENTITY_LIMIT');
  });

  it('SHIP_LIMIT: the 257th ship is refused', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    s.colony.population[HOME] = 1_000_000_000;
    s.stockpile.supplies[HOME] = 1_000_000_000;
    s.stockpile.fuel[HOME] = 1_000_000_000;
    s.stockpile.production[HOME] = 1_000_000_000;
    const tiny = { passengers: 1, supplies: 1, fuel: 40, kit: 0, security: 0 };
    for (let i = 0; i < SNAPSHOT_MAX_SHIPS; i++) {
      expect(launch(w, scoutLaunch(w, near, tiny))).toEqual({ ok: true });
    }
    expect(countShips(s)).toBe(256);
    expect(reason(w, scoutLaunch(w, near, tiny))).toBe('SHIP_LIMIT');
  });

  it('two launches queued together: the one the stockpile can no longer pay for is dropped at apply', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    s.colony.population[HOME] = 100; // one 60-colonist launch fits, two do not
    expect(submit(w, scoutLaunch(w, near))).toEqual({ ok: true });
    expect(submit(w, scoutLaunch(w, near))).toEqual({ ok: true }); // both pass at submit
    tickDay(w);
    expect(countShips(s)).toBe(1);
    expect(s.colony.population[HOME]).toBe(40);
    expect(s.counts[G_LOG]).toBe(2); // both entries are logged; the second had no effect (dropped at apply)
  });
});

describe('determinism and replay with a LaunchShip in the log', () => {
  function run(seed: number, withLaunch: boolean): World {
    const w = createWorld(seed);
    const { near } = targets(w);
    for (let day = 0; day < 100; day++) {
      if (withLaunch && day === 10) expect(submit(w, scoutLaunch(w, near)).ok).toBe(true);
      tickDay(w);
    }
    return w;
  }

  it('two runs of the same seed and launch give the same hash', () => {
    const a = run(42, true);
    const b = run(42, true);
    expect(a.stores.run.stateHash[0]).toBe(b.stores.run.stateHash[0]);
    expect(countShips(a.stores)).toBe(1);
  });

  it('matches the recorded golden hash', () => {
    expect(run(42, true).stores.run.stateHash[0]).toBe(GOLDEN_LAUNCH_SEED42_DAY100);
  });

  it('replaying seed plus command log reproduces the hash at every checkpoint', () => {
    const live = createWorld(42);
    const { near } = targets(live);
    const liveHashes: number[] = [];
    for (let day = 0; day < 100; day++) {
      if (day % 10 === 0) liveHashes.push(live.stores.run.stateHash[0]); // before the day's commands
      if (day === 10) submit(live, scoutLaunch(live, near));
      tickDay(live);
    }
    liveHashes.push(live.stores.run.stateHash[0]);

    const replay = createWorld(42);
    const replayHashes: number[] = [];
    let next = 0;
    const logCount = live.stores.counts[G_LOG];
    expect(logCount).toBe(1);
    for (let day = 0; day < 100; day++) {
      if (day % 10 === 0) replayHashes.push(replay.stores.run.stateHash[0]);
      while (next < logCount && live.stores.log.day[next] === day) {
        replayLogged(replay, live.stores, next);
        next++;
      }
      tickDay(replay);
    }
    replayHashes.push(replay.stores.run.stateHash[0]);
    expect(replayHashes).toEqual(liveHashes);
    expect(replay.stores.shipManifest.fuel[SHIP]).toBe(4000);
  });

  it('the state hash changes when a ship is launched, and differs from a run without it', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    const before = w.stores.run.stateHash[0];
    launch(w, scoutLaunch(w, near));
    expect(w.stores.run.stateHash[0]).not.toBe(before);
    expect(run(42, true).stores.run.stateHash[0]).not.toBe(run(42, false).stores.run.stateHash[0]);
  });

  it('a different loadout gives a different hash', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    const { near } = targets(a);
    launch(a, scoutLaunch(a, near));
    launch(b, scoutLaunch(b, near, { passengers: 4 }));
    expect(a.stores.run.stateHash[0]).not.toBe(b.stores.run.stateHash[0]);
  });
});

describe('raw replay (replayLogged)', () => {
  it('a launch dropped at apply time is dropped again in replay and the hash matches', () => {
    const setup = (): World => {
      const w = createWorld(42);
      w.stores.colony.population[HOME] = 100; // room for one 60-colonist launch only
      return w;
    };
    const live = setup();
    const { near } = targets(live);
    submit(live, scoutLaunch(live, near));
    submit(live, scoutLaunch(live, near)); // passes at submit, dropped at apply
    for (let i = 0; i < 20; i++) tickDay(live);
    expect(countShips(live.stores)).toBe(1);
    expect(live.stores.counts[G_LOG]).toBe(2);

    const replay = setup();
    for (let day = 0; day < 20; day++) {
      for (let i = 0; i < live.stores.counts[G_LOG]; i++) {
        if (live.stores.log.day[i] === day) replayLogged(replay, live.stores, i);
      }
      tickDay(replay);
    }
    expect(countShips(replay.stores)).toBe(1);
    expect(replay.stores.colony.population[HOME]).toBe(40);
    expect(replay.stores.run.stateHash[0]).toBe(live.stores.run.stateHash[0]);
  });

  it('refuses to replay an entry on the wrong day', () => {
    const live = createWorld(42);
    const { near } = targets(live);
    launch(live, scoutLaunch(live, near));
    const replay = createWorld(42);
    tickDay(replay);
    expect(() => replayLogged(replay, live.stores, 0)).toThrow(/day/);
  });
});

describe('oversized ids and values', () => {
  const reasonOf = (w: World, over: Partial<LaunchShipCommand>, target: number) => {
    const r = submit(w, scoutLaunch(w, target, over));
    return r.ok ? 'ACCEPTED' : r.reason;
  };
  it('colony ids of 2^31 and 1e300 are NO_SUCH_COLONY', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reasonOf(w, { colony: 2 ** 31 }, near)).toBe('NO_SUCH_COLONY');
    expect(reasonOf(w, { colony: 1e300 }, near)).toBe('NO_SUCH_COLONY');
    expect(reasonOf(w, { colony: -(2 ** 31) }, near)).toBe('NO_SUCH_COLONY');
  });
  it('target ids of 2^31 and 1e300 are INVALID_TARGET', () => {
    const w = createWorld(42);
    expect(reasonOf(w, {}, 2 ** 31)).toBe('INVALID_TARGET');
    expect(reasonOf(w, {}, 1e300)).toBe('INVALID_TARGET');
    expect(reasonOf(w, {}, -(2 ** 31))).toBe('INVALID_TARGET');
  });
  it('oversized hull, speed and dial values are rejected, never wrapped into the Int32 log', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    expect(reasonOf(w, { hull: 2 ** 31 }, near)).toBe('INVALID_HULL');
    expect(reasonOf(w, { speed: 1e300 }, near)).toBe('INVALID_SPEED_SETTING');
    expect(reasonOf(w, { passengers: 2 ** 31 }, near)).toBe('INVALID_LOADOUT');
    expect(reasonOf(w, { fuel: 1e300 }, near)).toBe('INVALID_LOADOUT');
    expect(w.queue.count).toBe(0);
  });
});

describe('golden launch hash: all three hulls and all three speeds', () => {
  const FLEET_GOLDEN = 1839125310; // M7c re-record (D-136, SIM_VERSION 5): clock 8000, win 10 colonies; earlier: M7a re-record (D-132, SIM_VERSION 3): 30 cards, native variants, find tables; earlier: M5 review 2 (D-107 to D-111, SIM_VERSION 2); earlier M5 (D-098), D-101 to D-106
  it('Scout/Economy, Ark/Cruise, Heavy Ark/Hard Burn launched on days 5, 10, 15', () => {
    const w = createWorld(42);
    const { near } = targets(w);
    const fleet: Record<number, Partial<LaunchShipCommand>> = {
      5: {},
      10: { hull: 1, speed: 1, passengers: 10, supplies: 20, fuel: 60, kit: 1, security: 1 },
      15: { hull: 2, speed: 2, passengers: 20, supplies: 40, fuel: 100, kit: 2, security: 0 },
    };
    for (let day = 0; day < 100; day++) {
      const over = fleet[day];
      if (over) expect(submit(w, scoutLaunch(w, near, over)).ok).toBe(true);
      tickDay(w);
    }
    const s = w.stores;
    // All three arrived by day 16 and keep eating in orbit (D-080). The Ark (ship 3, 200 colonists,
    // 10000 supplies) ran dry and its last colonists starved on day 95: Lost. The Scout and the
    // Heavy Ark are still Arrived with 15 and 6 colonists left and no supplies.
    expect(s.run.shipsLost[0]).toBe(1);
    expect([s.shipState.state[2], s.shipState.state[3], s.shipState.state[4]]).toEqual([
      ShipStateId.Arrived,
      ShipStateId.Lost,
      ShipStateId.Arrived,
    ]);
    expect(s.shipLog.lostDay[3]).toBe(95);
    expect([s.shipManifest.colonists[2], s.shipManifest.colonists[4]]).toEqual([15, 6]);
    expect(countShips(s)).toBe(2);
    expect([s.ship.hull[2], s.ship.hull[3], s.ship.hull[4]]).toEqual([0, 1, 2]);
    expect([s.ship.speedSetting[2], s.ship.speedSetting[3], s.ship.speedSetting[4]]).toEqual([
      0, 1, 2,
    ]);
    // Plus the homeworld's income over the 100 days (M5): 12 Fuel and 33 Production a day.
    expect(s.stockpile.fuel[HOME]).toBe(20000 - 4000 - 6000 - 10000 + 100 * 12);
    expect(s.stockpile.production[HOME]).toBe(5000 - 56 - 128 - 270 + 100 * 33);
    expect(s.run.stateHash[0]).toBe(FLEET_GOLDEN);
  });
});

describe('snapshot distance equals sim distance at the edge of the grid', () => {
  it('x = 256000 (the east edge, 1000 units) round-trips through float32 exactly', () => {
    const w = createWorld(42);
    const s = w.stores;
    s.system.x[0] = 256000;
    s.system.y[0] = 0;
    s.system.x[1] = 0;
    s.system.y[1] = 256000;
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.positions[0]).toBe(1000);
    const a = s.system.planetStart[0];
    const b = s.system.planetStart[1];
    expect(systemDistanceFpFromSnapshot(snap, 0, 1)).toBe(planetDistanceFp(s, a, b));
    expect(planetDistanceFp(s, a, b)).toBe(362039);
  });
});

describe('snapshot carries the ship, the colony stockpile and planet knowledge', () => {
  it('after a launch', () => {
    const w = createWorld(42);
    const s = w.stores;
    const { near } = targets(w);
    launch(w, scoutLaunch(w, near));
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);

    expect(snap.meta[META_SHIP_COUNT]).toBe(1);
    expect(snap.shipEntity[0]).toBe(SHIP);
    expect(snap.shipHull[0]).toBe(0);
    expect(snap.shipState[0]).toBe(ShipStateId.InTransit);
    const sys = s.planet.system[w.homePlanet];
    const x = s.system.x[sys] / FP_SCALE;
    const y = s.system.y[sys] / FP_SCALE;
    expect(Array.from(snap.shipPos.subarray(0, SHIP_POS_STRIDE))).toEqual(
      [x, y, x, y].map(Math.fround),
    );

    expect(snap.meta[META_COLONY_COUNT]).toBe(1);
    expect(Array.from(snap.colonies.subarray(0, 7))).toEqual([
      HOME, // C_ENTITY
      sys, // C_SYSTEM
      99940, // C_POPULATION
      495000, // C_SUPPLIES
      16000, // C_FUEL
      4944, // C_PRODUCTION
      1, // C_SPACEPORT
    ]);
    expect([
      C_ENTITY,
      C_SYSTEM,
      C_POPULATION,
      C_SUPPLIES,
      C_FUEL,
      C_PRODUCTION,
      C_SPACEPORT,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6]);

    expect(snap.meta[META_PLANET_COUNT]).toBe(s.counts[G_PLANET]);
    expect(snap.planetOwned[w.homePlanet]).toBe(1);
    expect(snap.planetOwned[near]).toBe(0);
    expect(snap.planetSurvey[w.homePlanet]).toBe(3); // Explored
    expect(snap.planetSurvey[near]).toBe(0); // Unknown
    expect([snap.planetHabLo[near], snap.planetHabHi[near]]).toEqual([0, 100]);
    expect(snap.planetSystem[near]).toBe(s.planet.system[near]);
    expect(snap.systemPlanetStart[sys]).toBe(s.system.planetStart[sys]);
  });

  it('before any launch there are no ships', () => {
    const snap = createSnapshot();
    fillSnapshot(createWorld(42), snap, 0);
    expect(snap.meta[META_SHIP_COUNT]).toBe(0);
    expect(snap.meta[META_COLONY_COUNT]).toBe(1);
  });
});

describe('worker handler', () => {
  function setup() {
    const out: FromWorker[] = [];
    let now = 1000;
    const handler = createHandler({ postMessage: (m) => void out.push(m) }, () => now);
    const advance = (ms: number) => {
      now += ms;
    };
    const snaps = () =>
      out.filter((m) => m.kind === 'snapshot').map((m) => (m as { snapshot: Snapshot }).snapshot);
    const results = () => out.filter((m) => m.kind === 'commandResult');
    return { handler, advance, snaps, results };
  }

  it('applies a LaunchShip at once: accepted reply, then a snapshot with the ship, same day', () => {
    const { near } = targets(createWorld(42));
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    h.advance(MIN_SNAPSHOT_INTERVAL_MS * 2);
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 5,
      command: { ...scoutLaunch(createWorld(42), near) },
    });
    expect(h.results()[0]).toMatchObject({ id: 5, result: { ok: true } });
    const last = h.snaps().at(-1) as Snapshot;
    expect(last.meta[META_SHIP_COUNT]).toBe(1);
    expect(last.meta[META_DAY]).toBe(0);
    expect(last.colonies[C_POPULATION]).toBe(99940);
  });

  it('the real worker path (immediate apply, running and paused) replays to the same hash', () => {
    const w0 = createWorld(42);
    const { near } = targets(w0);
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    for (let i = 0; i < 40; i++) {
      h.advance(100);
      h.handler.pump(); // 4 seconds at 1x: day 4
    }
    h.handler.onMessage({ kind: 'command', gen: 1, id: 1, command: scoutLaunch(w0, near) }); // running
    for (let i = 0; i < 30; i++) {
      h.advance(100);
      h.handler.pump();
    }
    h.handler.onMessage({ kind: 'setSpeed', gen: 1, speed: 0 });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 2,
      command: scoutLaunch(w0, near, { passengers: 4 }),
    }); // paused
    const live = (h.handler.getWorld() as World).stores;
    expect(h.results().every((r) => (r as { result: { ok: boolean } }).result.ok)).toBe(true);
    expect(countShips(live)).toBe(2);
    expect(live.counts[G_LOG]).toBe(3); // launch, pause, launch
    expect(live.log.day[0]).toBeGreaterThan(0);
    expect(live.log.day[0]).toBeLessThan(live.log.day[1]);
    expect(live.log.day[1]).toBe(live.run.day[0]); // pause and paused launch share the day
    expect(live.log.day[2]).toBe(live.run.day[0]);

    const replay = createWorld(42);
    let next = 0;
    for (;;) {
      while (next < live.counts[G_LOG] && live.log.day[next] === replay.stores.run.day[0]) {
        replayLogged(replay, live, next++);
      }
      if (replay.stores.run.day[0] >= live.run.day[0]) break;
      tickDay(replay);
    }
    expect(next).toBe(3);
    expect(replay.stores.run.day[0]).toBe(live.run.day[0]);
    expect(replay.stores.run.stateHash[0]).toBe(live.run.stateHash[0]);
  });

  it('replies with the reject reason', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 6,
      command: { ...scoutLaunch(createWorld(42), -1) },
    });
    expect(h.results()[0]).toMatchObject({
      id: 6,
      result: { ok: false, reason: 'INVALID_TARGET' },
    });
  });
});

describe('supply amounts used by the sim equal the shared formula', () => {
  it('supplyAmount of the reference loadout is 5000', () => {
    expect(
      supplyAmount({
        hull: 0,
        speed: 0,
        passengers: 3,
        supplies: 10,
        fuel: 40,
        kit: 2,
        security: 2,
      }),
    ).toBe(5000);
  });
});
