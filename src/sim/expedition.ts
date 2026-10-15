import { TRANSIT } from '../data';
import type {
  ExploreRegionCommand,
  FormExpeditionCommand,
  FoundColonyCommand,
  PlanetfallRejectReason,
  ReEmbarkCommand,
} from '../shared/commands';
import { SCENE_EXPLORATION, SCENE_NATIVE_CONTACT } from '../shared/events';
import { TE, techBonus } from '../shared/research';
import { FOUNDING_GRANT, starterFood } from '../shared/colony';
import { ceilDiv } from '../shared/loadout';
import {
  ambushChancePct,
  ambushHarm,
  colonistsFactorPct,
  diseaseAmount,
  Disp,
  ExpeditionStatus,
  clampKind,
  explorationChancePct,
  explorationRawPct,
  exploreKitPct,
  FIND_DISEASE,
  FIND_MYSTERY,
  FIND_NOTHING,
  FIND_UNKNOWN,
  FoundTier,
  foundingChancePct,
  foundingKitPct,
  foundingTier,
  FR_COLONISTS,
  FR_HABITABILITY,
  FR_KIT,
  FR_NATIVES,
  FR_RESEARCH,
  FR_SITE,
  FR_SUPPLIES,
  FR_SURVIVORS,
  hazardAmount,
  hazardChancePct,
  HAZARD_DEATH,
  HAZARD_INJURY,
  HAZARD_NONE,
  hazardKindOf,
  HAZARD_SUPPLIES,
  LAST_ROLL_SLOTS,
  LR_AMBUSH_CHANCE,
  LR_AMBUSH_HARM,
  LR_AMBUSH_ROLL,
  LR_BASE,
  LR_CLAMPED,
  LR_CHANCE,
  LR_DAY,
  LR_FIND,
  LR_HAZARD_AMOUNT,
  LR_HAZARD_CHANCE,
  LR_HAZARD_KIND,
  LR_HAZARD_ROLL,
  LR_KIND,
  LR_KITPCT,
  LR_NATIVESPCT,
  LR_RAW_CHANCE,
  LR_REGION,
  LR_RESULT,
  LR_ROLL,
  LR_SPLIT,
  LR_STANCEPCT,
  LR_STRIDE,
  LR_TEAM,
  LR_TEAM_SIZE,
  LR_TERRAIN,
  nativesExplorePct,
  nativesFoundingPct,
  PF,
  sharedFood,
  siteQualityPct,
  siteScore,
  STANCE_COUNT,
  stanceRegionsPerRound,
  stanceRoundDays,
  stanceSuccessPct,
  supplyFactorPct,
  teamSizePct,
  terrainBasePct,
} from '../shared/planetfall';
import {
  G_ENTITY,
  MAX_ENTITIES,
  MAX_LIVE_EXPEDITIONS,
  RNG_ENTITY_BASE,
  ShipStateId,
  Survey,
  type Stores,
} from './components';
import { spawnEntity } from './entities';
import { pickExpeditionCard, queueExpeditionCard } from './events';
import {
  autoSecondRegion,
  effectiveDisposition,
  exploredCount,
  FOG_EXPLORED,
  FOG_VISIBLE,
  inNativeHome,
  landingZone,
  liveExpeditions,
  markExplored,
  rollFind,
  shipHasLiveExpedition,
} from './planet';
import { nextInt } from './rng';
import { raiseSurvey } from './survey';
import type { World } from './world';

/**
 * Planetfall (M4a): FormExpedition, ExploreRegion, FoundColony, ReEmbark and the day-tick
 * ExplorationSystem. Every roll uses the expedition's own RNG stream, so an expedition's dice do
 * not depend on any other expedition (D-070). Integer math from src/shared/planetfall.ts; the
 * numbers are in src/data/planetfall.json. docs/GAME_DESIGN.md sections 6 and 7.
 */

const { Active, Stranded, Event } = ExpeditionStatus;

