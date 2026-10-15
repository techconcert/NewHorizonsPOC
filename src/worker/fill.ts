import {
  CHOICE_COST_STRIDE,
  choiceCost,
  EVENT_CHOICE_COUNT,
  EVENT_SCENE,
  expeditionChoiceCost,
  SCENE_TRANSIT,
} from '../shared/events';
import {
  colonistsFactorPct,
  ExpeditionStatus,
  foundingChanceOf,
  LAST_ROLL_SLOTS,
  LR_STRIDE,
  foundingKitPct,
  nativesFoundingMax,
  nativesFoundingMin,
  nativesFoundingPct,
  siteQualityPct,
  siteScore,
  supplyFactorPct,
} from '../shared/planetfall';
import { ceilDiv, speedFpPerDay, supplyMarginPct } from '../shared/loadout';
import { TE, techBonus } from '../shared/research';
import {
  C_ENTITY,
  C_FUEL,
  C_POPULATION,
  C_PRODUCTION,
  C_SPACEPORT,
  C_SUPPLIES,
  C_SYSTEM,
  CD_PENALTY_DAYS,
  CD_PLANET,
  CD_SITE,
  CD_TIER,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  EC_BUILDING,
  EC_CLAIMED,
  EC_EAT,
  EC_FUEL,
  EC_HOUSING,
  EC_NATIVE,
  EC_NATIVE_HOMES,
  EC_PRODUCTION,
  EC_RAID_DAY,
  EC_DEFEND_UNPAID,
  EC_HUNGER,
  EC_UPKEEP,
  EC_RAID_LOSS,
  EC_RESEARCH,
  EC_STANCE,
  EC_SUPPLIES,
  EC_WORKING,
  ECON_STRIDE,
  EXPEDITION_STRIDE,
  META_COLONY_COUNT,
  META_DAY,
  META_EVENT_SEQ,
  META_EXPEDITION_COUNT,
  META_HOME_DAYS,
  META_HOME_SYSTEM,
  META_OUTCOME,
  META_PENDING_CARD,
  META_PENDING_COUNT,
  META_PENDING_SHIP,
  META_PLANET_COUNT,
  META_RESUME_SPEED,
  META_SHIP_COUNT,
  META_SHIPS_LOST,
  META_SPEED,
  META_END_DAY,
  META_RESEARCH_RATE,
  META_SCORE,
  META_STATE_HASH,
  META_SYSTEM_COUNT,
  META_TECH_CURRENT,
  META_TECH_MASK,
  META_TECH_PROGRESS,
  META_TICK_MS,
  META_WIN_STREAK,
  SHIP_POS_STRIDE,
  SNAPSHOT_MAX_COLONIES,
  SNAPSHOT_MAX_EXPEDITIONS,
  SNAPSHOT_MAX_SHIPS,
  SNAPSHOT_REGIONS_PER_COLONY,
  type Snapshot,
  X_COLONISTS_PCT,
  X_DEPOT_COLONISTS,
  X_DEPOT_SUPPLIES,
  X_DELAY,
  X_ENTITY,
  X_EXPLORED,
  X_EXPLORERS,
  X_FOUND_HI,
  X_FOUND_LO,
  X_GUARDS,
  X_KIT,
  X_KIT_PCT,
  X_LANDED,
  X_LANDED_SUPPLIES,
  X_NATIVES_MET,
  X_NATIVES_PCT,
  X_PLANET,
  X_REGION,
  X_REGION_COUNT,
  X_ROUND,
  X_ROUND_DAY,
  X_ROUND_LEN,
  X_SHIP,
  X_STANCE,
  X_STATUS,
  X_SUPPLIES,
  X_SUPPLY_PCT,
  X_TARGET,
  X_TARGET2,
  X_WOUNDED,
} from '../shared/snapshot';
import {
  FP_SCALE,
  G_ENTITY,
  G_PLANET,
  G_SYSTEM,
  MAX_REGIONS_PER_PLANET,
  ShipStateId,
  type Stores,
} from '../sim/components';
import { pendingCount } from '../sim/events';
import { isColony } from '../sim/launch';
import { researchRate } from '../sim/research';
import { effectiveDisposition, exploredCount, FOG_EXPLORED, inNativeHome } from '../sim/planet';
import type { World } from '../sim/world';

/**
 * Write the world into a pooled snapshot (D-034, D-042). No allocation: loops over typed arrays
 * in ascending entity id. Ships and colonies beyond the snapshot capacity are left out (the sim
 * rejects launches past SNAPSHOT_MAX_SHIPS, so ships cannot overflow).
 */
