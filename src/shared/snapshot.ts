import { CHOICE_COST_STRIDE, EVENT_CHOICE_SLOTS } from './events';
import { LAST_ROLL_SLOTS, LR_STRIDE } from './planetfall';

/**
 * Snapshot buffers shared by worker and main thread (docs/ARCHITECTURE.md section 3).
 * All data lives in typed arrays so it can be transferred without copying. The worker owns a
 * small pool of snapshots; the main thread copies what it needs and returns the buffers.
 */

/** Must equal MAX_SYSTEMS in src/sim/components.ts (checked by a test). */
export const SNAPSHOT_MAX_SYSTEMS = 64;
/** Must equal MAX_PLANETS in src/sim/components.ts (checked by a test). */
export const SNAPSHOT_MAX_PLANETS = 320;
/** Ships carried in a snapshot (Lost ships are left out); LaunchShip rejects SHIP_LIMIT beyond this (D-042). */
export const SNAPSHOT_MAX_SHIPS = 256;
/** Colonies carried in a snapshot (the homeworld is colony 0). */
export const SNAPSHOT_MAX_COLONIES = 16;
/** Must equal MAX_REGIONS in src/sim/components.ts (checked by a test): 320 planets x 19 regions. */
export const SNAPSHOT_MAX_REGIONS = 6080;
/** Expeditions carried in a snapshot; FormExpedition rejects EXPEDITION_LIMIT beyond this (D-073). */
export const SNAPSHOT_MAX_EXPEDITIONS = 32;

// Indices into Snapshot.meta (a Float64Array so every value is exact).
export const META_DAY = 0;
export const META_SPEED = 1;
export const META_HOME_DAYS = 2;
export const META_SYSTEM_COUNT = 3;
export const META_HOME_SYSTEM = 4;
export const META_STATE_HASH = 5;
export const META_OUTCOME = 6;
export const META_TICK_MS = 7;
export const META_SHIP_COUNT = 8;
export const META_COLONY_COUNT = 9;
export const META_PLANET_COUNT = 10;
/** Pending event cards waiting for the player (0 when none; the game is paused while > 0). */
export const META_PENDING_COUNT = 11;
/** Card index (into the shared event tables) of the oldest pending card, or -1. */
export const META_PENDING_CARD = 12;
/** Ship entity id the oldest pending card is about, or -1. */
export const META_PENDING_SHIP = 13;
/** Speed the game returns to when the last card is resolved (0 = stay paused). */
export const META_RESUME_SPEED = 14;
/** Ships lost so far this run. */
export const META_SHIPS_LOST = 15;
/** Number of event choices resolved so far (the sequence of the last resolved card). */
export const META_EVENT_SEQ = 16;
/** Expeditions on the ground or waiting (rows in `expeditions`). */
export const META_EXPEDITION_COUNT = 17;
/** Known techs as a bit mask (bit i = tech i), the tech being researched (-1 none), its points. */
export const META_TECH_MASK = 18;
export const META_TECH_CURRENT = 19;
export const META_TECH_PROGRESS = 20;
/** Research points per day all colonies made on the last economy day. */
export const META_RESEARCH_RATE = 21;
/** Colonists alive off-world now; the final score once the run has ended (D-096). */
export const META_SCORE = 22;
/** Day the run ended, or 0 while it is running. */
export const META_END_DAY = 23;
/** Consecutive days the colony network has met the win condition. */
export const META_WIN_STREAK = 24;
export const META_LENGTH = 25;

/** Districts per colony in the snapshot: must equal MAX_REGIONS_PER_PLANET in src/sim/components.ts (tested). */
export const SNAPSHOT_REGIONS_PER_COLONY = 19;

/**
 * Colony economy rows in Snapshot.colonyEcon, one per colony row in the same order (D-094, D-095):
 * the stance, what the natives are (only once met), unclaimed and claimed native home regions,
 * what the colony made and used on its last day, housing, the last raid and the district counts.
 */
export const ECON_STRIDE = 17;
export const EC_STANCE = 0;
export const EC_NATIVE = 1;
export const EC_NATIVE_HOMES = 2;
export const EC_CLAIMED = 3;
export const EC_SUPPLIES = 4;
export const EC_FUEL = 5;
export const EC_PRODUCTION = 6;
export const EC_RESEARCH = 7;
export const EC_EAT = 8;
export const EC_HOUSING = 9;
export const EC_RAID_DAY = 10;
export const EC_RAID_LOSS = 11;
export const EC_WORKING = 12;
export const EC_BUILDING = 13;
/** Consecutive days the colony could not feed its people (D-102). */
export const EC_HUNGER = 14;
/** Production paid as Defend upkeep on the last day (D-109). */
export const EC_UPKEEP = 15;
/** 1 when Defend upkeep was owed on the last day and not paid (D-109). */
export const EC_DEFEND_UNPAID = 16;