type Reject = PlanetfallRejectReason | null;

function ship(s: Stores, e: number): number {
  return s.expedition.ship[e];
}

/** True when `e` is an expedition entity (it has a status). */
function isExpedition(s: Stores, e: number): boolean {
  return e >= 0 && e < s.counts[G_ENTITY] && s.expedition.status[e] !== ExpeditionStatus.None;
}

// ---- FormExpedition ----------------------------------------------------------------------------

/**
 * Check FormExpedition. Order: ship exists, not Lost, Arrived (in orbit at a planet), planet not
 * owned, no expedition from this ship yet, stance, amounts (non-negative integers), at least one
 * explorer, colonists, security, kit, supplies aboard, expedition and entity limits.
 */
export function checkForm(w: World, cmd: FormExpeditionCommand): Reject {
  const s = w.stores;
  const sh = cmd.ship;
  if (sh < 0 || sh >= s.counts[G_ENTITY] || s.shipState.state[sh] === ShipStateId.None)
    return 'NO_SUCH_SHIP';
  const st = s.shipState.state[sh];
  if (st === ShipStateId.Lost) return 'SHIP_LOST';
  if (st !== ShipStateId.Arrived) return 'SHIP_NOT_ARRIVED';
  const planet = s.shipRoute.destPlanet[sh];
  if (s.planet.owner[planet] >= 0) return 'PLANET_OWNED';
  const n = s.counts[G_ENTITY];
  if (shipHasLiveExpedition(s, sh)) return 'EXPEDITION_EXISTS';
  if (cmd.stance < 0 || cmd.stance >= STANCE_COUNT) return 'INVALID_STANCE';
  if (cmd.explorers < 0 || cmd.guards < 0 || cmd.supplies < 0 || cmd.kit < 0)
    return 'INVALID_EXPEDITION';
  if (cmd.explorers < 1) return 'NO_EXPLORERS';
  const man = s.shipManifest;
  if (cmd.explorers > man.colonists[sh]) return 'INSUFFICIENT_COLONISTS';
  if (cmd.guards > man.security[sh]) return 'INSUFFICIENT_SECURITY';
  if (cmd.kit > man.kit[sh]) return 'INSUFFICIENT_KIT';
  if (cmd.supplies > man.supplies[sh]) return 'INSUFFICIENT_SUPPLIES';
  if (liveExpeditions(s) >= MAX_LIVE_EXPEDITIONS) return 'EXPEDITION_LIMIT';
  if (n >= MAX_ENTITIES) return 'ENTITY_LIMIT';
  return null;
}

/**
 * Land the expedition at the planet's landing zone. The listed explorers, guards, supplies and
 * kit leave the ship's manifest; what stays aboard (the rest of the colonists, supplies, fuel)
 * waits in orbit as the depot. The landing zone becomes explored, its neighbours visible, and the
 * planet counts as Explored (D-067). A failed re-check drops the effect (the log entry stays).
 */
export function applyForm(w: World, cmd: FormExpeditionCommand): void {
  if (checkForm(w, cmd) !== null) return;
  const s = w.stores;
  const sh = cmd.ship;
  const planet = s.shipRoute.destPlanet[sh];
  const e = spawnEntity(w);
  const lz = landingZone(s, planet);
  const exp = s.expedition;
  const team = s.expeditionTeam;
  exp.ship[e] = sh;
  exp.planet[e] = planet;
  exp.region[e] = lz;
  exp.round[e] = 0;
  exp.status[e] = Active;
  exp.target[e] = -1;
  exp.target2[e] = -1;
  exp.roundDay[e] = 0;
  exp.roundLen[e] = 0;
  exp.delay[e] = 0;
  exp.landedDay[e] = s.run.day[0];
  team.explorers[e] = cmd.explorers;
  team.guards[e] = cmd.guards;
  team.supplies[e] = cmd.supplies;
  team.kit[e] = cmd.kit;
  team.wounded[e] = 0;
  s.expeditionStance.stance[e] = cmd.stance;

  const man = s.shipManifest;
  man.colonists[sh] -= cmd.explorers;
  man.security[sh] -= cmd.guards;
  man.supplies[sh] -= cmd.supplies;
  man.kit[sh] -= cmd.kit;

  markExplored(s, planet, lz);
  const idx = s.planet.regionStart[planet] + lz;
  if (s.region.find[idx] === FIND_UNKNOWN) s.region.find[idx] = FIND_NOTHING;
  raiseSurvey(w, planet, Survey.Explored);
}