export function fillSnapshot(w: World, s: Snapshot, tickMs: number): void {
  const st = w.stores;
  const m = s.meta;
  const nSys = st.counts[G_SYSTEM];
  const nPlanets = st.counts[G_PLANET];
  const nEnt = st.counts[G_ENTITY];

  for (let i = 0; i < nSys; i++) {
    s.positions[i * 2] = st.system.x[i] / FP_SCALE;
    s.positions[i * 2 + 1] = st.system.y[i] / FP_SCALE;
    s.starType[i] = st.system.starType[i];
    s.planetCount[i] = st.system.planetCount[i];
    s.hazard[i] = st.system.hazard[i];
    s.systemPlanetStart[i] = st.system.planetStart[i];
  }

  for (let p = 0; p < nPlanets; p++) {
    s.planetSystem[p] = st.planet.system[p];
    s.planetSurvey[p] = st.planet.survey[p];
    s.planetHabLo[p] = st.planetSurvey.habLo[p];
    s.planetHabHi[p] = st.planetSurvey.habHi[p];
    s.planetOwned[p] = st.planet.owner[p] >= 0 ? 1 : 0;
    fillPlanetRegions(st, s, p);
  }

  let ships = 0;
  let colonies = 0;
  for (let e = 0; e < nEnt; e++) {
    const state = st.shipState.state[e];
    if (state !== ShipStateId.None) {
      // Lost ships stay in the sim for the score log but are not drawn or listed (D-059).
      if (state !== ShipStateId.Lost && ships < SNAPSHOT_MAX_SHIPS) {
        fillShip(st, s, ships, e);
        ships++;
      }
    } else if (isColony(st, e) && colonies < SNAPSHOT_MAX_COLONIES) {
      const o = colonies * COLONY_STRIDE;
      s.colonies[o + C_ENTITY] = e;
      s.colonies[o + C_SYSTEM] = st.planet.system[st.colony.planet[e]];
      s.colonies[o + C_POPULATION] = st.colony.population[e];
      s.colonies[o + C_SUPPLIES] = st.stockpile.supplies[e];
      s.colonies[o + C_FUEL] = st.stockpile.fuel[e];
      s.colonies[o + C_PRODUCTION] = st.stockpile.production[e];
      s.colonies[o + C_SPACEPORT] = st.colony.spaceport[e];
      const d = colonies * COLONY_DETAIL_STRIDE;
      s.colonyDetail[d + CD_PLANET] = st.colony.planet[e];
      s.colonyDetail[d + CD_TIER] = st.colony.tier[e];
      s.colonyDetail[d + CD_PENALTY_DAYS] = st.colony.penaltyDays[e];
      s.colonyDetail[d + CD_SITE] = st.colony.site[e];
      fillColonyEcon(st, s, colonies, e);
      colonies++;
    }
  }

  m[META_EXPEDITION_COUNT] = fillExpeditions(st, s);
  m[META_TECH_MASK] = st.research.mask[0];
  m[META_TECH_CURRENT] = st.research.current[0];
  m[META_TECH_PROGRESS] = st.research.progress[0];
  m[META_RESEARCH_RATE] = researchRate(w);
  m[META_SCORE] = st.run.score[0];
  m[META_END_DAY] = st.run.endDay[0];
  m[META_WIN_STREAK] = st.run.winStreak[0];

  const pending = pendingCount(w);
  s.eventCosts.fill(0);
  m[META_PENDING_COUNT] = pending;
  m[META_PENDING_CARD] = -1;
  m[META_PENDING_SHIP] = -1;
  if (pending > 0) {
    const card = st.pendingEventCard.card[0];
    const ship = st.pendingEventCard.subject[0];
    m[META_PENDING_CARD] = card;
    m[META_PENDING_SHIP] = ship;
    for (let c = 0; c < EVENT_CHOICE_COUNT[card]; c++) {
      if (EVENT_SCENE[card] === SCENE_TRANSIT) {
        choiceCost(
          card,
          c,
          st.shipManifest.colonists[ship],
          st.shipManifest.supplies[ship],
          st.shipManifest.fuel[ship],
          st.ship.hull[ship],
          st.ship.speedSetting[ship],
          s.eventCosts,
          c * CHOICE_COST_STRIDE,
        );
      } else {
        // A planetfall card: the subject is an expedition, explorers stand in for colonists.
        expeditionChoiceCost(
          card,
          c,
          st.expeditionTeam.explorers[ship],
          st.expeditionTeam.supplies[ship],
          st.expeditionTeam.guards[ship],
          s.eventCosts,
          c * CHOICE_COST_STRIDE,
        );
      }
    }
  }
  m[META_RESUME_SPEED] = st.run.resumeSpeed[0];
  m[META_SHIPS_LOST] = st.run.shipsLost[0];
  m[META_EVENT_SEQ] = st.run.lastEvent[0];
  m[META_DAY] = st.run.day[0];
  m[META_SPEED] = st.run.speed[0];
  m[META_HOME_DAYS] = st.run.homeDays[0];
  m[META_SYSTEM_COUNT] = nSys;
  m[META_PLANET_COUNT] = nPlanets;
  m[META_SHIP_COUNT] = ships;
  m[META_COLONY_COUNT] = colonies;
  m[META_HOME_SYSTEM] = st.planet.system[w.homePlanet];
  m[META_STATE_HASH] = st.run.stateHash[0];
  m[META_OUTCOME] = st.run.outcome[0];
  m[META_TICK_MS] = tickMs;
}