/** Colony rows in Snapshot.colonies: COLONY_STRIDE Int32 values per colony, ascending entity id. */
export const COLONY_STRIDE = 7;
export const C_ENTITY = 0;
export const C_SYSTEM = 1;
export const C_POPULATION = 2;
export const C_SUPPLIES = 3;
export const C_FUEL = 4;
export const C_PRODUCTION = 5;
export const C_SPACEPORT = 6;

/**
 * Colony detail rows in Snapshot.colonyDetail, one per colony row in the same order: planet index,
 * FoundTier (0 Failed, 1 Struggling, 2 Thriving), days of Struggling penalty left, founding region
 * (local index). Kept apart from `colonies` so that row keeps its M2 layout (D-073).
 */
export const COLONY_DETAIL_STRIDE = 4;
export const CD_PLANET = 0;
export const CD_TIER = 1;
export const CD_PENALTY_DAYS = 2;
export const CD_SITE = 3;

/**
 * Expedition rows in Snapshot.expeditions: EXPEDITION_STRIDE Int32 values per expedition, ascending
 * entity id (D-073). Statuses and stances are the ExpeditionStatus / Stance ids of planetfall.ts.
 */
export const EXPEDITION_STRIDE = 30;
export const X_ENTITY = 0;
export const X_SHIP = 1;
export const X_PLANET = 2;
export const X_STATUS = 3;
export const X_STANCE = 4;
export const X_EXPLORERS = 5;
export const X_GUARDS = 6;
export const X_SUPPLIES = 7;
export const X_KIT = 8;
/** Explorers injured or sick (they eat and settle, but do not count for the team). */
export const X_WOUNDED = 9;
export const X_ROUND = 10;
export const X_ROUND_DAY = 11;
export const X_ROUND_LEN = 12;
export const X_DELAY = 13;
/** Local region team A is exploring (-1 idle), team B's region when split (-1 none), last region explored. */
export const X_TARGET = 14;
export const X_TARGET2 = 15;
export const X_REGION = 16;
export const X_EXPLORED = 17;
export const X_REGION_COUNT = 18;
/** Founding preview inputs: people and supplies that would settle (ship depot included). */
export const X_LANDED = 19;
export const X_LANDED_SUPPLIES = 20;
export const X_SUPPLY_PCT = 21;
export const X_COLONISTS_PCT = 22;
export const X_KIT_PCT = 23;
/** Founding chance range in percent over the explored sites and the known habitability range. */
export const X_FOUND_LO = 24;
export const X_FOUND_HI = 25;
/** Natives factor assumed in the range: 100 until the natives are met. 1 when natives were met. */
export const X_NATIVES_MET = 26;
export const X_NATIVES_PCT = 27;
/** Depot ship still in orbit: colonists and supplies left aboard. */
export const X_DEPOT_COLONISTS = 28;
export const X_DEPOT_SUPPLIES = 29;

/** Ship positions in Snapshot.shipPos: previous x,y then current x,y, in world units. */
export const SHIP_POS_STRIDE = 4;

export interface Snapshot {
  meta: Float64Array;
  /** x,y pairs in world units (galaxy is 1000 x 1000), `systemCount` live entries. */
  positions: Float32Array;
  starType: Uint8Array;
  planetCount: Uint8Array;
  hazard: Uint8Array;
  /** Index of each system's first planet; its planets are start .. start + planetCount - 1. */
  systemPlanetStart: Uint16Array;

  // Planets (`META_PLANET_COUNT` live entries): only what the player has learned.
  planetSystem: Uint16Array;
  /** Survey level: 0 Unknown, 1 Scanned, 2 Surveyed, 3 Explored. */
  planetSurvey: Uint8Array;
  /** Known habitability range, percent. A wide range means little is known. */
  planetHabLo: Uint8Array;
  planetHabHi: Uint8Array;
  /** 1 when a colony owns the planet. */
  planetOwned: Uint8Array;
  /** Planet region map: first region index into the region arrays below and region count (D-073). */
  planetRegionStart: Uint16Array;
  planetRegionCount: Uint8Array;
  /** Native disposition (1 Peaceful, 2 Wary, 3 Hostile) and strength once met; 0 until contact. */
  planetNative: Uint8Array;
  planetNativeStrength: Uint8Array;
  /** Kind of natives once met (1-based native variant, planetfall.json); 0 until contact (M7a). */
  planetNativeVariant: Uint8Array;

