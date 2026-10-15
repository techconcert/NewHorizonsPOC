import type { Command } from '../../src/shared/commands';
import { District, DISTRICT_COST } from '../../src/shared/colony';
import { ExpeditionStatus } from '../../src/shared/planetfall';
import { TECH_COUNT, techRejection } from '../../src/shared/research';
import {
  COMMAND_LOG_CAPACITY,
  G_ENTITY,
  G_PLANET,
  MAX_REGIONS_PER_PLANET,
  RunOutcome,
  ShipStateId,
} from '../../src/sim/components';
import { pendingCount } from '../../src/sim/events';
import { isColony, planetDistanceFp } from '../../src/sim/launch';
import { hasSpaceport } from '../../src/sim/colony';
import { applyCommandsNow, tickDay } from '../../src/sim/tick';
import { submit, type World } from '../../src/sim/world';

/**
 * A scripted player for headless runs (M5). It uses only commands (the same `submit` the worker
 * uses), reads the stores directly (it is a test), and has no randomness of its own, so a run is
 * a pure function of the seed. It is not a good player: it exists to push every system (launch,
 * landing, exploring, founding, districts, techs, cards, the end) through a whole game.
 */

export interface BotStats {
  launches: number;
  expeditions: number;
  explores: number;
  foundAttempts: number;
  districts: number;
  spaceports: number;
  techsChosen: number;
  cards: number;
  rejected: number;
}

export function newBotStats(): BotStats {
  return {
    launches: 0,
    expeditions: 0,
    explores: 0,
    foundAttempts: 0,
    districts: 0,
    spaceports: 0,
    techsChosen: 0,
    cards: 0,
    rejected: 0,
  };
}

/** Stop issuing commands when the log is nearly full, so the run can still end. */
const LOG_MARGIN = 64;

function send(w: World, stats: BotStats, cmd: Command): boolean {
  if (w.stores.counts[2] >= COMMAND_LOG_CAPACITY - LOG_MARGIN) return false;
  const r = submit(w, cmd);
  if (!r.ok) {
    stats.rejected++;
    return false;
  }
  applyCommandsNow(w);
  return true;
}

/** The District kinds the bot builds, in the order it adds them to a colony. */
const BUILD_ORDER: readonly number[] = [
  District.Mine,
  District.Farm,
  District.Mine,
  District.Habitat,
  District.Habitat,
  District.Habitat,
  District.Research,
  District.Farm,
  District.Refinery,
  District.Habitat,
];

function answerCards(w: World, stats: BotStats): void {
  let guard = 0;
  while (pendingCount(w) > 0 && guard++ < 50) {
    const ok = send(w, stats, {
      type: 'ResolveEventChoice',
      card: 0,
      choice: 0,
      ship: w.stores.pendingEventCard.subject[0],
    });
    if (!ok) break;
    stats.cards++;
  }
}

function chooseTech(w: World, stats: BotStats): void {
  const s = w.stores;
  if (s.research.current[0] >= 0) return;
  for (let t = 0; t < TECH_COUNT; t++) {
    if (techRejection(s.research.mask[0], t) === null) {
      if (send(w, stats, { type: 'ChooseTech', tech: t })) stats.techsChosen++;
      return;
    }
  }
}

/** Ships that are flying (or drifting): not parked in orbit, not lost. */
function liveShips(w: World): number {
  const s = w.stores;
  let n = 0;
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    const st = s.shipState.state[e];
    if (
      st === ShipStateId.InTransit ||
      st === ShipStateId.Event ||
      st === ShipStateId.Drifting ||
      st === ShipStateId.Launching
    )
      n++;
  }
  return n;
}

function targeted(w: World, planet: number): boolean {
  const s = w.stores;
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    const st = s.shipState.state[e];
    if (st !== ShipStateId.None && st !== ShipStateId.Lost && s.shipRoute.destPlanet[e] === planet)
      return true;
  }
  return false;
}

/** Loadouts the bot tries, biggest first: Heavy Ark, Ark, Scout (cargo stays under each hull). */
const LOADOUTS: readonly {
  hull: number;
  passengers: number;
  supplies: number;
  fuel: number;
  kit: number;
  security: number;
}[] = [
  { hull: 2, passengers: 100, supplies: 60, fuel: 150, kit: 4, security: 10 },
  { hull: 1, passengers: 100, supplies: 30, fuel: 50, kit: 2, security: 4 },
  { hull: 0, passengers: 3, supplies: 10, fuel: 40, kit: 2, security: 2 },
];

/** Launch from the homeworld at the nearest free planets: first loadout and planet the sim accepts. */
function launch(w: World, stats: BotStats): void {
  const s = w.stores;
  if (liveShips(w) >= 2) return;
  const cand: { p: number; d: number }[] = [];
  for (let p = 0; p < s.counts[G_PLANET]; p++) {
    if (s.planet.owner[p] >= 0 || targeted(w, p)) continue;
    cand.push({ p, d: planetDistanceFp(s, w.homePlanet, p) });
  }
  cand.sort((a, b) => a.d - b.d || a.p - b.p);
  for (const l of LOADOUTS) {
    for (let i = 0; i < Math.min(cand.length, 6); i++) {
      const ok = send(w, stats, {
        type: 'LaunchShip',
        colony: w.homeColony,
        target: cand[i].p,
        hull: l.hull,
        passengers: l.passengers,
        supplies: l.supplies,
        fuel: l.fuel,
        speed: 0,
        kit: l.kit,
        security: l.security,
      });
      if (ok) {
        stats.launches++;
        return;
      }
    }
  }
}

