import type { Command, GameSpeed, LaunchShipCommand } from '../../src/shared/commands';
import {
  District,
  DISTRICT_COST,
  districtOutput,
  colonySustains,
  E,
  WIN_POPULATION,
} from '../../src/shared/colony';
import { LOADOUT } from '../../src/data';
import {
  amountPerStep,
  cargoPerStep,
  ceilDiv,
  etaDays,
  firstLaunchProblem,
  fuelNeeded,
  hullCapacity,
  REROUTE_PENALTY_FUEL,
  rerouteRangeProblem,
} from '../../src/shared/loadout';
import {
  ExpeditionStatus,
  colonistsFactorPct,
  foundingChanceOf,
  foundingKitPct,
  isLiveStatus,
  nativesFoundingPct,
  siteQualityPct,
  siteScore,
  supplyFactorPct,
  LAST_ROLL_SLOTS,
  LR_CHANCE,
  LR_STRIDE,
  PF,
} from '../../src/shared/planetfall';
import { TE, TECH_COUNT, techBonus, techRejection } from '../../src/shared/research';
import {
  COMMAND_LOG_CAPACITY,
  G_ENTITY,
  G_PLANET,
  MAX_REGIONS_PER_PLANET,
  RunOutcome,
  ShipStateId,
} from '../../src/sim/components';
import { hasSpaceport } from '../../src/sim/colony';
import { pendingCount } from '../../src/sim/events';
import { isColony, planetDistanceFp } from '../../src/sim/launch';
import { effectiveDisposition, exploredCount, inNativeHome } from '../../src/sim/planet';
import { spendableFuel } from '../../src/sim/ships';
import { applyCommandsNow, tickDay } from '../../src/sim/tick';
import { submit, type World } from '../../src/sim/world';
import { offworldColonists } from '../../src/sim/winlose';

/**
 * Archetype bots for the headless balance harness (M7b, D-133). Each one is a policy over the
 * same command pipeline the player uses (`submit`): it reads the stores the way the UI reads
 * snapshots (survey level, the habitability window, natives once met) and never writes them. A
 * run is a pure function of the seed and the archetype, so a sweep is reproducible.
 */

/** One hull and loadout recipe. The dial steps are sized for the trip (fuel, food) at launch time. */
export interface Template {
  hull: number;
  /** 0 Economy, 1 Cruise, 2 Hard Burn. */
  speed: number;
  kit: number;
  security: number;
  /** Extra fuel above the trip's need, percent (plus the reroute penalty when `reserve` is set). */
  fuelMarginPct: number;
  reserve: boolean;
  /**
   * Food loaded as a percent of the whole plan: the trip (with the delay allowance), the planned
   * days on the ground and the founding reserve, one supply per colonist per day.
   */
  foodPct: number;
  /** Wait for stock until at least this share (percent) of the passengers the hull could carry fits. */
  minFillPct: number;
}

export type TargetMode = 'safe' | 'near' | 'unscanned';

export interface Archetype {
  id: string;
  name: string;
  /** Recipe for the n-th launch (0-based) of the run. */
  template: (launchNo: number) => Template;
  /** How the n-th launch picks a destination. */
  target: (launchNo: number) => TargetMode;
  /** Ships in the pipeline (flying, or arrived and not yet settled) at once, and days between launches. */
  maxPipeline: number;
  interval: number;
  maxLaunches: number;
  /** Found only when the odds shown are at least this percent; below it the ship moves on to another planet if it can. */
  minOdds: number;
  /** Extra founding rolls on the same ship after the first one fails. */
  retries: number;
  /** Landing: stance (0 Cautious, 1 Balanced, 2 Bold), explorers, regions explored before founding. */
  stance: number;
  explorers: number;
  exploreRegions: number;
  /** District order for each colony's build (cycled) and the number of districts before its Spaceport. */
  buildOrder: readonly number[];
  spaceportAfter: number;
  /** Launch from colonies with a Spaceport too. */
  fromColonies: boolean;
  /** Colony stance against Wary and Hostile natives once met (0 Coexist, 1 Defend, 2 Push out). */
  vsWary: number;
  vsHostile: number;
  /** Tech indices preferred first; the rest follow in index order. */
  techOrder: readonly number[];
}

const MINE = District.Mine;
const FARM = District.Farm;
const HAB = District.Habitat;
const REF = District.Refinery;
const LAB = District.Research;

