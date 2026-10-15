// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Command, CommandResult, LaunchShipCommand } from '../src/shared/commands';
import { CHOICE_COST_STRIDE, EVENT_CHOICE_COUNT } from '../src/shared/events';
import {
  copySnapshotInto,
  createSnapshot,
  META_PENDING_CARD,
  META_PENDING_COUNT,
  META_PENDING_SHIP,
  META_SHIP_COUNT,
  META_SHIPS_LOST,
  SNAPSHOT_MAX_SHIPS,
  snapshotBuffers,
} from '../src/shared/snapshot';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import {
  G_ENTITY,
  G_LOG,
  G_PLANET,
  LostReason,
  MAX_EVENT_DEFS,
  ShipStateId,
  type Stores,
} from '../src/sim/components';
import { pendingCount } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { planetDistanceFp } from '../src/sim/launch';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { createWorld, submit, type World } from '../src/sim/world';
import { fillSnapshot } from '../src/worker/fill';
import { addShip, CARD, lineWorld, send, stage, ticks } from './helpers/transit';

/** Unowned planets ordered by distance from the homeworld (ties to the lowest index). */
function planetsByDistance(w: World): number[] {
  const s = w.stores;
  const list: { p: number; d: number }[] = [];
  for (let p = 0; p < s.counts[G_PLANET]; p++) {
    if (s.planet.owner[p] < 0) list.push({ p, d: planetDistanceFp(s, w.homePlanet, p) });
  }
  list.sort((a, b) => a.d - b.d || a.p - b.p);
  return list.map((x) => x.p);
}

function launchCmd(w: World, target: number, over: Partial<LaunchShipCommand>): LaunchShipCommand {
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
    security: 0,
    ...over,
  };
}

interface Outcome {
  hashes: number[];
  accepted: number;
  rejected: number;
  resolved: number;
}

const SCENARIO_DAYS = 300;

/** A scripted multi-ship run: five launches, reroutes (one home to a colony, two valid, two refused),
 *  and every event card answered by a fixed rule. Commands are applied at once, like the worker. */
function liveScenario(): { w: World; out: Outcome } {
  const w = createWorld(42);
  const rank = planetsByDistance(w);
  const out: Outcome = { hashes: [], accepted: 0, rejected: 0, resolved: 0 };
  const note = (r: CommandResult) => {
    if (r.ok) out.accepted++;
    else out.rejected++;
  };
  const script: Record<number, Command[]> = {
    0: [launchCmd(w, rank[62], {})], // Scout, Economy, 436 units
    3: [
      launchCmd(w, rank[84], { hull: 1, speed: 1, passengers: 10, supplies: 40, fuel: 70, kit: 1 }),
    ],
    5: [
      launchCmd(w, rank[43], { hull: 2, speed: 2, passengers: 20, supplies: 60, fuel: 45, kit: 0 }),
    ],
    12: [{ type: 'RerouteShip', ship: 4, target: w.homePlanet }], // turn back and unload at home
    20: [launchCmd(w, rank[11], { speed: 2, fuel: 25, kit: 0, security: 2 })],
    30: [{ type: 'RerouteShip', ship: 4, target: rank[20] }], // refused: the ship is already home
    40: [{ type: 'RerouteShip', ship: 2, target: rank[40] }],
    // A gambler with food for 8 days on a 53-day trip: it starves and is Lost.
    50: [launchCmd(w, rank[40], { fuel: 20, supplies: 1, kit: 0 })],
    60: [{ type: 'RerouteShip', ship: 3, target: rank[75] }],
    120: [{ type: 'RerouteShip', ship: 5, target: rank[1] }], // refused: arrived long ago
  };
  for (let day = 0; day < SCENARIO_DAYS; day++) {
    for (const c of script[day] ?? []) note(send(w, c));
    tickDay(w);
    out.hashes.push(w.stores.run.stateHash[0]);
    // The player's rule: answer every card at once with choice (card + day) mod number of choices.
    while (pendingCount(w) > 0) {
      const card = w.stores.pendingEventCard.card[0];
      const choice = (card + w.stores.run.day[0]) % EVENT_CHOICE_COUNT[card];
      note(
        send(w, {
          type: 'ResolveEventChoice',
          card: 0,
          choice,
          ship: w.stores.pendingEventCard.subject[0],
        }),
      );
      out.resolved++;
      out.hashes[out.hashes.length - 1] = w.stores.run.stateHash[0];
    }
  }
  return { w, out };
}