function landingZone(w: World, planet: number): number {
  const s = w.stores;
  const base = s.planet.regionStart[planet];
  for (let i = 0; i < s.planet.regionCount[planet]; i++) {
    if ((s.region.flags[base + i] & 1) === 1) return i;
  }
  return 0;
}

/** Land arrived ships and walk each expedition: explore two regions, then found at the landing zone. */
function planetfall(w: World, stats: BotStats): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  for (let e = 0; e < n; e++) {
    if (
      s.shipState.state[e] === ShipStateId.Arrived &&
      s.planet.owner[s.shipRoute.destPlanet[e]] < 0
    ) {
      let live = false;
      for (let x = 0; x < n && !live; x++)
        live = s.expedition.ship[x] === e && s.expedition.status[x] === ExpeditionStatus.Active;
      if (!live) {
        const colonists = s.shipManifest.colonists[e];
        const ok = send(w, stats, {
          type: 'FormExpedition',
          ship: e,
          explorers: Math.min(colonists, 300),
          guards: Math.min(s.shipManifest.security[e], 10),
          supplies: Math.min(s.shipManifest.supplies[e], 10000),
          kit: s.shipManifest.kit[e],
          stance: 1,
        });
        if (ok) stats.expeditions++;
      }
    }
  }
  for (let x = 0; x < n; x++) {
    if (s.expedition.status[x] !== ExpeditionStatus.Active || s.expedition.target[x] >= 0) continue;
    const planet = s.expedition.planet[x];
    const base = s.planet.regionStart[planet];
    const count = s.planet.regionCount[planet];
    let explored = 0;
    let frontier = -1;
    for (let i = 0; i < count; i++) {
      const fog = s.region.fog[base + i];
      if (fog === 3) explored++;
      else if (fog === 1 && frontier < 0) frontier = i;
    }
    if (explored < 8 && frontier >= 0) {
      if (send(w, stats, { type: 'ExploreRegion', expedition: x, region: frontier, region2: -1 }))
        stats.explores++;
    } else {
      const lz = landingZone(w, planet);
      stats.foundAttempts++;
      send(w, stats, { type: 'FoundColony', expedition: x, region: lz });
    }
  }
  // Failed foundings wait for the survivors to go home.
  for (let x = 0; x < n; x++) {
    if (s.expedition.status[x] === ExpeditionStatus.Stranded) {
      send(w, stats, { type: 'ReEmbark', expedition: x });
    }
  }
}

/** Colony work: a Spaceport once there is Production for it, then districts in the build order. */
function colonies(w: World, stats: BotStats): void {
  const s = w.stores;
  const home = s.run.homeColony[0];
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    if (e === home || !isColony(s, e)) continue;
    const planet = s.colony.planet[e];
    const base = s.planet.regionStart[planet];
    const count = s.planet.regionCount[planet];
    const dBase = e * MAX_REGIONS_PER_PLANET;
    let built = 0;
    for (let i = 0; i < count; i++) if (s.district.kind[dBase + i] !== District.None) built++;
    const kind = BUILD_ORDER[built % BUILD_ORDER.length];
    let free = -1;
    for (let i = 0; i < count && free < 0; i++) {
      if (s.region.fog[base + i] === 3 && s.district.kind[dBase + i] === District.None) free = i;
    }
    if (free < 0) continue;
    if (
      built >= 3 &&
      !hasSpaceport(w, e) &&
      s.stockpile.production[e] >= DISTRICT_COST[District.Spaceport]
    ) {
      if (send(w, stats, { type: 'BuildSpaceport', colony: e, region: free })) stats.spaceports++;
    } else if (s.stockpile.production[e] >= DISTRICT_COST[kind]) {
      if (send(w, stats, { type: 'BuildDistrict', colony: e, region: free, district: kind }))
        stats.districts++;
    }
    // Coexist is the default stance; a colony at war with Hostile natives defends instead.
    if (
      s.native.revealed[planet] === 1 &&
      s.native.disposition[planet] === 3 &&
      s.colony.nativeStance[e] === 0
    )
      send(w, stats, { type: 'SetColonyStance', colony: e, stance: 1 });
  }
}

/** One day of the bot's decisions (at most once a day; nothing is decided every tick of a card pause). */
export function botDay(w: World, stats: BotStats): void {
  answerCards(w, stats);
  chooseTech(w, stats);
  const day = w.stores.run.day[0];
  planetfall(w, stats);
  if (day % 5 === 0) colonies(w, stats);
  if (day % 10 === 0) launch(w, stats);
}

export interface BotResult {
  days: number;
  outcome: number;
  score: number;
  hash: number;
  /** Colonies founded off the homeworld and the three biggest populations among them. */
  colonies: number;
  topPops: number[];
  stats: BotStats;
}

/** Play until the run ends or `maxDays` pass. Returns what happened. */
export function playBot(w: World, stats: BotStats, maxDays: number, stopDay = Infinity): BotResult {
  const s = w.stores;
  while (
    s.run.outcome[0] === RunOutcome.Running &&
    s.run.day[0] < maxDays &&
    s.run.day[0] < stopDay
  ) {
    botDay(w, stats);
    tickDay(w);
  }
  const home = s.run.homeColony[0];
  const pops: number[] = [];
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    if (e !== home && isColony(s, e)) pops.push(s.colony.population[e]);
  }
  pops.sort((a, b) => b - a);
  return {
    days: s.run.day[0],
    colonies: pops.length,
    topPops: pops.slice(0, 3),
    outcome: s.run.outcome[0],
    score: s.run.score[0],
    hash: s.run.stateHash[0],
    stats,
  };
}
