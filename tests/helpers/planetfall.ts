import type { Command, CommandResult } from '../../src/shared/commands';
import { ExpeditionStatus, LAST_ROLL_SLOTS, LR_STRIDE } from '../../src/shared/planetfall';
import { G_ENTITY, ShipStateId } from '../../src/sim/components';
import { pendingCount } from '../../src/sim/events';
import type { ShipSpawn } from '../../src/sim/launch';
import { tickDay } from '../../src/sim/tick';
import type { World } from '../../src/sim/world';
import { addShip, lineWorld, planetOf, send } from './transit';

export { send, tickDay };

export interface Landing {
  w: World;
  ship: number;
  planet: number;
  /** Global index of the planet's first region. */
  base: number;
  /** Local index of the landing zone. */
  lz: number;
  /** What the player knew when the ship left: the inputs of the launch odds band. */
  atLaunch: {
    survey: number;
    habLo: number;
    habHi: number;
    supplies: number;
    passengers: number;
    security: number;
    eta: number;
    kit: number;
  };
}

/**
 * A line world (hazard 0) with a ship that has flown to the first planet of system 1 and is
 * Arrived: 400 colonists, 20000 supplies, 4000 fuel, 4 kit, 6 security unless overridden. The
 * planet is made predictable: habitability 80, no natives, every region Plains. Regions keep
 * their generated layout (planet 3 of seed 5 has 14 regions and a landing zone with 5 neighbours).
 */
export function arrivedShip(seed = 5, over: Partial<ShipSpawn> = {}): Landing {
  const w = lineWorld(seed, 0);
  const s = w.stores;
  const planet = planetOf(w, 1);
  s.planet.habitability[planet] = 80;
  s.native.disposition[planet] = 0;
  s.native.variant[planet] = 0;
  s.native.homeRegionMask[planet] = 0;
  const base = s.planet.regionStart[planet];
  for (let i = 0; i < s.planet.regionCount[planet]; i++) s.region.terrain[base + i] = 0;
  const ship = addShip(w, {
    dest: 1,
    colonists: 400,
    supplies: 20000,
    kit: 4,
    security: 6,
    ...over,
  });
  const atLaunch = {
    survey: s.planet.survey[planet],
    habLo: s.planetSurvey.habLo[planet],
    habHi: s.planetSurvey.habHi[planet],
    supplies: s.shipManifest.supplies[ship],
    passengers: s.shipManifest.colonists[ship],
    security: s.shipManifest.security[ship],
    eta: 0,
    kit: s.shipManifest.kit[ship],
  };
  let days = 0;
  for (; days < 60 && s.shipState.state[ship] !== ShipStateId.Arrived; days++) tickDay(w);
  atLaunch.eta = days;
  let lz = 0;
  for (let i = 0; i < s.planet.regionCount[planet]; i++) if (s.region.flags[base + i] & 1) lz = i;
  return { w, ship, planet, base, lz, atLaunch };
}

export interface FormOptions {
  explorers?: number;
  guards?: number;
  supplies?: number;
  kit?: number;
  stance?: number;
}

/** Send FormExpedition and return the new expedition's entity id (the highest id). */
export function form(L: Landing, o: FormOptions = {}): number {
  const r = send(L.w, {
    type: 'FormExpedition',
    ship: L.ship,
    explorers: o.explorers ?? 100,
    guards: o.guards ?? 0,
    supplies: o.supplies ?? 5000,
    kit: o.kit ?? 4,
    stance: o.stance ?? 1,
  });
  if (!r.ok) throw new Error(`FormExpedition rejected: ${r.reason}`);
  return L.w.stores.counts[G_ENTITY] - 1;
}

export function explore(w: World, e: number, region: number, region2 = -1): CommandResult {
  return send(w, { type: 'ExploreRegion', expedition: e, region, region2 });
}

export function found(w: World, e: number, region: number): CommandResult {
  return send(w, { type: 'FoundColony', expedition: e, region });
}

/** Tick until the expedition is idle again (round resolved) or `max` days passed. */
export function finishRound(w: World, e: number, max = 40): number {
  let days = 0;
  while (w.stores.expedition.target[e] >= 0 && days < max) {
    tickDay(w);
    days++;
  }
  return days;
}

/** Answer every waiting card with `choice` (clamped to 0), like the player rule in the scenarios. */
export function answerCards(w: World, choice = 0): number {
  let n = 0;
  while (pendingCount(w) > 0 && n < 50) {
    const ok: Command = {
      type: 'ResolveEventChoice',
      card: 0,
      choice,
      ship: w.stores.pendingEventCard.subject[0],
    };
    send(w, ok);
    n++;
  }
  return n;
}

/** The record of roll `slot` (0 or 1) of expedition `e`, as a plain array. */
export function rollRecord(w: World, e: number, slot = 0): number[] {
  const o = (e * LAST_ROLL_SLOTS + slot) * LR_STRIDE;
  return Array.from(w.stores.expeditionRoll.rec.subarray(o, o + LR_STRIDE));
}

/**
 * Run `n` rounds: each explores the lowest visible region, then answers any card with choice 0.
 * Stops early when the expedition is no longer Active. Returns the rounds run.
 */
export function exploreRounds(L: Landing, e: number, n: number): number {
  const s = L.w.stores;
  let done = 0;
  for (; done < n; done++) {
    answerCards(L.w, 0);
    if (s.expedition.status[e] !== ExpeditionStatus.Active) break;
    const count = s.planet.regionCount[L.planet];
    let next = -1;
    for (let i = 0; i < count && next < 0; i++) if (s.region.fog[L.base + i] === 1) next = i;
    if (next < 0 || !explore(L.w, e, next).ok) break;
    finishRound(L.w, e);
  }
  answerCards(L.w, 0);
  return done;
}