/** Replay from seed + the logged commands only, via the raw replay path. */
function replayFromLog(source: Stores): number[] {
  const w = createWorld(42);
  const hashes: number[] = [];
  let next = 0;
  const n = source.counts[G_LOG];
  for (let day = 0; day < SCENARIO_DAYS; day++) {
    while (next < n && source.log.day[next] === day) replayLogged(w, source, next++);
    tickDay(w);
    hashes.push(w.stores.run.stateHash[0]);
    // The live run answered cards after the tick, logged on day + 1; those entries replay at the
    // start of the next loop iteration (same state, same order).
    while (next < n && source.log.day[next] === day + 1 && source.log.type[next] === 11) {
      replayLogged(w, source, next++);
      hashes[hashes.length - 1] = w.stores.run.stateHash[0];
    }
  }
  expect(next).toBe(n);
  return hashes;
}

describe('deterministic replay of a multi-ship scenario with events and reroutes', () => {
  it('two live runs of the same seed and script give the same hash on every day', () => {
    const a = liveScenario();
    const b = liveScenario();
    expect(a.out.hashes).toEqual(b.out.hashes);
    expect(a.w.stores.run.stateHash[0]).toBe(b.w.stores.run.stateHash[0]);
  });

  it('the scenario really exercises launches, events, reroutes, a rejection and losses', () => {
    const { w, out } = liveScenario();
    const s = w.stores;
    expect(s.counts[G_ENTITY]).toBe(7); // homeworld + 5 ships
    expect(out.resolved).toBe(EXPECT_RESOLVED);
    expect(out.rejected).toBe(EXPECT_REJECTED);
    expect(s.run.lastEvent[0]).toBe(EXPECT_RESOLVED);
    const states = [2, 3, 4, 5, 6].map((e) => s.shipState.state[e]);
    expect(states).toEqual(EXPECT_STATES);
    expect(s.run.shipsLost[0]).toBe(EXPECT_LOST);
    // Ship 4 turned back on day 12 and unloaded its 400 colonists at the homeworld.
    expect(s.shipManifest.colonists[4]).toBe(0);
    expect(s.colony.population[w.homeColony]).toBe(100000 - (60 + 200 + 400 + 60 + 60) + 400);
    // Ship 6 starved: Lost with no one left alive.
    expect(s.shipLog.lostReason[6]).toBe(LostReason.AllDead);
    expect(s.shipManifest.colonists[6]).toBe(0);
  });

  it('replaying seed + log through replayLogged reproduces the hash at every checkpoint', () => {
    const { w, out } = liveScenario();
    const replay = replayFromLog(w.stores);
    expect(replay).toEqual(out.hashes);
    // The log holds launches, reroutes and card choices; rejected commands never reached it.
    const types = new Set<number>();
    for (let i = 0; i < w.stores.counts[G_LOG]; i++) types.add(w.stores.log.type[i]);
    expect([...types].sort((a, b) => a - b)).toEqual([1, 2, 11]);
    expect(getLoggedCommand(w.stores, 0).type).toBe('LaunchShip');
  });

  it('matches the recorded golden hash after 300 days', () => {
    // Changing this value means the simulation or its content changed: review on purpose.
    expect(liveScenario().w.stores.run.stateHash[0]).toBe(GOLDEN_SCENARIO);
  });

  it('a different seed, or one different choice, gives a different hash', () => {
    const base = liveScenario().w.stores.run.stateHash[0];
    const w = createWorld(43);
    for (let i = 0; i < SCENARIO_DAYS; i++) tickDay(w);
    expect(w.stores.run.stateHash[0]).not.toBe(base);

    const a = lineWorld(5);
    const b = lineWorld(5);
    const ea = addShip(a);
    const eb = addShip(b);
    stage(a, ea, CARD.Illness);
    stage(b, eb, CARD.Illness);
    send(a, { type: 'ResolveEventChoice', card: 0, choice: 0, ship: ea });
    send(b, { type: 'ResolveEventChoice', card: 0, choice: 1, ship: eb });
    expect(hashState(a.stores)).not.toBe(hashState(b.stores));
  });
});