const BASE: Template = {
  hull: 2,
  speed: 0,
  kit: 4,
  security: 2,
  fuelMarginPct: 15,
  reserve: true,
  foodPct: 110,
  minFillPct: 60,
};

const COMMON_BUILD: readonly number[] = [HAB, FARM, HAB, MINE, LAB, REF, HAB, FARM, MINE, LAB];

export const ARCHETYPES: readonly Archetype[] = [
  {
    // Max passengers and supplies at Economy, explores carefully, one big colony at a time.
    id: 'ark',
    name: 'Ark-and-explore',
    template: () => ({ ...BASE, hull: 2, kit: 6, security: 4 }),
    target: () => 'safe',
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 45,
    retries: 1,
    stance: 1,
    explorers: 60,
    exploreRegions: 8,
    buildOrder: COMMON_BUILD,
    spaceportAfter: 99,
    fromColonies: false,
    vsWary: 0,
    vsHostile: 1,
    techOrder: [],
  },
  {
    // Two or three Scouts at Hard Burn with kit survey the nearest planets, then Arks go to the best.
    id: 'scout',
    name: 'Scout-first',
    template: (n) =>
      n < 3
        ? { ...BASE, hull: 0, speed: 2, kit: 6, security: 2, foodPct: 105, minFillPct: 0 }
        : { ...BASE, hull: 2, kit: 6, security: 4 },
    target: (n) => (n < 3 ? 'near' : 'safe'),
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 40,
    retries: 1,
    stance: 1,
    explorers: 40,
    exploreRegions: 7,
    buildOrder: COMMON_BUILD,
    spaceportAfter: 99,
    fromColonies: false,
    vsWary: 0,
    vsHostile: 1,
    techOrder: [6, 7],
  },
  {
    // Hard Burn, thin supplies, no kit, unscanned targets, Bold, found at the first landing.
    id: 'gambler',
    name: 'Gambler',
    template: () => ({
      ...BASE,
      hull: 1,
      speed: 2,
      kit: 0,
      security: 0,
      fuelMarginPct: 5,
      reserve: false,
      foodPct: 88,
      minFillPct: 40,
    }),
    target: () => 'unscanned',
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 0,
    retries: 2,
    stance: 2,
    explorers: 30,
    exploreRegions: 5,
    buildOrder: COMMON_BUILD,
    spaceportAfter: 99,
    fromColonies: false,
    vsWary: 0,
    vsHostile: 1,
    techOrder: [],
  },
  {
    // Production first: mines, an early Spaceport, and launches from the colonies as well.
    id: 'economist',
    name: 'Economist',
    template: () => ({ ...BASE, hull: 2, kit: 5, security: 3 }),
    target: () => 'safe',
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 40,
    retries: 1,
    stance: 1,
    explorers: 50,
    exploreRegions: 9,
    buildOrder: [HAB, FARM, MINE, HAB, REF, MINE, HAB, LAB, FARM, HAB, HAB],
    spaceportAfter: 2,
    fromColonies: true,
    vsWary: 0,
    vsHostile: 1,
    techOrder: [6, 3, 8, 0, 1, 2],
  },
  {
    // Armed landing, Defend against Wary and Hostile natives.
    id: 'defender',
    name: 'Defender',
    template: () => ({ ...BASE, hull: 2, kit: 5, security: 10 }),
    target: () => 'safe',
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 40,
    retries: 1,
    stance: 1,
    explorers: 60,
    exploreRegions: 8,
    buildOrder: COMMON_BUILD,
    spaceportAfter: 99,
    fromColonies: false,
    vsWary: 1,
    vsHostile: 1,
    techOrder: [9, 8, 7],
  },
  {
    // Armed landing, Push out against Wary and Hostile natives and take their land.
    id: 'pusher',
    name: 'Pusher',
    template: () => ({ ...BASE, hull: 2, kit: 5, security: 10 }),
    target: () => 'safe',
    maxPipeline: 3,
    interval: 8,
    maxLaunches: 30,
    minOdds: 40,
    retries: 1,
    stance: 1,
    explorers: 60,
    exploreRegions: 8,
    buildOrder: COMMON_BUILD,
    spaceportAfter: 99,
    fromColonies: false,
    vsWary: 2,
    vsHostile: 2,
    techOrder: [],
  },
];

// ---- Metrics ------------------------------------------------------------------------------------

export const PLANET_TYPES = 6;