// ---- ExploreRegion -----------------------------------------------------------------------------

/**
 * Check ExploreRegion. Order: expedition exists, no card waiting, on the ground, idle (not in a
 * round), has explorers, region exists, region not explored, region visible (next to explored
 * land); a second region (region2) must be distinct, valid and visible too: for Bold it is the
 * second region of the round, for the others a split with enough explorers for two teams.
 */
export function checkExplore(w: World, cmd: ExploreRegionCommand): Reject {
  const s = w.stores;
  const e = cmd.expedition;
  if (!isExpedition(s, e)) return 'NO_SUCH_EXPEDITION';
  const status = s.expedition.status[e];
  if (status === Event) return 'EVENT_PENDING';
  if (status !== Active) return 'EXPEDITION_NOT_ACTIVE';
  if (s.expedition.target[e] >= 0) return 'ROUND_IN_PROGRESS';
  if (s.expeditionTeam.explorers[e] < 1) return 'NO_EXPLORERS';
  const planet = s.expedition.planet[e];
  const base = s.planet.regionStart[planet];
  const count = s.planet.regionCount[planet];
  if (cmd.region < 0 || cmd.region >= count) return 'INVALID_REGION';
  const fog = s.region.fog[base + cmd.region];
  if (fog === FOG_EXPLORED) return 'ALREADY_EXPLORED';
  if (fog !== FOG_VISIBLE) return 'NOT_ADJACENT';
  if (cmd.region2 === -1) return null;
  const bold = stanceRegionsPerRound(s.expeditionStance.stance[e]) === 2;
  if (cmd.region2 < 0 || cmd.region2 >= count) return 'INVALID_REGION';
  if (cmd.region2 === cmd.region) return 'INVALID_SPLIT';
  const fog2 = s.region.fog[base + cmd.region2];
  if (fog2 === FOG_EXPLORED) return 'ALREADY_EXPLORED';
  if (fog2 !== FOG_VISIBLE) return 'NOT_ADJACENT';
  // Bold names its second region and rolls it with the whole team; the others split in two.
  if (!bold && s.expeditionTeam.explorers[e] < 2 * PF.minExplorersPerTeam) return 'INVALID_SPLIT';
  return null;
}

/** Start a round: the round length comes from the stance (Cautious 15 days, others 10). */
export function applyExplore(w: World, cmd: ExploreRegionCommand): void {
  if (checkExplore(w, cmd) !== null) return;
  const s = w.stores;
  const e = cmd.expedition;
  s.expedition.target[e] = cmd.region;
  s.expedition.target2[e] = cmd.region2;
  s.expedition.roundDay[e] = 0;
  s.expedition.roundLen[e] = stanceRoundDays(s.expeditionStance.stance[e]);
}

// ---- FoundColony -------------------------------------------------------------------------------

/**
 * Check FoundColony. Order: expedition exists, no card waiting, on the ground (not stranded),
 * idle, planet not owned, region exists, region explored, entity room for the colony.
 */