describe('the state hash covers every new store', () => {
  it('every typed array in Stores is hashed, except the render positions and the hash itself', () => {
    const w = createWorld(1);
    const s = w.stores;
    const covered = new Set<string>();
    for (const t of [...s.dynamicTargets, ...s.staticTargets]) {
      covered.add(
        `${t.bytes.buffer.constructor.name}:${(t.bytes.buffer as ArrayBuffer).byteLength}:${t.bytes.byteOffset}`,
      );
    }
    const exempt = new Set<unknown>([s.prevPosition, s.currPosition, s.run.stateHash]);
    const missing: string[] = [];
    const walk = (o: unknown, path: string): void => {
      if (ArrayBuffer.isView(o)) {
        if (exempt.has(o)) return;
        const key = `${o.buffer.constructor.name}:${(o.buffer as ArrayBuffer).byteLength}:${o.byteOffset}`;
        if (!covered.has(key)) missing.push(path);
        return;
      }
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o)) {
          if (k === 'dynamicTargets' || k === 'staticTargets') continue;
          walk(v, path ? `${path}.${k}` : k);
        }
      }
    };
    walk(s, '');
    expect(missing).toEqual([]);
  });

  it('flipping one value of each new or changed store changes the hash', () => {
    const w = lineWorld(3);
    const s = w.stores;
    const e = addShip(w);
    addShip(w); // a second ship so entity prefixes cover index e at several rows
    stage(w, e, CARD.Illness);
    ticks(w, 2);
    const slot = (k: number) => e * MAX_EVENT_DEFS + k;
    const planet = s.shipRoute.destPlanet[e];
    const cases: [string, { [i: number]: number }, number][] = [
      ['shipLog.arrivedDay', s.shipLog.arrivedDay, e],
      ['shipLog.lostDay', s.shipLog.lostDay, e],
      ['shipLog.lostReason', s.shipLog.lostReason, e],
      ['shipRoute.originX', s.shipRoute.originX, e],
      ['shipRoute.originY', s.shipRoute.originY, e],
      ['shipRoute.progress', s.shipRoute.progress, e],
      ['shipRoute.distance', s.shipRoute.distance, e],
      ['shipRoute.destPlanet', s.shipRoute.destPlanet, e],
      ['shipRoute.delay', s.shipRoute.delay, e],
      ['shipRoute.drift', s.shipRoute.drift, e],
      ['shipRoute.fuelFrac', s.shipRoute.fuelFrac, e],
      ['shipManifest.colonists', s.shipManifest.colonists, e],
      ['shipManifest.supplies', s.shipManifest.supplies, e],
      ['shipManifest.fuel', s.shipManifest.fuel, e],
      ['ship.integrity', s.ship.integrity, e],
      ['ship.speedSetting', s.ship.speedSetting, e],
      ['shipState.state', s.shipState.state, e],
      ['eventHistory.lastDay (this card)', s.eventHistory.lastDay, slot(CARD.Illness)],
      ['eventHistory.lastDay (another card)', s.eventHistory.lastDay, slot(5)],
      ['pendingEventCard.card', s.pendingEventCard.card, 0],
      ['pendingEventCard.subject', s.pendingEventCard.subject, 0],
      ['pendingEventCard.day', s.pendingEventCard.day, 0],
      ['pendingEventCard.card (last slot)', s.pendingEventCard.card, 7],
      ['run.resumeSpeed', s.run.resumeSpeed, 0],
      ['run.lastEvent[0]', s.run.lastEvent, 0],
      ['run.lastEvent[1]', s.run.lastEvent, 1],
      ['run.lastEvent[2]', s.run.lastEvent, 2],
      ['run.lastEvent[3]', s.run.lastEvent, 3],
      ['run.lastEvent[4]', s.run.lastEvent, 4],
      ['run.shipsLost', s.run.shipsLost, 0],
      ['planet.survey', s.planet.survey, planet],
      ['planetSurvey.habLo', s.planetSurvey.habLo, planet],
      ['planetSurvey.habHi', s.planetSurvey.habHi, planet],
    ];
    for (const [name, arr, idx] of cases) {
      const before = hashState(s);
      const old = arr[idx];
      arr[idx] = old + 1;
      expect(hashState(s), name).not.toBe(before);
      arr[idx] = old;
      expect(hashState(s), `${name} restored`).toBe(before);
    }
  });
});