/** Seconds of player time per decision, added to the playing time (documented in docs/BALANCE.md). */
export const THINK_SECONDS = { card: 10, launch: 40, landing: 20, explore: 5, found: 10, build: 5 };

export interface RunMetrics {
  seed: number;
  archetype: string;
  /** RunOutcome: 1 Won, 2 LostHomeworld, 3 LostAllDead, 0 still running at the day cap (timeout). */
  outcome: number;
  days: number;
  launches: number;
  foundAttempts: number;
  /** Sum of the founding chances (percent) shown for each attempt: chanceSum / foundAttempts is the average odds. */
  chanceSum: number;
  /** Colonies founded (Thriving or Struggling), and the founding rolls that failed. */
  colonies: number;
  foundOk: number;
  popPeak: number;
  /** Most colonies at once with the winning size and no Struggling penalty (the goal is WIN_COLONIES). */
  peakSustain: number;
  shipsLost: number;
  cards: number;
  score: number;
  /** Founding attempts and successes on planets of true habitability 70 or more (the Ark band). */
  attemptsHigh: number;
  okHigh: number;
  /** First founding roll of each ship, and how many of those founded a colony. */
  firstTries: number;
  firstOk: number;
  /** Founding attempts and successes by planet type (planetTypes.json order). */
  attemptsByType: number[];
  okByType: number[];
  /** Planet type of the first colony founded, or -1. */
  firstType: number;
  /** Playing time at the speed the bot chose (1x busy, 2x flying, 4x idle) in minutes, and with the decisions. */
  playMin: number;
  runMin: number;
  /** Days at 1x speed only, in minutes. */
  minAt1x: number;
  rejected: number;
  hash: number;
}

interface RunState {
  w: World;
  arch: Archetype;
  m: RunMetrics;
  launchNo: number;
  think: number;
  secs: number;
  lastSpeed: number;
  lastSpeedDay: number;
  /** Planets with a landed expedition that has founded or given up, so a Scout does not retry. */
  rejectedLocal: number;
  /** Ships that have landed an expedition at least once. */
  tried: Set<number>;
  /** Ships that found no other planet to move on to. */
  stuck: Set<number>;
  /** Founding rolls made so far by each ship. */
  rolls: Map<number, number>;
}

const LOG_MARGIN = 96;

function send(P: RunState, cmd: Command): boolean {
  const w = P.w;
  if (w.stores.counts[2] >= COMMAND_LOG_CAPACITY - LOG_MARGIN) return false;
  const r = submit(w, cmd);
  if (!r.ok) {
    P.m.rejected++;
    return false;
  }
  applyCommandsNow(w);
  return true;
}

function answerCards(P: RunState): void {
  const w = P.w;
  let guard = 0;
  while (pendingCount(w) > 0 && guard++ < 50) {
    const ok = send(P, {
      type: 'ResolveEventChoice',
      card: 0,
      choice: 0,
      ship: w.stores.pendingEventCard.subject[0],
    });
    if (!ok) break;
    P.m.cards++;
    P.think += THINK_SECONDS.card;
  }
}

function chooseTech(P: RunState): void {
  const s = P.w.stores;
  if (s.research.current[0] >= 0) return;
  const order = [...P.arch.techOrder];
  for (let t = 0; t < TECH_COUNT; t++) if (!order.includes(t)) order.push(t);
  for (const t of order) {
    if (techRejection(s.research.mask[0], t) === null) {
      if (send(P, { type: 'ChooseTech', tech: t })) P.think += THINK_SECONDS.build;
      return;
    }
  }
}