export function checkFound(w: World, cmd: FoundColonyCommand): Reject {
  const s = w.stores;
  const e = cmd.expedition;
  if (!isExpedition(s, e)) return 'NO_SUCH_EXPEDITION';
  const status = s.expedition.status[e];
  if (status === Event) return 'EVENT_PENDING';
  if (status !== Active) return 'EXPEDITION_NOT_ACTIVE';
  if (s.expedition.target[e] >= 0) return 'ROUND_IN_PROGRESS';
  const planet = s.expedition.planet[e];
  if (s.planet.owner[planet] >= 0) return 'PLANET_OWNED';
  if (cmd.region < 0 || cmd.region >= s.planet.regionCount[planet]) return 'INVALID_REGION';
  if (s.region.fog[s.planet.regionStart[planet] + cmd.region] !== FOG_EXPLORED)
    return 'REGION_NOT_EXPLORED';
  if (s.counts[G_ENTITY] >= MAX_ENTITIES) return 'ENTITY_LIMIT';
  return null;
}

/** The ship's cargo that settles with the colony: nothing when the ship is Lost. */
function depotAlive(s: Stores, sh: number): boolean {
  return s.shipState.state[sh] !== ShipStateId.Lost && s.shipState.state[sh] !== ShipStateId.None;
}

/**
 * Found the colony and roll. The factor breakdown (habitability, site from the explored regions,
 * supplies remaining, colonists, natives, kit, life-support research = 0 until M5) is written to
 * the expedition's last roll record. Thriving or Struggling creates the colony (everyone and
 * everything in orbit settles, the planet is owned); Failed kills part of the team on the ground,
 * leaves the survivors Stranded and the planet free. D-068.
 */
export function applyFound(w: World, cmd: FoundColonyCommand): void {
  if (checkFound(w, cmd) !== null) return;
  const s = w.stores;
  const e = cmd.expedition;
  const exp = s.expedition;
  const team = s.expeditionTeam;
  const planet = exp.planet[e];
  const sh = ship(s, e);
  const base = s.planet.regionStart[planet];
  const alive = depotAlive(s, sh);
  const man = s.shipManifest;

  const depotColonists = alive ? man.colonists[sh] : 0;
  // Guards are armed crew, not headcount: they neither eat (D-080) nor count toward the colonists
  // and supplies factors, but they settle with the colony.
  const colonists = team.explorers[e] + team.wounded[e] + depotColonists;
  const supplies = team.supplies[e] + (alive ? man.supplies[sh] : 0);
  const disp = effectiveDisposition(s, planet);
  const home = inNativeHome(s, planet, cmd.region);
  const find = s.region.find[base + cmd.region];

  const habitability = s.planet.habitability[planet];
  const site = siteQualityPct(
    siteScore(
      find === FIND_UNKNOWN ? -1 : find,
      exploredCount(s, planet),
      s.planet.regionCount[planet],
    ),
    s.planet.survey[planet],
  );
  const fSupplies = supplyFactorPct(supplies, colonists);
  const fColonists = colonistsFactorPct(colonists);
  const fNatives = nativesFoundingPct(disp, home, team.guards[e]);
  const fKit = foundingKitPct(team.kit[e]);
  const research = techBonus(s.research.mask[0], TE.Founding);
  const chance = foundingChancePct({
    habitability,
    site,
    supplies: fSupplies,
    colonists: fColonists,
    natives: fNatives,
    kit: fKit,
    research,
  });
  const roll = nextInt(s.rng, RNG_ENTITY_BASE + e, 0, 99);
  const tier = foundingTier(roll, chance);

  clearRolls(s, e);
  const o = e * LAST_ROLL_SLOTS * LR_STRIDE;
  const r = s.expeditionRoll.rec;
  r[o + LR_KIND] = 2;
  r[o + LR_DAY] = s.run.day[0];
  r[o + LR_REGION] = cmd.region;
  r[o + LR_TERRAIN] = s.region.terrain[base + cmd.region];
  r[o + FR_HABITABILITY] = habitability;
  r[o + FR_SITE] = site;
  r[o + FR_SUPPLIES] = fSupplies;
  r[o + FR_COLONISTS] = fColonists;
  r[o + FR_NATIVES] = fNatives;
  r[o + FR_KIT] = fKit;
  r[o + FR_RESEARCH] = research;
  r[o + LR_CHANCE] = chance;
  r[o + LR_ROLL] = roll;
  r[o + LR_RESULT] = tier;
  r[o + LR_FIND] = find === FIND_UNKNOWN ? -1 : find;
  r[o + LR_HAZARD_ROLL] = -1;
  r[o + LR_AMBUSH_ROLL] = -1;

  exp.target[e] = -1;
  exp.target2[e] = -1;
  if (tier === FoundTier.Failed) {
    const group = team.explorers[e] + team.wounded[e];
    let loss = ceilDiv(group * PF.founding.failedLossPct, 100);
    if (loss > group) loss = group;
    removeFromGroup(s, e, loss);
    r[o + FR_SURVIVORS] = team.explorers[e] + team.wounded[e];
    exp.status[e] = team.explorers[e] + team.wounded[e] > 0 ? Stranded : ExpeditionStatus.Dead;
    return;
  }

  const c = spawnEntity(w);
  s.colony.planet[c] = planet;
  s.colony.population[c] = colonists + team.guards[e];
  s.colony.spaceport[c] = 0;
  s.colony.tier[c] = tier;
  s.colony.penaltyDays[c] = tier === FoundTier.Struggling ? PF.founding.strugglingPenaltyDays : 0;
  s.colony.site[c] = cmd.region;
  s.colony.hunger[c] = 0;
  // Founding grant (D-101): starter Production and ~14 days of food for the people; carried Supplies above that are kept.
  const startFood = starterFood(colonists + team.guards[e]);
  s.stockpile.supplies[c] = supplies > startFood ? supplies : startFood;
  s.stockpile.fuel[c] = alive ? man.fuel[sh] : 0;
  s.stockpile.production[c] = FOUNDING_GRANT.starterProduction;
  s.planet.owner[planet] = c;
  raiseSurvey(w, planet, Survey.Explored);
  r[o + FR_SURVIVORS] = colonists + team.guards[e];

  // The ship is unloaded at the new colony (D-053); kit stays aboard with the hull.
  if (alive) {
    man.colonists[sh] = 0;
    man.supplies[sh] = 0;
    man.fuel[sh] = 0;
    s.shipRoute.fuelFrac[sh] = 0;
    man.kit[sh] += team.kit[e];
  }
  team.explorers[e] = 0;
  team.wounded[e] = 0;
  team.guards[e] = 0;
  team.supplies[e] = 0;
  team.kit[e] = 0;
  exp.status[e] = ExpeditionStatus.Founded;
}