  // Regions (`planetRegionStart` / `planetRegionCount` index these; fog is one byte per region,
  // ready for a DataTexture row).
  regionQ: Int8Array;
  regionR: Int8Array;
  /** Fog: 0 hidden, 1 visible, 3 explored. */
  regionFog: Uint8Array;
  /** Terrain id, or 255 while the region is hidden. */
  regionTerrain: Uint8Array;
  /** Find kind (terrain.json findKinds order) of an explored region, else 255. */
  regionFind: Uint8Array;
  /** 1 for the landing zone (always known). */
  regionLanding: Uint8Array;
  /** 1 when the region is a native home region AND the natives have been met; else 0. */
  regionNative: Uint8Array;

  /** Colony rows (`META_COLONY_COUNT` live), see COLONY_STRIDE. */
  colonies: Int32Array;
  /** Planetfall detail of each colony row, see COLONY_DETAIL_STRIDE. */
  colonyDetail: Int32Array;
  /** Economy of each colony row, see ECON_STRIDE. */
  colonyEcon: Int32Array;
  /** District kind (0 none) and build days left per colony row and local region index. */
  colonyDistrictKind: Uint8Array;
  colonyDistrictLeft: Uint8Array;

  // Ships (`META_SHIP_COUNT` live entries, ascending entity id).
  shipEntity: Int32Array;
  shipHull: Uint8Array;
  shipState: Uint8Array;
  shipPos: Float32Array;
  /** Speed setting index: 0 Economy, 1 Cruise, 2 Hard Burn. */
  shipSpeed: Uint8Array;
  /** Hull integrity, percent of a new hull. */
  shipIntegrity: Int16Array;
  /** Destination planet index. */
  shipDest: Int16Array;
  /** Manifest: colonists, supplies, fuel (units). */
  shipColonists: Int32Array;
  shipSupplies: Int32Array;
  shipFuel: Int32Array;
  /** Survey kit and escort (security) still aboard; what FormExpedition can take down (M4b). */
  shipKit: Int32Array;
  shipSecurity: Int32Array;
  /** Distance flown on the current leg and the leg length, in grid units (256 per world unit). */
  shipProgress: Int32Array;
  shipDistance: Int32Array;
  /** Days the ship still stands still (event delays). */
  shipDelay: Int16Array;
  /** Days to arrival at the current speed, delay included; 0 when not flying. */
  shipEta: Int32Array;
  /** Supply margin in percent for the days left (capped, see LoadoutMath); the margin inputs are
   *  shipSupplies, shipColonists and shipEta. */
  shipMargin: Int32Array;

  /** Expedition rows (`META_EXPEDITION_COUNT` live), see EXPEDITION_STRIDE. */
  expeditions: Int32Array;
  /**
   * Last roll records, LAST_ROLL_SLOTS x LR_STRIDE Int32 per expedition row (LR_* in planetfall.ts):
   * every factor, the dice and the result of the expedition's last round (or founding) rolls.
   */
  expeditionRolls: Int32Array;

  /**
   * Cost fields of every choice of the oldest pending card, CHOICE_COST_STRIDE values per choice
   * (see CC_* in events.ts). Text comes from the shared event tables by `META_PENDING_CARD`.
   */
  eventCosts: Int32Array;
}