describe('snapshot carries the transit data part B needs', () => {
  it('ship rows: state, speed, destination, manifest, flight numbers, margin inputs and positions', () => {
    const w = lineWorld();
    const s = w.stores;
    const flying = addShip(w, { speed: 1, kit: 2 });
    const pending = addShip(w, { dest: 3, hull: 1 });
    const drifter = addShip(w, { fuel: 100 });
    const lost = addShip(w, { colonists: 1, supplies: 0 });
    ticks(w, 4);
    stage(w, pending, CARD.Illness);
    expect(s.shipState.state[drifter]).toBe(ShipStateId.Drifting);
    expect(s.shipState.state[lost]).toBe(ShipStateId.Lost);

    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    // Lost ships are left out; rows ascend by entity id.
    expect(snap.meta[META_SHIP_COUNT]).toBe(3);
    expect(Array.from(snap.shipEntity.subarray(0, 3))).toEqual([flying, pending, drifter]);
    expect(snap.meta[META_SHIPS_LOST]).toBe(1);
    expect(Array.from(snap.shipState.subarray(0, 3))).toEqual([
      ShipStateId.InTransit,
      ShipStateId.Event,
      ShipStateId.Drifting,
    ]);
    expect(Array.from(snap.shipSpeed.subarray(0, 3))).toEqual([1, 0, 0]);
    expect(Array.from(snap.shipHull.subarray(0, 3))).toEqual([0, 1, 0]);
    expect(Array.from(snap.shipDest.subarray(0, 2))).toEqual([
      s.shipRoute.destPlanet[flying],
      s.shipRoute.destPlanet[pending],
    ]);
    expect(Array.from(snap.shipColonists.subarray(0, 3))).toEqual([60, 60, 60]);
    // Cruise: 4 days x 2304 grid units, 4 x 67.5 fuel (270 burned).
    expect(snap.shipProgress[0]).toBe(9216);
    expect(snap.shipDistance[0]).toBe(25600);
    expect(snap.shipFuel[0]).toBe(3730);
    expect(snap.shipSupplies[0]).toBe(5000 - 240);
    // 25600 - 9216 = 16384 left at 2304 a day: 8 more days (7.11 rounds up).
    expect(snap.shipEta[0]).toBe(8);
    expect(snap.shipMargin[0]).toBe(Math.floor((4760 * 100) / (60 * 8))); // 991
    expect(snap.shipMargin[0]).toBe(991);
    // The Event ship: Ark at Economy, 300 units, 1024 a day, 4 days flown.
    expect(snap.shipEta[1]).toBe(Math.ceil((76800 - 4096) / 1024));
    expect(snap.shipEta[1]).toBe(71);
    // Drifting ships have no ETA; the margin then reads as the cap.
    expect(snap.shipEta[2]).toBe(0);
    expect(snap.shipMargin[2]).toBe(999);
    expect(snap.shipIntegrity[0]).toBe(100);
    expect(snap.shipDelay[0]).toBe(0);
    // Interpolation: previous and current positions of the flying ship (9 units a day).
    expect(Array.from(snap.shipPos.subarray(0, 4))).toEqual([127, 500, 136, 500]);

    // The pending card and every choice's cost fields.
    expect(snap.meta[META_PENDING_COUNT]).toBe(1);
    expect(snap.meta[META_PENDING_CARD]).toBe(CARD.Illness);
    expect(snap.meta[META_PENDING_SHIP]).toBe(pending);
    // Choice 0: supplies -10% of 4760 = -476; choice 1: colonists -3% of 60 = -2 (rounded up).
    const stride = CHOICE_COST_STRIDE;
    expect(snap.eventCosts[0 * stride + 1]).toBe(-476);
    expect(snap.eventCosts[1 * stride + 0]).toBe(-2);
    expect(snap.eventCosts[2 * stride + 0]).toBe(0); // no third choice
  });

  it('survey levels per planet and the known habitability range', () => {
    const w = lineWorld();
    const e = addShip(w);
    ticks(w, 13);
    const p = w.stores.shipRoute.destPlanet[e];
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.planetSurvey[p]).toBe(2); // Surveyed
    expect([snap.planetHabLo[p], snap.planetHabHi[p]]).toEqual([71, 76]);
    expect(snap.planetSurvey[w.homePlanet]).toBe(3);
    expect(snap.planetSurvey[p + 1]).toBe(0);
  });

  it('the cap of 256 ships is enforced in the rows', () => {
    const w = lineWorld();
    for (let i = 0; i < SNAPSHOT_MAX_SHIPS + 5; i++) addShip(w, { dest: 5 });
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_SHIP_COUNT]).toBe(256);
    expect(snap.shipEntity[255]).toBe(257); // entities 2 .. 257
  });

  it('copySnapshotInto and snapshotBuffers cover every array', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Stowaways);
    const a = createSnapshot();
    fillSnapshot(w, a, 0);
    const b = createSnapshot();
    copySnapshotInto(a, b);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      expect(Array.from(b[key] as ArrayLike<number>), key).toEqual(
        Array.from(a[key] as ArrayLike<number>),
      );
    }
    const buffers = snapshotBuffers(a);
    expect(buffers).toHaveLength(Object.keys(a).length);
    expect(new Set(buffers).size).toBe(buffers.length);
  });

  it('a ship Lost at the same time as the next snapshot is not listed but is counted', () => {
    const w = lineWorld();
    addShip(w, { dest: 5 });
    const doomed = addShip(w, { dest: 5, colonists: 1, supplies: 0 });
    ticks(w, 1);
    expect(w.stores.shipState.state[doomed]).toBe(ShipStateId.Lost);
    expect(w.stores.shipLog.lostReason[doomed]).toBe(LostReason.AllDead);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_SHIP_COUNT]).toBe(1);
    expect(snap.meta[META_SHIPS_LOST]).toBe(1);
  });
});