// ---- ReEmbark ----------------------------------------------------------------------------------

/**
 * Check ReEmbark. Order: expedition exists, no card waiting, on the ground or stranded, idle, the
 * ship still exists and is not Lost (intact), and is in orbit (Arrived).
 */
export function checkReEmbark(w: World, cmd: ReEmbarkCommand): Reject {
  const s = w.stores;
  const e = cmd.expedition;
  if (!isExpedition(s, e)) return 'NO_SUCH_EXPEDITION';
  const status = s.expedition.status[e];
  if (status === Event) return 'EVENT_PENDING';
  if (status !== Active && status !== Stranded) return 'EXPEDITION_NOT_ACTIVE';
  if (s.expedition.target[e] >= 0) return 'ROUND_IN_PROGRESS';
  const st = s.shipState.state[ship(s, e)];
  if (st === ShipStateId.Lost || st === ShipStateId.None) return 'SHIP_LOST';
  if (st !== ShipStateId.Arrived) return 'SHIP_NOT_ARRIVED';
  return null;
}

/**
 * Survivors, supplies, kit and guards go back aboard the ship, which stays Arrived in orbit with
 * no expedition out: FormExpedition can land a new one at once, and RerouteShip accepts the ship
 * and pays the usual course-change cost from the fuel it still holds. D-071, D-081.
 */