/**
 * The economy row and the district rows of colony row `row` (entity `e`): the stance, what the
 * natives are (once met), what the colony made and used last day, and its districts by region.
 */
function fillColonyEcon(st: Stores, s: Snapshot, row: number, e: number): void {
  const planet = st.colony.planet[e];
  const count = st.planet.regionCount[planet];
  const met = st.native.revealed[planet] === 1;
  const o = row * ECON_STRIDE;
  const x = s.colonyEcon;
  x[o + EC_STANCE] = st.colony.nativeStance[e];
  x[o + EC_NATIVE] = met ? effectiveDisposition(st, planet) : 0;
  const homes = st.native.homeRegionMask[planet];
  const claimed = st.native.claimed[planet];
  let unclaimed = 0;
  let claimedCount = 0;
  if (met && st.native.expelled[planet] === 0) {
    for (let i = 0; i < count; i++) {
      if (((homes >>> i) & 1) === 1) {
        if (((claimed >>> i) & 1) === 1) claimedCount++;
        else unclaimed++;
      }
    }
  } else if (met) {
    for (let i = 0; i < count; i++) if (((claimed >>> i) & 1) === 1) claimedCount++;
  }
  x[o + EC_NATIVE_HOMES] = unclaimed;
  x[o + EC_CLAIMED] = claimedCount;
  x[o + EC_SUPPLIES] = st.colonyFlow.supplies[e];
  x[o + EC_FUEL] = st.colonyFlow.fuel[e];
  x[o + EC_PRODUCTION] = st.colonyFlow.production[e];
  x[o + EC_RESEARCH] = st.colonyFlow.research[e];
  x[o + EC_EAT] = st.colonyFlow.eat[e];
  x[o + EC_HOUSING] = st.colonyFlow.housing[e];
  x[o + EC_RAID_DAY] = st.colonyFlow.raidDay[e];
  x[o + EC_RAID_LOSS] = st.colonyFlow.raidLoss[e];
  x[o + EC_HUNGER] = st.colony.hunger[e];
  x[o + EC_UPKEEP] = st.colonyFlow.upkeep[e];
  x[o + EC_DEFEND_UNPAID] = st.colonyFlow.defendUnpaid[e];
  let working = 0;
  let building = 0;
  const d = row * SNAPSHOT_REGIONS_PER_COLONY;
  for (let i = 0; i < SNAPSHOT_REGIONS_PER_COLONY; i++) {
    const kind = i < count ? st.district.kind[e * MAX_REGIONS_PER_PLANET + i] : 0;
    const left = i < count ? st.district.left[e * MAX_REGIONS_PER_PLANET + i] : 0;
    s.colonyDistrictKind[d + i] = kind;
    s.colonyDistrictLeft[d + i] = left;
    if (kind !== 0) {
      if (left > 0) building++;
      else working++;
    }
  }
  x[o + EC_WORKING] = working;
  x[o + EC_BUILDING] = building;
}