export function createSnapshot(): Snapshot {
  return {
    meta: new Float64Array(META_LENGTH),
    positions: new Float32Array(SNAPSHOT_MAX_SYSTEMS * 2),
    starType: new Uint8Array(SNAPSHOT_MAX_SYSTEMS),
    planetCount: new Uint8Array(SNAPSHOT_MAX_SYSTEMS),
    hazard: new Uint8Array(SNAPSHOT_MAX_SYSTEMS),
    systemPlanetStart: new Uint16Array(SNAPSHOT_MAX_SYSTEMS),
    planetSystem: new Uint16Array(SNAPSHOT_MAX_PLANETS),
    planetSurvey: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetHabLo: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetHabHi: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetOwned: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetRegionStart: new Uint16Array(SNAPSHOT_MAX_PLANETS),
    planetRegionCount: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetNative: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetNativeStrength: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    planetNativeVariant: new Uint8Array(SNAPSHOT_MAX_PLANETS),
    regionQ: new Int8Array(SNAPSHOT_MAX_REGIONS),
    regionR: new Int8Array(SNAPSHOT_MAX_REGIONS),
    regionFog: new Uint8Array(SNAPSHOT_MAX_REGIONS),
    regionTerrain: new Uint8Array(SNAPSHOT_MAX_REGIONS),
    regionFind: new Uint8Array(SNAPSHOT_MAX_REGIONS),
    regionLanding: new Uint8Array(SNAPSHOT_MAX_REGIONS),
    regionNative: new Uint8Array(SNAPSHOT_MAX_REGIONS),
    colonies: new Int32Array(SNAPSHOT_MAX_COLONIES * COLONY_STRIDE),
    colonyDetail: new Int32Array(SNAPSHOT_MAX_COLONIES * COLONY_DETAIL_STRIDE),
    colonyEcon: new Int32Array(SNAPSHOT_MAX_COLONIES * ECON_STRIDE),
    colonyDistrictKind: new Uint8Array(SNAPSHOT_MAX_COLONIES * SNAPSHOT_REGIONS_PER_COLONY),
    colonyDistrictLeft: new Uint8Array(SNAPSHOT_MAX_COLONIES * SNAPSHOT_REGIONS_PER_COLONY),
    shipEntity: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipHull: new Uint8Array(SNAPSHOT_MAX_SHIPS),
    shipState: new Uint8Array(SNAPSHOT_MAX_SHIPS),
    shipPos: new Float32Array(SNAPSHOT_MAX_SHIPS * SHIP_POS_STRIDE),
    shipSpeed: new Uint8Array(SNAPSHOT_MAX_SHIPS),
    shipIntegrity: new Int16Array(SNAPSHOT_MAX_SHIPS),
    shipDest: new Int16Array(SNAPSHOT_MAX_SHIPS),
    shipColonists: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipSupplies: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipFuel: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipKit: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipSecurity: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipProgress: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipDistance: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipDelay: new Int16Array(SNAPSHOT_MAX_SHIPS),
    shipEta: new Int32Array(SNAPSHOT_MAX_SHIPS),
    shipMargin: new Int32Array(SNAPSHOT_MAX_SHIPS),
    expeditions: new Int32Array(SNAPSHOT_MAX_EXPEDITIONS * EXPEDITION_STRIDE),
    expeditionRolls: new Int32Array(SNAPSHOT_MAX_EXPEDITIONS * LAST_ROLL_SLOTS * LR_STRIDE),
    eventCosts: new Int32Array(EVENT_CHOICE_SLOTS * CHOICE_COST_STRIDE),
  };
}

/** Copy every field of `src` into `dst`. No allocation. */
export function copySnapshotInto(src: Snapshot, dst: Snapshot): void {
  dst.meta.set(src.meta);
  dst.positions.set(src.positions);
  dst.starType.set(src.starType);
  dst.planetCount.set(src.planetCount);
  dst.hazard.set(src.hazard);
  dst.systemPlanetStart.set(src.systemPlanetStart);
  dst.planetSystem.set(src.planetSystem);
  dst.planetSurvey.set(src.planetSurvey);
  dst.planetHabLo.set(src.planetHabLo);
  dst.planetHabHi.set(src.planetHabHi);
  dst.planetOwned.set(src.planetOwned);
  dst.planetRegionStart.set(src.planetRegionStart);
  dst.planetRegionCount.set(src.planetRegionCount);
  dst.planetNative.set(src.planetNative);
  dst.planetNativeStrength.set(src.planetNativeStrength);
  dst.planetNativeVariant.set(src.planetNativeVariant);
  dst.regionQ.set(src.regionQ);
  dst.regionR.set(src.regionR);
  dst.regionFog.set(src.regionFog);
  dst.regionTerrain.set(src.regionTerrain);
  dst.regionFind.set(src.regionFind);
  dst.regionLanding.set(src.regionLanding);
  dst.regionNative.set(src.regionNative);
  dst.colonies.set(src.colonies);
  dst.colonyDetail.set(src.colonyDetail);
  dst.colonyEcon.set(src.colonyEcon);
  dst.colonyDistrictKind.set(src.colonyDistrictKind);
  dst.colonyDistrictLeft.set(src.colonyDistrictLeft);
  dst.shipEntity.set(src.shipEntity);
  dst.shipHull.set(src.shipHull);
  dst.shipState.set(src.shipState);
  dst.shipPos.set(src.shipPos);
  dst.shipSpeed.set(src.shipSpeed);
  dst.shipIntegrity.set(src.shipIntegrity);
  dst.shipDest.set(src.shipDest);
  dst.shipColonists.set(src.shipColonists);
  dst.shipSupplies.set(src.shipSupplies);
  dst.shipFuel.set(src.shipFuel);
  dst.shipKit.set(src.shipKit);
  dst.shipSecurity.set(src.shipSecurity);
  dst.shipProgress.set(src.shipProgress);
  dst.shipDistance.set(src.shipDistance);
  dst.shipDelay.set(src.shipDelay);
  dst.shipEta.set(src.shipEta);
  dst.shipMargin.set(src.shipMargin);
  dst.expeditions.set(src.expeditions);
  dst.expeditionRolls.set(src.expeditionRolls);
  dst.eventCosts.set(src.eventCosts);
}