export function applyReEmbark(w: World, cmd: ReEmbarkCommand): void {
  if (checkReEmbark(w, cmd) !== null) return;
  const s = w.stores;
  const e = cmd.expedition;
  const sh = ship(s, e);
  const man = s.shipManifest;
  const team = s.expeditionTeam;
  man.colonists[sh] += team.explorers[e] + team.wounded[e];
  man.security[sh] += team.guards[e];
  man.supplies[sh] += team.supplies[e];
  man.kit[sh] += team.kit[e];
  team.explorers[e] = 0;
  team.wounded[e] = 0;
  team.guards[e] = 0;
  team.supplies[e] = 0;
  team.kit[e] = 0;
  s.expedition.status[e] = ExpeditionStatus.Returned;
  s.expedition.target[e] = -1;
  s.expedition.target2[e] = -1;
}

// ---- ExplorationSystem (step 7) ----------------------------------------------------------------

function clearRolls(s: Stores, e: number): void {
  const o = e * LAST_ROLL_SLOTS * LR_STRIDE;
  s.expeditionRoll.rec.fill(0, o, o + LAST_ROLL_SLOTS * LR_STRIDE);
}

/** Remove `n` people from the group on the ground: explorers first, then the wounded. */
function removeFromGroup(s: Stores, e: number, n: number): void {
  const team = s.expeditionTeam;
  const fromExplorers = n < team.explorers[e] ? n : team.explorers[e];
  team.explorers[e] -= fromExplorers;
  const rest = n - fromExplorers;
  team.wounded[e] = Math.max(0, team.wounded[e] - rest);
}

/** Eat the day's supplies: 1 per person on the ground; the unfed starve (D-050 percentages). */
function feedExpedition(s: Stores, e: number): void {
  const team = s.expeditionTeam;
  const head = team.explorers[e] + team.wounded[e];
  const supplies = team.supplies[e];
  if (supplies >= head) {
    team.supplies[e] = supplies - head;
    return;
  }
  const unfed = head - supplies;
  team.supplies[e] = 0;
  removeFromGroup(s, e, ceilDiv(unfed * TRANSIT.starvationPctPerDay, 100));
}

/**
 * ExplorationSystem: every day each expedition on the ground (ascending ids) eats (the depot ship's
 * colonists are fed by the SupplySystem, D-080); a delayed team stands still; a team on a round
 * counts its days and, on the last one, rolls the round. Expeditions waiting on a card are
 * frozen like ships in state Event. No allocation. D-069.
 */
export function explorationSystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const exp = s.expedition;
  for (let e = 0; e < n; e++) {
    const status = exp.status[e];
    if (status !== Active && status !== Stranded) continue;
    feedExpedition(s, e);
    if (s.expeditionTeam.explorers[e] + s.expeditionTeam.wounded[e] <= 0) {
      exp.status[e] = ExpeditionStatus.Dead;
      exp.target[e] = -1;
      exp.target2[e] = -1;
      continue;
    }
    if (status !== Active || exp.target[e] < 0) continue;
    if (exp.delay[e] > 0) {
      exp.delay[e] = exp.delay[e] - 1;
      continue;
    }
    const d = exp.roundDay[e] + 1;
    exp.roundDay[e] = d;
    if (d >= exp.roundLen[e]) resolveRound(w, e);
  }
}

/**
 * The round's last day. One team rolls its region. Bold rolls a second region with the whole team:
 * the one the player named, else the first frontier region that is not a native home. Balanced and
 * Cautious teams that named a second region split in two (half the explorers each); a team too
 * small to split (one explorer) rolls the first region alone. A team with nobody left skips its
 * roll. Then the expedition is idle, Peaceful natives share food, and an expedition with nobody
 * left is Dead.
 */