/** One ship row: identity, state, interpolation positions, manifest and flight numbers. */
function fillShip(st: World['stores'], s: Snapshot, row: number, e: number): void {
  const state = st.shipState.state[e];
  s.shipEntity[row] = e;
  s.shipHull[row] = st.ship.hull[e];
  s.shipState[row] = state;
  const o = row * SHIP_POS_STRIDE;
  s.shipPos[o] = st.prevPosition[e * 2];
  s.shipPos[o + 1] = st.prevPosition[e * 2 + 1];
  s.shipPos[o + 2] = st.currPosition[e * 2];
  s.shipPos[o + 3] = st.currPosition[e * 2 + 1];
  s.shipSpeed[row] = st.ship.speedSetting[e];
  s.shipIntegrity[row] = st.ship.integrity[e];
  s.shipDest[row] = st.shipRoute.destPlanet[e];
  const colonists = st.shipManifest.colonists[e];
  const supplies = st.shipManifest.supplies[e];
  s.shipColonists[row] = colonists;
  s.shipSupplies[row] = supplies;
  s.shipFuel[row] = st.shipManifest.fuel[e];
  s.shipKit[row] = st.shipManifest.kit[e];
  s.shipSecurity[row] = st.shipManifest.security[e];
  s.shipProgress[row] = st.shipRoute.progress[e];
  s.shipDistance[row] = st.shipRoute.distance[e];
  s.shipDelay[row] = st.shipRoute.delay[e];
  let eta = 0;
  if (state === ShipStateId.InTransit || state === ShipStateId.Event) {
    const left = st.shipRoute.distance[e] - st.shipRoute.progress[e];
    eta =
      st.shipRoute.delay[e] +
      (left > 0 ? ceilDiv(left, speedFpPerDay(st.ship.hull[e], st.ship.speedSetting[e])) : 0);
  }
  s.shipEta[row] = eta;
  s.shipMargin[row] = supplyMarginPct(supplies, colonists, eta);
}

/**
 * One planet's region map: fog, terrain (only once visible), find (only once explored) and the
 * native home regions (only once the natives have been met), so the snapshot never leaks hidden
 * data (Pillar 3). Disposition and strength are shown only after contact.
 */
function fillPlanetRegions(st: Stores, s: Snapshot, p: number): void {
  const start = st.planet.regionStart[p];
  const count = st.planet.regionCount[p];
  const met = st.native.revealed[p] === 1;
  s.planetRegionStart[p] = start;
  s.planetRegionCount[p] = count;
  s.planetNative[p] = met ? effectiveDisposition(st, p) : 0;
  s.planetNativeStrength[p] = met ? st.native.strength[p] : 0;
  s.planetNativeVariant[p] = met ? st.native.variant[p] : 0;
  for (let i = 0; i < count; i++) {
    const g = start + i;
    const fog = st.region.fog[g];
    s.regionQ[g] = st.region.q[g];
    s.regionR[g] = st.region.r[g];
    s.regionFog[g] = fog;
    s.regionTerrain[g] = fog > 0 ? st.region.terrain[g] : 255;
    s.regionFind[g] = fog === FOG_EXPLORED ? st.region.find[g] : 255;
    s.regionLanding[g] = st.region.flags[g] & 1;
    s.regionNative[g] = met && inNativeHome(st, p, i) ? 1 : 0;
  }
}

/**
 * Expedition rows: live ones first in ascending id (Active, Stranded, or waiting on a card), then
 * finished ones, newest first, while rows remain. Returns the row count. Each row carries the
 * founding preview inputs and the chance range over the explored sites: the known habitability
 * range, each explored region's site quality, the exact supplies, colonists and kit, and the
 * natives factor only once they have been met (D-073).
 */
function fillExpeditions(st: Stores, s: Snapshot): number {
  const nEnt = st.counts[G_ENTITY];
  let rows = 0;
  for (let e = 0; e < nEnt && rows < SNAPSHOT_MAX_EXPEDITIONS; e++) {
    const status = st.expedition.status[e];
    if (
      status === ExpeditionStatus.Active ||
      status === ExpeditionStatus.Stranded ||
      status === ExpeditionStatus.Event
    ) {
      fillExpedition(st, s, rows, e);
      rows++;
    }
  }
  for (let e = nEnt - 1; e >= 0 && rows < SNAPSHOT_MAX_EXPEDITIONS; e--) {
    const status = st.expedition.status[e];
    if (
      status === ExpeditionStatus.Founded ||
      status === ExpeditionStatus.Dead ||
      status === ExpeditionStatus.Returned
    ) {
      fillExpedition(st, s, rows, e);
      rows++;
    }
  }
  return rows;
}