// Commands accepted while paused and the queue: a pending card does not block the log.
describe('commands during a pending card', () => {
  it('a launch from the homeworld still works and is logged on the same day', () => {
    const w = createWorld(42);
    const e = addShip(w);
    stage(w, e, CARD.Illness);
    const rank = planetsByDistance(w);
    const r = submit(w, launchCmd(w, rank[3], {}));
    expect(r).toEqual({ ok: true });
    applyCommandsNow(w);
    expect(w.stores.counts[G_LOG]).toBe(1);
    expect(w.stores.run.speed[0]).toBe(0);
  });
});

const A = ShipStateId.Arrived;
const EXPECT_RESOLVED = 6;
const EXPECT_REJECTED = 2;
// Ships 2 to 6. Ships parked in orbit keep eating (D-080) and starve long before day 300: only
// ship 4, which unloaded at the homeworld (no colonists left aboard), is still Arrived.
const L = ShipStateId.Lost;
const EXPECT_STATES: number[] = [L, L, A, L, L];
const EXPECT_LOST = 4;
const GOLDEN_SCENARIO = 2520624353; // M7c re-record (D-136, SIM_VERSION 5): clock 8000, win 10 colonies; earlier: M7a re-record (D-132, SIM_VERSION 3): 30 cards, native variants, find tables; earlier: M5 review 2 (D-107 to D-111, SIM_VERSION 2); earlier M5 (D-098), D-101 to D-106