function resolveRound(w: World, e: number): void {
  const s = w.stores;
  const exp = s.expedition;
  const team = s.expeditionTeam;
  const planet = exp.planet[e];
  const stance = s.expeditionStance.stance[e];
  const a = exp.target[e];
  const b = exp.target2[e];
  clearRolls(s, e);
  let last = a;
  if (stanceRegionsPerRound(stance) === 2) {
    rollRegion(w, e, a, team.explorers[e], 0, false);
    const second = b >= 0 ? b : autoSecondRegion(s, planet, a);
    if (second >= 0 && second !== a && team.explorers[e] > 0) {
      rollRegion(w, e, second, team.explorers[e], 1, false);
      last = second;
    }
  } else if (b >= 0 && team.explorers[e] >= 2) {
    const sizeA = ceilDiv(team.explorers[e], 2);
    const sizeB = team.explorers[e] - sizeA;
    rollRegion(w, e, a, sizeA, 0, true);
    // The first team's losses can leave fewer than the second team's share.
    const left = sizeB < team.explorers[e] ? sizeB : team.explorers[e];
    if (left >= 1) {
      rollRegion(w, e, b, left, 1, true);
      last = b;
    }
  } else if (team.explorers[e] >= 1) {
    rollRegion(w, e, a, team.explorers[e], 0, false);
  }
  exp.region[e] = last;
  exp.target[e] = -1;
  exp.target2[e] = -1;
  exp.roundDay[e] = 0;
  exp.round[e] = exp.round[e] + 1;
  if (
    s.native.revealed[planet] === 1 &&
    effectiveDisposition(s, planet) === Disp.Peaceful &&
    team.explorers[e] > 0
  ) {
    team.supplies[e] += sharedFood(team.explorers[e]);
  }
  if (team.explorers[e] + team.wounded[e] <= 0) {
    exp.status[e] = ExpeditionStatus.Dead;
  }
}

/**
 * One region roll for a team of `size` explorers. Draw order from the expedition's stream: the
 * terrain hazard level (Variable terrain only), the exploration d100, the find d100 (on success),
 * the hazard d100, the hazard kind d100 (on a hazard), the ambush d100 (only in a native home
 * region of Hostile natives met in an earlier roll), then any card draws. Every factor goes into the record.
 */