function fillExpedition(st: Stores, s: Snapshot, row: number, e: number): void {
  const x = s.expeditions;
  const o = row * EXPEDITION_STRIDE;
  const exp = st.expedition;
  const team = st.expeditionTeam;
  const planet = exp.planet[e];
  const base = st.planet.regionStart[planet];
  const count = st.planet.regionCount[planet];
  const sh = exp.ship[e];
  const shipState = st.shipState.state[sh];
  const depotAlive = shipState !== ShipStateId.Lost && shipState !== ShipStateId.None;
  const depotColonists = depotAlive ? st.shipManifest.colonists[sh] : 0;
  const depotSupplies = depotAlive ? st.shipManifest.supplies[sh] : 0;
  const live =
    exp.status[e] <= ExpeditionStatus.Stranded || exp.status[e] === ExpeditionStatus.Event;
  // People who eat and count toward the founding factors (guards are armed crew, D-080).
  const landed = team.explorers[e] + team.wounded[e] + depotColonists;
  const landedSupplies = team.supplies[e] + depotSupplies;
  const met = st.native.revealed[planet] === 1;
  const disp = met ? effectiveDisposition(st, planet) : 0;
  const explored = exploredCount(st, planet);

  x[o + X_ENTITY] = e;
  x[o + X_SHIP] = sh;
  x[o + X_PLANET] = planet;
  x[o + X_STATUS] = exp.status[e];
  x[o + X_STANCE] = st.expeditionStance.stance[e];
  x[o + X_EXPLORERS] = team.explorers[e];
  x[o + X_GUARDS] = team.guards[e];
  x[o + X_SUPPLIES] = team.supplies[e];
  x[o + X_KIT] = team.kit[e];
  x[o + X_WOUNDED] = team.wounded[e];
  x[o + X_ROUND] = exp.round[e];
  x[o + X_ROUND_DAY] = exp.roundDay[e];
  x[o + X_ROUND_LEN] = exp.roundLen[e];
  x[o + X_DELAY] = exp.delay[e];
  x[o + X_TARGET] = exp.target[e];
  x[o + X_TARGET2] = exp.target2[e];
  x[o + X_REGION] = exp.region[e];
  x[o + X_EXPLORED] = explored;
  x[o + X_REGION_COUNT] = count;
  x[o + X_LANDED] = live ? landed : 0;
  x[o + X_LANDED_SUPPLIES] = live ? landedSupplies : 0;
  x[o + X_DEPOT_COLONISTS] = depotColonists;
  x[o + X_DEPOT_SUPPLIES] = depotSupplies;
  x[o + X_NATIVES_MET] = met ? 1 : 0;
  x[o + X_NATIVES_PCT] = 100; // lowest natives factor over the explored sites (unmet: the worst case)

  const research = techBonus(st.research.mask[0], TE.Founding);
  let lo = 0;
  let hi = 0;
  let supPct = 0;
  let colPct = 0;
  let kitPct = 0;
  if (live) {
    supPct = supplyFactorPct(landedSupplies, landed);
    colPct = colonistsFactorPct(landed);
    kitPct = foundingKitPct(team.kit[e]);
    lo = 101;
    hi = -1;
    for (let i = 0; i < count; i++) {
      if (st.region.fog[base + i] !== FOG_EXPLORED) continue;
      const find = st.region.find[base + i];
      const site = siteQualityPct(
        siteScore(find === 255 ? -1 : find, explored, count),
        st.planet.survey[planet],
      );
      // Met natives give the exact factor for that region; unmet ones span every disposition
      // (the same range the launch odds band uses), so the preview never hides a risk.
      const natLo = met
        ? nativesFoundingPct(disp, inNativeHome(st, planet, i), team.guards[e])
        : nativesFoundingMin(-1, team.guards[e]);
      const natHi = met ? natLo : nativesFoundingMax(-1, team.guards[e]);
      const a = foundingChanceOf(
        st.planetSurvey.habLo[planet],
        site,
        supPct,
        colPct,
        natLo,
        kitPct,
        research,
      );
      const b = foundingChanceOf(
        st.planetSurvey.habHi[planet],
        site,
        supPct,
        colPct,
        natHi,
        kitPct,
        research,
      );
      if (a < lo) lo = a;
      if (b > hi) hi = b;
      if (natLo < x[o + X_NATIVES_PCT]) x[o + X_NATIVES_PCT] = natLo;
    }
    if (hi < 0) {
      lo = 0;
      hi = 0;
    }
  }
  x[o + X_SUPPLY_PCT] = supPct;
  x[o + X_COLONISTS_PCT] = colPct;
  x[o + X_KIT_PCT] = kitPct;
  x[o + X_FOUND_LO] = lo;
  x[o + X_FOUND_HI] = hi;

  const recLen = LAST_ROLL_SLOTS * LR_STRIDE;
  const src = st.expeditionRoll.rec;
  for (let i = 0; i < recLen; i++) s.expeditionRolls[row * recLen + i] = src[e * recLen + i];
}