/** The ArrayBuffers to list as transferables when posting or returning a snapshot. */
export function snapshotBuffers(s: Snapshot): ArrayBuffer[] {
  return [
    s.meta.buffer as ArrayBuffer,
    s.positions.buffer as ArrayBuffer,
    s.starType.buffer as ArrayBuffer,
    s.planetCount.buffer as ArrayBuffer,
    s.hazard.buffer as ArrayBuffer,
    s.systemPlanetStart.buffer as ArrayBuffer,
    s.planetSystem.buffer as ArrayBuffer,
    s.planetSurvey.buffer as ArrayBuffer,
    s.planetHabLo.buffer as ArrayBuffer,
    s.planetHabHi.buffer as ArrayBuffer,
    s.planetOwned.buffer as ArrayBuffer,
    s.planetRegionStart.buffer as ArrayBuffer,
    s.planetRegionCount.buffer as ArrayBuffer,
    s.planetNative.buffer as ArrayBuffer,
    s.planetNativeStrength.buffer as ArrayBuffer,
    s.planetNativeVariant.buffer as ArrayBuffer,
    s.regionQ.buffer as ArrayBuffer,
    s.regionR.buffer as ArrayBuffer,
    s.regionFog.buffer as ArrayBuffer,
    s.regionTerrain.buffer as ArrayBuffer,
    s.regionFind.buffer as ArrayBuffer,
    s.regionLanding.buffer as ArrayBuffer,
    s.regionNative.buffer as ArrayBuffer,
    s.colonies.buffer as ArrayBuffer,
    s.colonyDetail.buffer as ArrayBuffer,
    s.colonyEcon.buffer as ArrayBuffer,
    s.colonyDistrictKind.buffer as ArrayBuffer,
    s.colonyDistrictLeft.buffer as ArrayBuffer,
    s.shipEntity.buffer as ArrayBuffer,
    s.shipHull.buffer as ArrayBuffer,
    s.shipState.buffer as ArrayBuffer,
    s.shipPos.buffer as ArrayBuffer,
    s.shipSpeed.buffer as ArrayBuffer,
    s.shipIntegrity.buffer as ArrayBuffer,
    s.shipDest.buffer as ArrayBuffer,
    s.shipColonists.buffer as ArrayBuffer,
    s.shipSupplies.buffer as ArrayBuffer,
    s.shipFuel.buffer as ArrayBuffer,
    s.shipKit.buffer as ArrayBuffer,
    s.shipSecurity.buffer as ArrayBuffer,
    s.shipProgress.buffer as ArrayBuffer,
    s.shipDistance.buffer as ArrayBuffer,
    s.shipDelay.buffer as ArrayBuffer,
    s.shipEta.buffer as ArrayBuffer,
    s.shipMargin.buffer as ArrayBuffer,
    s.expeditions.buffer as ArrayBuffer,
    s.expeditionRolls.buffer as ArrayBuffer,
    s.eventCosts.buffer as ArrayBuffer,
  ];
}

/** True when any buffer was transferred away (detached buffers have length 0). */
export function isDetached(s: Snapshot): boolean {
  return s.meta.length === 0 || s.positions.length === 0 || s.starType.length === 0;
}