function pipeline(w: World): number {
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
    else if (
      st === ShipStateId.Arrived &&
      s.planet.owner[s.shipRoute.destPlanet[e]] < 0 &&
      s.shipManifest.colonists[e] >= 20
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

/** Free planets ranked for a target mode, best first. Uses only what the player can see. */
function candidates(w: World, from: number, mode: TargetMode): number[] {
  const s = w.stores;
  const rows: { p: number; k: number }[] = [];
  for (let p = 0; p < s.counts[G_PLANET]; p++) {
    if (s.planet.owner[p] >= 0 || targeted(w, p)) continue;
    const dist = planetDistanceFp(s, from, p) / 256;
    const survey = s.planet.survey[p];
    const mid = (s.planetSurvey.habLo[p] + s.planetSurvey.habHi[p]) / 2 - (survey === 0 ? 10 : 0);
    let k: number;
    if (mode === 'safe') k = -(mid * 10 - dist * 1.2);
    else if (mode === 'near') k = dist + (survey > 0 ? 1000 : 0);
    else k = dist + (survey > 0 ? 1000 : 0) - (mid > 30 ? 0 : -400);
    rows.push({ p, k });
  }
  rows.sort((a, b) => a.k - b.k || a.p - b.p);
  return rows.map((r) => r.p);
}

/** Days the plan allows on the ground: rounds of exploring (Bold clears two regions a round) and a few spare. */
function groundDaysOf(a: Archetype): number {
  const perRound = PF.stances.regionsPerRound[a.stance];
  return Math.ceil(a.exploreRegions / perRound) * PF.stances.roundDays[a.stance] + 5;
}

/** Size a launch for a trip: fuel for the leg, food at the margin, the rest passengers. */
function sizeLaunch(
  w: World,
  col: number,
  target: number,
  t: Template,
  keepPop: number,
  groundDays: number,
): LaunchShipCommand | null {
  const s = w.stores;
  const dist = planetDistanceFp(s, s.colony.planet[col], target);
  const eta = etaDays(dist, t.hull, t.speed);
  const need = fuelNeeded(dist, t.speed);
  const fuelUnits =
    ceilDiv(need * (100 + t.fuelMarginPct), 100) + (t.reserve ? REROUTE_PENALTY_FUEL : 0);
  const fuelSteps = ceilDiv(fuelUnits, amountPerStep('fuel'));
  const room =
    hullCapacity(t.hull) -
    fuelSteps * cargoPerStep('fuel') -
    t.kit * cargoPerStep('kit') -
    t.security * cargoPerStep('security');
  if (room < 2) return null;
  const planDays =
    ceilDiv(eta * (100 + LOADOUT.founding.delayAllowancePct), 100) +
    groundDays +
    PF.founding.reserveDays;
  const perPass = amountPerStep('passengers');
  const perSup = amountPerStep('supplies');
  const supplyStepsFor = (p: number): number =>
    ceilDiv(p * perPass * planDays * t.foodPct, 100 * perSup);
  const fits = (p: number): boolean =>
    p * cargoPerStep('passengers') + supplyStepsFor(p) * cargoPerStep('supplies') <= room;
  let pFull = Math.floor(room / cargoPerStep('passengers'));
  while (pFull > 0 && !fits(pFull)) pFull--;
  if (pFull < 1) return null;
  const stock = s.stockpile;
  let p = pFull;
  const popCap = Math.floor((s.colony.population[col] - keepPop) / perPass);
  while (p > 0 && (p > popCap || supplyStepsFor(p) * perSup > stock.supplies[col])) p--;
  if (p < 1 || p * 100 < pFull * t.minFillPct) return null;
  const cmd: LaunchShipCommand = {
    type: 'LaunchShip',
    colony: col,
    target,
    hull: t.hull,
    passengers: p,
    supplies: supplyStepsFor(p),
    fuel: fuelSteps,
    speed: t.speed,
    kit: t.kit,
    security: t.security,
  };
  const problem = firstLaunchProblem(
    cmd,
    dist,
    s.colony.population[col],
    stock.supplies[col],
    stock.fuel[col],
    stock.production[col],
  );
  return problem === null ? cmd : null;
}

function launch(P: RunState): void {
  const w = P.w;
  const s = w.stores;
  const a = P.arch;
  if (P.launchNo >= a.maxLaunches || pipeline(w) >= a.maxPipeline) return;
  const origins: number[] = [w.homeColony];
  if (a.fromColonies) {
    for (let e = 0; e < s.counts[G_ENTITY]; e++) {
      if (
        e !== w.homeColony &&
        isColony(s, e) &&
        hasSpaceport(w, e) &&
        s.colony.population[e] > WIN_POPULATION + 500
      )
        origins.push(e);
    }
  }
  const t = a.template(P.launchNo);
  for (const col of origins) {
    const list = candidates(w, s.colony.planet[col], a.target(P.launchNo));
    let tried = 0;
    for (const target of list) {
      if (tried++ >= 8) break;
      const cmd = sizeLaunch(
        w,
        col,
        target,
        t,
        col === w.homeColony ? 1000 : WIN_POPULATION + 100,
        groundDaysOf(a),
      );
      if (cmd !== null && send(P, cmd)) {
        P.launchNo++;
        P.m.launches++;
        if (trace.log)
          trace.log(
            `${a.id} seed ${w.seed} day ${s.run.day[0]} LAUNCH hull ${cmd.hull} to p${target} pass ${cmd.passengers * 20} sup ${cmd.supplies * 500} fuel ${cmd.fuel * 100} eta ${etaDays(planetDistanceFp(s, s.colony.planet[col], target), cmd.hull, cmd.speed)} habwin ${s.planetSurvey.habLo[target]}-${s.planetSurvey.habHi[target]}`,
          );
        P.think += THINK_SECONDS.launch;
        return;
      }
    }
  }
}

function frontiers(w: World, planet: number): { explored: number; first: number; second: number } {
  const s = w.stores;
  const base = s.planet.regionStart[planet];
  let explored = 0;
  let first = -1;
  let second = -1;
  for (let i = 0; i < s.planet.regionCount[planet]; i++) {
    const fog = s.region.fog[base + i];
    if (fog === 3) explored++;
    else if (fog === 1) {
      if (first < 0) first = i;
      else if (second < 0) second = i;
    }
  }
  return { explored, first, second };
}

/** The explored region with the best find for a colony site, avoiding native homes once they are known. */
function bestSite(w: World, planet: number): number {
  const s = w.stores;
  const base = s.planet.regionStart[planet];
  let best = -1;
  let bestScore = -1;
  for (let i = 0; i < s.planet.regionCount[planet]; i++) {
    if (s.region.fog[base + i] !== 3) continue;
    if (s.native.revealed[planet] === 1 && inNativeHome(s, planet, i)) continue;
    const f = s.region.find[base + i];
    const sc = f < PF.founding.findSitePct.length ? PF.founding.findSitePct[f] : 0;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  return best < 0 ? 0 : best;
}

/** The founding chance the player is shown for settling `region` now (the habitability window's middle stands in for the truth). */
function expectedOdds(w: World, x: number, region: number): number {
  const s = w.stores;
  const planet = s.expedition.planet[x];
  const sh = s.expedition.ship[x];
  const base = s.planet.regionStart[planet];
  const alive =
    s.shipState.state[sh] !== ShipStateId.Lost && s.shipState.state[sh] !== ShipStateId.None;
  const team = s.expeditionTeam;
  const colonists =
    team.explorers[x] + team.wounded[x] + (alive ? s.shipManifest.colonists[sh] : 0);
  const supplies = team.supplies[x] + (alive ? s.shipManifest.supplies[sh] : 0);
  const hab = (s.planetSurvey.habLo[planet] + s.planetSurvey.habHi[planet]) >> 1;
  const find = s.region.find[base + region];
  const site = siteQualityPct(
    siteScore(find === 255 ? -1 : find, exploredCount(s, planet), s.planet.regionCount[planet]),
    s.planet.survey[planet],
  );
  const known = s.native.revealed[planet] === 1;
  const disp = known ? effectiveDisposition(s, planet) : 0;
  return foundingChanceOf(
    hab,
    site,
    supplyFactorPct(supplies, colonists),
    colonistsFactorPct(colonists),
    nativesFoundingPct(disp, known && inNativeHome(s, planet, region), team.guards[x]),
    foundingKitPct(team.kit[x]),
    techBonus(s.research.mask[0], TE.Founding),
  );
}

/** Send a ship in orbit (no expedition out) to the best other free planet in its fuel range. False when there is none. */
function tryMove(P: RunState, sh: number): boolean {
  const w = P.w;
  const s = w.stores;
  if (P.stuck.has(sh)) return false;
  const here = s.shipRoute.destPlanet[sh];
  for (const target of candidates(w, here, 'safe').slice(0, 8)) {
    const sys = s.planet.system[target];
    const dx = s.system.x[sys] - s.system.x[s.planet.system[here]];
    const dy = s.system.y[sys] - s.system.y[s.planet.system[here]];
    const d = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (rerouteRangeProblem(d, s.ship.speedSetting[sh], spendableFuel(w, sh)) !== null) continue;
    if (send(P, { type: 'RerouteShip', ship: sh, target })) return true;
    break;
  }
  P.stuck.add(sh);
  return false;
}

/** Take the expedition back aboard and move the ship on. False (and nothing changed) when no planet is in range. */
function moveOn(P: RunState, x: number): boolean {
  const s = P.w.stores;
  const sh = s.expedition.ship[x];
  if (P.stuck.has(sh)) return false;
  const here = s.shipRoute.destPlanet[sh];
  let reach = false;
  for (const target of candidates(P.w, here, 'safe').slice(0, 8)) {
    const sys = s.planet.system[target];
    const dx = s.system.x[sys] - s.system.x[s.planet.system[here]];
    const dy = s.system.y[sys] - s.system.y[s.planet.system[here]];
    const d = Math.round(Math.sqrt(dx * dx + dy * dy));
    if (rerouteRangeProblem(d, s.ship.speedSetting[sh], spendableFuel(P.w, sh)) === null) {
      reach = true;
      break;
    }
  }
  if (!reach) {
    P.stuck.add(sh);
    return false;
  }
  if (!send(P, { type: 'ReEmbark', expedition: x })) return false;
  return tryMove(P, sh);
}

function planetfall(P: RunState): void {
  const w = P.w;
  const s = w.stores;
  const a = P.arch;
  const n = s.counts[G_ENTITY];
  for (let e = 0; e < n; e++) {
    if (s.shipState.state[e] !== ShipStateId.Arrived) continue;
    const planet = s.shipRoute.destPlanet[e];
    let live = false;
    for (let x = 0; x < n && !live; x++)
      live = s.expedition.ship[x] === e && isLiveStatus(s.expedition.status[x]);
    if (live) continue;
    if (s.planet.owner[planet] >= 0) {
      // Someone settled it first: carry on to a free planet in range, if any.
      if (s.shipManifest.colonists[e] < 1) continue;
      const list = candidates(w, planet, 'safe');
      for (const target of list.slice(0, 6)) {
        const sys = s.planet.system[target];
        const dx = s.system.x[sys] - s.system.x[s.planet.system[planet]];
        const dy = s.system.y[sys] - s.system.y[s.planet.system[planet]];
        const d = Math.round(Math.sqrt(dx * dx + dy * dy));
        if (rerouteRangeProblem(d, s.ship.speedSetting[e], spendableFuel(w, e)) !== null) continue;
        if (send(P, { type: 'RerouteShip', ship: e, target })) break;
      }
      continue;
    }
    const man = s.shipManifest;
    if (P.tried.has(e) && a.minOdds > 0 && tryMove(P, e)) continue;
    if ((P.rolls.get(e) ?? 0) > a.retries) continue;
    const explorers = Math.min(man.colonists[e], a.explorers);
    if (explorers < 1) continue;
    // After a failed landing: try again only with people and food enough to matter.
    if (
      s.shipRoute.progress[e] >= 0 &&
      P.tried.has(e) &&
      (man.colonists[e] < 60 || man.supplies[e] < man.colonists[e] * 12)
    )
      continue;
    P.tried.add(e);
    const ground = Math.min(man.supplies[e], explorers * 10 * (a.exploreRegions + 2));
    const ok = send(P, {
      type: 'FormExpedition',
      ship: e,
      explorers,
      guards: man.security[e],
      supplies: ground,
      kit: man.kit[e],
      stance: a.stance,
    });
    if (ok) P.think += THINK_SECONDS.landing;
    if (ok && trace.log)
      trace.log(
        `${a.id} seed ${w.seed} day ${s.run.day[0]} LAND ship ${e} colonists ${man.colonists[e]} sup ${man.supplies[e]} ground ${ground} fuel ${man.fuel[e]}`,
      );
  }
  for (let x = 0; x < n; x++) {
    if (s.expedition.status[x] !== ExpeditionStatus.Active || s.expedition.target[x] >= 0) continue;
    const planet = s.expedition.planet[x];
    const f = frontiers(w, planet);
    if (f.explored < a.exploreRegions && f.first >= 0) {
      const bold = a.stance === 2 && f.second >= 0;
      if (
        send(P, {
          type: 'ExploreRegion',
          expedition: x,
          region: f.first,
          region2: bold ? f.second : -1,
        })
      )
        P.think += THINK_SECONDS.explore;
    } else {
      const type = s.planet.planetType[planet];
      const site = bestSite(w, planet);
      if (a.minOdds > 0 && expectedOdds(w, x, site) < a.minOdds && moveOn(P, x)) continue;
      if (send(P, { type: 'FoundColony', expedition: x, region: site })) {
        P.think += THINK_SECONDS.found;
        const isFirst = !P.rolls.has(s.expedition.ship[x]);
        P.rolls.set(s.expedition.ship[x], (P.rolls.get(s.expedition.ship[x]) ?? 0) + 1);
        P.m.foundAttempts++;
        if (isFirst) P.m.firstTries++;
        P.m.attemptsByType[type]++;
        const high = s.planet.habitability[planet] >= 70;
        if (high) P.m.attemptsHigh++;
        const rec = s.expeditionRoll.rec;
        const o = x * LAST_ROLL_SLOTS * LR_STRIDE;
        P.m.chanceSum += rec[o + LR_CHANCE];
        if (trace.log)
          trace.log(
            `${P.arch.id} seed ${w.seed} day ${s.run.day[0]} found p${planet} type ${type} hab ${rec[o + 4]} site ${rec[o + 5]} sup ${rec[o + 6]} col ${rec[o + 7]} nat ${rec[o + 8]} kit ${rec[o + 9]} chance ${rec[o + LR_CHANCE]} roll ${rec[o + 12]} res ${rec[o + 13]}`,
          );
        if (s.expedition.status[x] === ExpeditionStatus.Founded) {
          P.m.colonies++;
          P.m.foundOk++;
          if (isFirst) P.m.firstOk++;
          P.m.okByType[type]++;
          if (high) P.m.okHigh++;
          if (P.m.firstType < 0) P.m.firstType = type;
        }
      }
    }
  }
  for (let x = 0; x < n; x++) {
    if (s.expedition.status[x] === ExpeditionStatus.Stranded)
      send(P, { type: 'ReEmbark', expedition: x });
  }
}

function colonies(P: RunState): void {
  const w = P.w;
  const s = w.stores;
  const a = P.arch;
  const home = s.run.homeColony[0];
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    if (e === home || !isColony(s, e)) continue;
    const planet = s.colony.planet[e];
    const base = s.planet.regionStart[planet];
    const count = s.planet.regionCount[planet];
    const dBase = e * MAX_REGIONS_PER_PLANET;
    let built = 0;
    for (let i = 0; i < count; i++) if (s.district.kind[dBase + i] !== District.None) built++;
    // Priorities: feed the people, house them (two Habitats reach the win size), then the archetype's order.
    const flow = s.colonyFlow;
    let farms = 0;
    let habs = 0;
    for (let i = 0; i < count; i++) {
      const k = s.district.kind[dBase + i];
      if (k === District.Farm) farms++;
      else if (k === District.Habitat) habs++;
    }
    const hungry =
      farms === 0 ||
      (flow.supplies[e] < flow.eat[e] && s.stockpile.supplies[e] < s.colony.population[e] * 60);
    const habsWanted = ceilDiv(WIN_POPULATION - E.housing.base, E.housing.perHabitat);
    // Sites are scarce (only explored regions): keep room for two Farms and the Habitats before
    // any other district or the Spaceport takes one.
    let free = 0;
    for (let i = 0; i < count; i++)
      if (s.region.fog[base + i] === 3 && s.district.kind[dBase + i] === District.None) free++;
    const missing = Math.max(0, 2 - farms) + Math.max(0, habsWanted - habs);
    let kind =
      hungry && farms < 3
        ? FARM
        : habs < habsWanted
          ? HAB
          : a.buildOrder[built % a.buildOrder.length];
    const needed = (kind === FARM && farms < 2) || (kind === HAB && habs < habsWanted);
    if (!needed && free <= missing) kind = farms < 2 ? FARM : HAB;
    // Free explored regions, best yield first; a native home region refuses, so try the next.
    const sites: { i: number; v: number }[] = [];
    for (let i = 0; i < count; i++) {
      if (s.region.fog[base + i] !== 3 || s.district.kind[dBase + i] !== District.None) continue;
      sites.push({ i, v: districtOutput(kind, s.region.terrain[base + i], 100, 0, 100) });
    }
    sites.sort((x, y) => y.v - x.v || x.i - y.i);
    const wantPort =
      free > missing &&
      built >= a.spaceportAfter &&
      farms > 0 &&
      habs > 0 &&
      !hasSpaceport(w, e) &&
      s.stockpile.production[e] >= DISTRICT_COST[District.Spaceport];
    if (wantPort || s.stockpile.production[e] >= DISTRICT_COST[kind]) {
      for (const site of sites.slice(0, 5)) {
        const ok = wantPort
          ? send(P, { type: 'BuildSpaceport', colony: e, region: site.i })
          : send(P, { type: 'BuildDistrict', colony: e, region: site.i, district: kind });
        if (ok) {
          P.think += THINK_SECONDS.build;
          break;
        }
      }
    }
    if (s.native.revealed[planet] === 1) {
      const disp = s.native.disposition[planet];
      const want = disp === 3 ? a.vsHostile : disp === 2 ? a.vsWary : 0;
      if (s.colony.nativeStance[e] !== want && s.native.expelled[planet] === 0)
        send(P, { type: 'SetColonyStance', colony: e, stance: want });
    }
  }
}

/**
 * The speed a player would pick: 1x when a card waits or a team is on the ground, 2x while ships
 * fly, 4x when nothing moves. Ships parked at a planet someone else settled need no attention.
 */
function wantedSpeed(w: World): number {
  const s = w.stores;
  if (pendingCount(w) > 0) return 1;
  let flying = false;
  for (let e = 0; e < s.counts[G_ENTITY]; e++) {
    if (isLiveStatus(s.expedition.status[e])) return 1;
    const st = s.shipState.state[e];
    if (
      st === ShipStateId.Arrived &&
      s.planet.owner[s.shipRoute.destPlanet[e]] < 0 &&
      s.shipManifest.colonists[e] >= 20
    )
      return 1;
    if (st === ShipStateId.InTransit || st === ShipStateId.Event || st === ShipStateId.Drifting)
      flying = true;
  }
  return flying ? 2 : 4;
}

export const MAX_DAYS = 12000;

/** Optional debug sink for the node runner; null in the test suite. */
export const trace: { log: ((line: string) => void) | null } = { log: null };

export function newMetrics(seed: number, archetype: string): RunMetrics {
  return {
    seed,
    archetype,
    outcome: 0,
    days: 0,
    launches: 0,
    foundAttempts: 0,
    chanceSum: 0,
    colonies: 0,
    foundOk: 0,
    popPeak: 0,
    peakSustain: 0,
    shipsLost: 0,
    cards: 0,
    score: 0,
    attemptsHigh: 0,
    okHigh: 0,
    firstTries: 0,
    firstOk: 0,
    attemptsByType: new Array<number>(PLANET_TYPES).fill(0),
    okByType: new Array<number>(PLANET_TYPES).fill(0),
    firstType: -1,
    playMin: 0,
    runMin: 0,
    minAt1x: 0,
    rejected: 0,
    hash: 0,
  };
}

/** Play one run of `arch` on `w` until it ends or `maxDays` pass. */
export function playArchetype(w: World, arch: Archetype, maxDays: number = MAX_DAYS): RunMetrics {
  const s = w.stores;
  const P: RunState = {
    w,
    arch,
    m: newMetrics(w.seed, arch.id),
    launchNo: 0,
    think: 0,
    secs: 0,
    lastSpeed: 1,
    lastSpeedDay: -99,
    rejectedLocal: 0,
    tried: new Set<number>(),
    stuck: new Set<number>(),
    rolls: new Map<number, number>(),
  };
  while (s.run.outcome[0] === RunOutcome.Running && s.run.day[0] < maxDays) {
    answerCards(P);
    chooseTech(P);
    const day = s.run.day[0];
    planetfall(P);
    if (day % 5 === 0) colonies(P);
    if (day % arch.interval === 0) launch(P);
    const sp = wantedSpeed(w);
    if (sp !== P.lastSpeed && day - P.lastSpeedDay >= 5) {
      if (send(P, { type: 'SetGameSpeed', speed: sp as GameSpeed })) {
        P.lastSpeed = sp;
        P.lastSpeedDay = day;
      }
    }
    P.secs += 1 / P.lastSpeed;
    tickDay(w);
    const off = offworldColonists(s);
    if (off > P.m.popPeak) P.m.popPeak = off;
    if (s.run.day[0] % 10 === 0) {
      let sustain = 0;
      for (let e = 0; e < s.counts[G_ENTITY]; e++) {
        if (
          e !== w.homeColony &&
          isColony(s, e) &&
          colonySustains(s.colony.population[e], s.colony.penaltyDays[e])
        )
          sustain++;
      }
      if (sustain > P.m.peakSustain) P.m.peakSustain = sustain;
    }
  }
  const m = P.m;
  m.outcome = s.run.outcome[0];
  m.days = s.run.day[0];
  m.score = s.run.score[0];
  m.shipsLost = s.run.shipsLost[0];
  m.hash = s.run.stateHash[0];
  m.playMin = P.secs / 60;
  m.runMin = (P.secs + P.think) / 60;
  m.minAt1x = m.days / 60;
  return m;
}