function rollRegion(
  w: World,
  e: number,
  local: number,
  size: number,
  slot: number,
  split: boolean,
): void {
  const s = w.stores;
  const exp = s.expedition;
  const team = s.expeditionTeam;
  const rng = s.rng;
  const rs = RNG_ENTITY_BASE + e;
  const planet = exp.planet[e];
  const base = s.planet.regionStart[planet];
  const idx = base + local;
  const stance = s.expeditionStance.stance[e];
  const terrain = s.region.terrain[idx];
  const disp = effectiveDisposition(s, planet);
  const home = inNativeHome(s, planet, local);

  // Contact: entering a native home region for the first time reveals the natives.
  let contact = false;
  if (home && s.native.revealed[planet] === 0) {
    s.native.revealed[planet] = 1;
    contact = true;
  }
  const met = s.native.revealed[planet] === 1;

  const basePct = terrainBasePct(terrain);
  const teamPct = teamSizePct(size);
  const kitPct = exploreKitPct(team.kit[e]);
  const stancePct = stanceSuccessPct(stance);
  const natPct = nativesExplorePct(disp, met, home);
  const rawChance = explorationRawPct(basePct, teamPct, kitPct, stancePct, natPct);
  const chance = explorationChancePct(basePct, teamPct, kitPct, stancePct, natPct);

  let level = w.content.terrainHazard[terrain];
  if (w.content.terrainHazardVariable[terrain] === 1) level = 1 + nextInt(rng, rs, 0, 2);
  const roll = nextInt(rng, rs, 0, 99);
  const success = roll < chance;
  let find = -1;
  let fresh = false;
  if (success) {
    fresh = s.region.fog[idx] !== FOG_EXPLORED;
    markExplored(s, planet, local);
    if (fresh || s.region.find[idx] === FIND_UNKNOWN) {
      find = rollFind(w, e, terrain);
      s.region.find[idx] = find;
    } else find = s.region.find[idx];
    if (find === FIND_DISEASE && fresh) {
      const sick = diseaseAmount(size < team.explorers[e] ? size : team.explorers[e]);
      team.explorers[e] -= sick;
      team.wounded[e] += sick;
    }
  }

  const hazardChance = hazardChancePct(level, stance, split);
  const hRoll = nextInt(rng, rs, 0, 99);
  let hKind = HAZARD_NONE;
  let hAmount = 0;
  if (hRoll < hazardChance) {
    hKind = hazardKindOf(nextInt(rng, rs, 0, 99));
    // A hazard falls on the team that rolled (never more people than are left in the party).
    hAmount = hazardAmount(
      hKind,
      size < team.explorers[e] ? size : team.explorers[e],
      team.supplies[e],
    );
    if (hKind === HAZARD_INJURY) {
      team.explorers[e] -= hAmount;
      team.wounded[e] += hAmount;
    } else if (hKind === HAZARD_DEATH) team.explorers[e] -= hAmount;
    else if (hKind === HAZARD_SUPPLIES) team.supplies[e] -= hAmount;
  }

  let aChance = 0;
  let aRoll = -1;
  let aHarm = 0;
  // Only natives already met ambush (never in the roll that makes contact), and only Hostile ones:
  // Wary natives just watch and make a contact card (D-077).
  if (met && !contact && home && disp !== Disp.None) {
    aChance = ambushChancePct(disp, s.native.strength[planet]);
    if (aChance > 0) {
      aRoll = nextInt(rng, rs, 0, 99);
      if (aRoll < aChance) {
        aHarm = ambushHarm(
          size < team.explorers[e] ? size : team.explorers[e],
          disp,
          s.native.strength[planet],
          team.guards[e],
        );
        team.explorers[e] -= aHarm;
      }
    }
  }

  const r = s.expeditionRoll.rec;
  const o = (e * LAST_ROLL_SLOTS + slot) * LR_STRIDE;
  r[o + LR_KIND] = 1;
  r[o + LR_DAY] = s.run.day[0];
  r[o + LR_REGION] = local;
  r[o + LR_TERRAIN] = terrain;
  r[o + LR_BASE] = basePct;
  r[o + LR_TEAM] = teamPct;
  r[o + LR_KITPCT] = kitPct;
  r[o + LR_STANCEPCT] = stancePct;
  r[o + LR_NATIVESPCT] = natPct;
  r[o + LR_RAW_CHANCE] = rawChance;
  r[o + LR_CLAMPED] = clampKind(rawChance);
  r[o + LR_CHANCE] = chance;
  r[o + LR_ROLL] = roll;
  r[o + LR_RESULT] = success ? 1 : 0;
  r[o + LR_FIND] = find;
  r[o + LR_HAZARD_CHANCE] = hazardChance;
  r[o + LR_HAZARD_ROLL] = hRoll;
  r[o + LR_HAZARD_KIND] = hKind;
  r[o + LR_HAZARD_AMOUNT] = hAmount;
  r[o + LR_AMBUSH_CHANCE] = aChance;
  r[o + LR_AMBUSH_ROLL] = aRoll;
  r[o + LR_AMBUSH_HARM] = aHarm;
  r[o + LR_TEAM_SIZE] = size;
  r[o + LR_SPLIT] = split ? 1 : 0;

  // Cards come last: the contact card for the natives just met, a mystery card for a mystery find.
  if (contact && team.explorers[e] + team.wounded[e] > 0) {
    const card = pickExpeditionCard(w, e, SCENE_NATIVE_CONTACT, terrain, disp);
    if (card >= 0) queueExpeditionCard(w, e, card);
  }
  if (find === FIND_MYSTERY && fresh && team.explorers[e] + team.wounded[e] > 0) {
    const card = pickExpeditionCard(w, e, SCENE_EXPLORATION, terrain, disp);
    if (card >= 0) queueExpeditionCard(w, e, card);
  }
}
