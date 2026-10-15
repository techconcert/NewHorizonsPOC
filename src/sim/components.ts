import { MAX_EVENT_DEFS } from '../data/limits';
import { FIND_UNKNOWN, LAST_ROLL_SLOTS, LR_STRIDE } from '../shared/planetfall';
import { createRngStore, type RngStore } from './rng';

export { MAX_EVENT_DEFS };

/**
 * Component stores: struct-of-arrays typed arrays with fixed capacities (docs/ARCHITECTURE.md
 * section 6). Galaxy data is indexed by dense type-specific indices (system, planet, region).
 * Dynamic entities (ships, expeditions, colonies) use bitecs entity ids as the array index.
 */

// Capacities
export const MAX_SYSTEMS = 64;
export const MAX_PLANETS_PER_SYSTEM = 5;
export const MAX_PLANETS = MAX_SYSTEMS * MAX_PLANETS_PER_SYSTEM;
export const MAX_REGIONS_PER_PLANET = 19;
export const MAX_REGIONS = MAX_PLANETS * MAX_REGIONS_PER_PLANET;
export const MAX_ENTITIES = 1024;
export const MAX_PENDING_EVENTS = 8;
/** Expeditions on the ground at once (also the snapshot capacity, D-073). */
export const MAX_LIVE_EXPEDITIONS = 32;
export const COMMAND_QUEUE_CAPACITY = 256;
export const COMMAND_LOG_CAPACITY = 8192;
/** Max integer fields of any command, stored per log entry. */
export const COMMAND_MAX_ARGS = 9;

// RNG slots: 0 = GameRng, 1 = galaxy generator, 2 = region generator scratch, 3.. = entities.
export const RNG_GAME = 0;
export const RNG_GALAXY_GEN = 1;
export const RNG_REGION_GEN = 2;
export const RNG_ENTITY_BASE = 3;
export const RNG_SLOTS = RNG_ENTITY_BASE + MAX_ENTITIES;

// Fixed-point galaxy grid: 1 world unit = 256 grid units (no trig anywhere).
export const FP_SCALE = 256;
export const GALAXY_SIZE_UNITS = 1000;
export const GALAXY_SIZE_FP = GALAXY_SIZE_UNITS * FP_SCALE;

export const HOMEWORLD_CLOCK_DAYS = 8000;

// Count groups (indices into Stores.counts)
export const G_FIXED = 0;
export const G_ENTITY = 1;
export const G_LOG = 2;
export const G_SYSTEM = 3;
export const G_PLANET = 4;
export const G_REGION = 5;
export const G_RNG = 6;
export const GROUP_COUNT = 7;

// Enums
export const StarType = { RedDwarf: 0, Orange: 1, Yellow: 2, White: 3, Blue: 4 } as const;
export const STAR_TYPE_COUNT = 5;
export const Survey = { Unknown: 0, Scanned: 1, Surveyed: 2, Explored: 3 } as const;
export const Terrain = { Plains: 0, Highlands: 1, Jungle: 2, Ice: 3, Crater: 4, Ruins: 5 } as const;
export const Disposition = { None: 0, Peaceful: 1, Wary: 2, Hostile: 3 } as const;
export const ShipStateId = {
  None: 0,
  Building: 1,
  Launching: 2,
  Cruising: 3,
  Event: 4,
  Arriving: 5,
  InOrbit: 6,
  Lost: 7,
  /** Cruising along its route (D-043: the design's Cruising state). TravelSystem moves it. */
  InTransit: 8,
  /**
   * Reached the destination planet's system and sits in orbit; planetfall is M4 (D-053). Also the
   * state of a ship that unloaded at one of our colonies (its manifest is then empty).
   */
  Arrived: 9,
  /** Out of fuel: coasting without power until it is Lost (D-051). */
  Drifting: 10,
} as const;
/** Why a ship became Lost (kept in the ship log for scoring). */
export const LostReason = { None: 0, OutOfFuel: 1, AllDead: 2, Destroyed: 3 } as const;
export const RunOutcome = { Running: 0, Won: 1, LostHomeworld: 2, LostAllDead: 3 } as const;
export const PlanetFlag = { Homeworld: 1 } as const;
export const RegionFlag = { LandingZone: 1 } as const;

/** A contiguous byte range of one store, hashed over its live prefix. */
export interface HashTarget {
  bytes: Uint8Array;
  /** Bytes per unit of the group; live bytes = unitBytes * counts[group]. */
  unitBytes: number;
  group: number;
}

export interface Stores {
  counts: Int32Array;
  rng: RngStore;
  dynamicTargets: HashTarget[];
  staticTargets: HashTarget[];

  // Run
  run: {
    seed: Uint32Array;
    /** GameClock: current game day. */
    day: Int32Array;
    /** Game speed: 0, 1, 2 or 4. */
    speed: Uint8Array;
    /** HomeworldClock: days remaining. */
    homeDays: Int32Array;
    outcome: Uint8Array;
    /** Entity id of the homeworld colony (colony 0). */
    homeColony: Int32Array;
    /** Hash of the static galaxy, folded into every state hash. */
    galaxyHash: Uint32Array;
    stateHash: Uint32Array;
    /** Ships that became Lost this run (score log count). */
    shipsLost: Int32Array;
    /** Speed to restore when the last pending event card is resolved (0 = none). */
    resumeSpeed: Uint8Array;
    /** Last resolved card: sequence number, ship, card, choice, risk hit (0 or 1). */
    lastEvent: Int32Array;
    /** Colonists alive off-world when the run ended (WinLoseSystem keeps it current while running). */
    score: Int32Array;
    /** Day the run ended, or 0 while it is running. */
    endDay: Int32Array;
    /** Consecutive days the colony network has met the win condition. */
    winStreak: Int32Array;
  };
  /** Research (ResearchSystem, D-092): known techs as a bit mask, the tech being learned, its points. */
  research: { mask: Uint32Array; current: Int16Array; progress: Int32Array };
  /** CommandLog: append-only, applied day plus type code. Command objects live in World. */
  log: { day: Int32Array; type: Uint8Array; args: Int32Array };

  // Galaxy
  system: {
    x: Int32Array;
    y: Int32Array;
    starType: Uint8Array;
    hazard: Uint8Array;
    planetStart: Uint16Array;
    planetCount: Uint8Array;
  };
  planet: {
    system: Uint16Array;
    habitability: Uint8Array;
    hazard: Uint8Array;
    richness: Uint8Array;
    survey: Uint8Array;
    /** Colony entity id, or -1. */
    owner: Int16Array;
    nativePresence: Uint8Array;
    planetType: Uint8Array;
    flags: Uint8Array;
    regionStart: Uint32Array;
    regionCount: Uint8Array;
  };
  planetSurvey: { habLo: Uint8Array; habHi: Uint8Array };
  region: {
    q: Int8Array;
    r: Int8Array;
    terrain: Uint8Array;
    flags: Uint8Array;
    /**
     * Fog level, same scale as Survey and one byte per region (a DataTexture row): 0 hidden,
     * 1 visible (the landing zone at the start, and every region next to explored land),
     * 3 explored by an expedition. Shared by every expedition on the planet (D-067).
     */
    fog: Uint8Array;
    /** Find kind rolled when the region was explored (FIND_UNKNOWN before). */
    find: Uint8Array;
  };
  /** NativeGroup: indexed by planet (at most one group per planet). */
  native: {
    disposition: Uint8Array;
    strength: Uint8Array;
    /** Kind of natives, 1-based index into planetfall.json natives.variants (0 none); fixed at generation (M7a). */
    variant: Uint8Array;
    /** 0 hidden, 1 revealed by contact. */
    revealed: Uint8Array;
    /** Bit i set when the planet's i-th region is a native home region. */
    homeRegionMask: Uint32Array;
    /** Steps toward Hostile (+) or Peaceful (-) the natives moved since generation (D-072). */
    shift: Int8Array;
    /** Bit i set when the colony claimed the planet's i-th region by pushing the natives out (D-095). */
    claimed: Uint32Array;
    /** 1 when every native home region was claimed: the natives are gone. */
    expelled: Uint8Array;
  };

  // Ships (indexed by entity id)
  ship: { hull: Uint8Array; integrity: Int16Array; speedSetting: Uint8Array };
  shipManifest: {
    colonists: Int32Array;
    supplies: Int32Array;
    fuel: Int32Array;
    kit: Int32Array;
    security: Int32Array;
  };
  shipRoute: {
    destPlanet: Int16Array;
    originSystem: Int16Array;
    distance: Int32Array;
    progress: Int32Array;
    /** Start of the current leg in grid units (a reroute starts where the ship is). */
    originX: Int32Array;
    originY: Int32Array;
    /** Days the ship stands still (event delays); supplies still burn. */
    delay: Int16Array;
    /** Days spent drifting without fuel. */
    drift: Int16Array;
    /** Fractional fuel carried between days, in 1/2,560,000 fuel units. */
    fuelFrac: Int32Array;
  };
  shipState: { state: Uint8Array };
  /** Loss log for scoring: a Lost ship keeps its entity id, reason and day. */
  shipLog: { lostReason: Uint8Array; lostDay: Int32Array; arrivedDay: Int32Array };

  // Expeditions (indexed by entity id)
  expedition: {
    ship: Int32Array;
    planet: Int16Array;
    /** Local index of the region last explored (the landing zone at first). */
    region: Int16Array;
    /** Rounds completed. */
    round: Int16Array;
    /** ExpeditionStatus. */
    status: Uint8Array;
    /** Local region team A is exploring this round, or -1 when waiting for orders. */
    target: Int16Array;
    /** Local region of the second team when the team split, else -1. */
    target2: Int16Array;
    /** Days elapsed in the current round, and the round's length. */
    roundDay: Int16Array;
    roundLen: Int16Array;
    /** Days standing still after a card; supplies still burn. */
    delay: Int16Array;
    landedDay: Int32Array;
  };
  expeditionTeam: {
    explorers: Int32Array;
    guards: Int32Array;
    supplies: Int32Array;
    kit: Int32Array;
    /** Explorers injured or sick: they eat and settle but do not count for the team. */
    wounded: Int32Array;
  };
  expeditionStance: { stance: Uint8Array };
  /**
   * Last roll records, LAST_ROLL_SLOTS x LR_STRIDE Int32 per entity (see LR_* in
   * src/shared/planetfall.ts): the factors, the dice and the result of every roll (D-070).
   */
  expeditionRoll: { rec: Int32Array };

  // Colonies (indexed by entity id)
  colony: {
    planet: Int16Array;
    population: Int32Array;
    spaceport: Uint8Array;
    nativeStance: Uint8Array;
    /** FoundTier the colony was founded with (the homeworld counts as Thriving). */
    tier: Uint8Array;
    /** Days of Struggling penalty left (supply it from elsewhere; applied by the M5 economy). */
    penaltyDays: Int16Array;
    /** Local region index the colony was founded in. */
    site: Int16Array;
    /** Consecutive days the colony could not feed its people; deaths start after the grace days (D-102). */
    hunger: Uint8Array;
  };
  stockpile: { supplies: Int32Array; fuel: Int32Array; production: Int32Array };
  /** District kind per colony per local region index (0 = none). */
  district: {
    kind: Uint8Array;
    /** Build days still to go (0 = finished). An unfinished district produces nothing (D-093). */
    left: Uint8Array;
  };
  /**
   * What each colony made and used on the last economy day, so the colony panel shows the exact
   * numbers the sim used (D-094). Raid fields: the day of the last native raid (-1 none) and its dead.
   */
  colonyFlow: {
    supplies: Int32Array;
    fuel: Int32Array;
    production: Int32Array;
    research: Int32Array;
    eat: Int32Array;
    housing: Int32Array;
    raidDay: Int32Array;
    raidLoss: Int32Array;
    /** Production paid today as Defend upkeep (0 when none is owed). */
    upkeep: Int32Array;
    /** 1 when Defend upkeep was owed today and the colony could not pay it (acts as Coexist). */
    defendUnpaid: Uint8Array;
  };

  // Events
  pendingEventCard: { card: Int16Array; subject: Int32Array; day: Int32Array };
  /** Per ship and card (index = entity * MAX_EVENT_DEFS + card): day the card last fired, or -1. */
  eventHistory: { lastDay: Int32Array };

  // Render support (not hashed): x,y pairs
  prevPosition: Float32Array;
  currPosition: Float32Array;
}

export function createStores(): Stores {
  const counts = new Int32Array(GROUP_COUNT);
  const dynamicTargets: HashTarget[] = [];
  const staticTargets: HashTarget[] = [];

  function bytesOf(a: ArrayBufferView): Uint8Array {
    return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  }
  /** Register `a` (length = capacity x perUnit) in the hash list for `group`. */
  function reg<T extends ArrayBufferView & { BYTES_PER_ELEMENT: number }>(
    list: HashTarget[],
    a: T,
    group: number,
    perUnit = 1,
  ): T {
    list.push({ bytes: bytesOf(a), unitBytes: a.BYTES_PER_ELEMENT * perUnit, group });
    return a;
  }
  const dyn = <T extends ArrayBufferView & { BYTES_PER_ELEMENT: number }>(a: T, g: number, p = 1) =>
    reg(dynamicTargets, a, g, p);
  const sta = <T extends ArrayBufferView & { BYTES_PER_ELEMENT: number }>(a: T, g: number, p = 1) =>
    reg(staticTargets, a, g, p);

  // Fixed-size dynamic arrays hash fully: unit = whole array, count = 1 (G_FIXED).
  const fixed = <T extends ArrayBufferView & { BYTES_PER_ELEMENT: number; length: number }>(a: T) =>
    dyn(a, G_FIXED, a.length);
  counts[G_FIXED] = 1;
  counts[G_RNG] = RNG_ENTITY_BASE;
  dyn(counts, G_FIXED, counts.length);

  // Per-entity RNG state is hidden state: hash the live slot prefix.
  const rng = createRngStore(RNG_SLOTS);
  dyn(rng.a, G_RNG);
  dyn(rng.b, G_RNG);
  dyn(rng.c, G_RNG);
  dyn(rng.d, G_RNG);

  const E = MAX_ENTITIES;
  const stores: Stores = {
    counts,
    rng,
    dynamicTargets,
    staticTargets,
    run: {
      seed: fixed(new Uint32Array(1)),
      day: fixed(new Int32Array(1)),
      speed: fixed(new Uint8Array(1)),
      homeDays: fixed(new Int32Array(1)),
      outcome: fixed(new Uint8Array(1)),
      homeColony: fixed(new Int32Array(1)),
      galaxyHash: fixed(new Uint32Array(1)),
      stateHash: new Uint32Array(1),
      shipsLost: fixed(new Int32Array(1)),
      resumeSpeed: fixed(new Uint8Array(1)),
      lastEvent: fixed(new Int32Array(5)),
      score: fixed(new Int32Array(1)),
      endDay: fixed(new Int32Array(1)),
      winStreak: fixed(new Int32Array(1)),
    },
    research: {
      mask: fixed(new Uint32Array(1)),
      current: fixed(new Int16Array(1).fill(-1)),
      progress: fixed(new Int32Array(1)),
    },
    log: {
      day: dyn(new Int32Array(COMMAND_LOG_CAPACITY), G_LOG),
      type: dyn(new Uint8Array(COMMAND_LOG_CAPACITY), G_LOG),
      args: dyn(new Int32Array(COMMAND_LOG_CAPACITY * COMMAND_MAX_ARGS), G_LOG, COMMAND_MAX_ARGS),
    },

    system: {
      x: sta(new Int32Array(MAX_SYSTEMS), G_SYSTEM),
      y: sta(new Int32Array(MAX_SYSTEMS), G_SYSTEM),
      starType: sta(new Uint8Array(MAX_SYSTEMS), G_SYSTEM),
      hazard: sta(new Uint8Array(MAX_SYSTEMS), G_SYSTEM),
      planetStart: sta(new Uint16Array(MAX_SYSTEMS), G_SYSTEM),
      planetCount: sta(new Uint8Array(MAX_SYSTEMS), G_SYSTEM),
    },
    planet: {
      system: sta(new Uint16Array(MAX_PLANETS), G_PLANET),
      habitability: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      hazard: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      richness: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      survey: dyn(new Uint8Array(MAX_PLANETS), G_PLANET),
      owner: dyn(new Int16Array(MAX_PLANETS).fill(-1), G_PLANET),
      nativePresence: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      planetType: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      flags: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      regionStart: sta(new Uint32Array(MAX_PLANETS), G_PLANET),
      regionCount: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
    },
    planetSurvey: {
      habLo: dyn(new Uint8Array(MAX_PLANETS), G_PLANET),
      habHi: dyn(new Uint8Array(MAX_PLANETS).fill(100), G_PLANET),
    },
    region: {
      q: sta(new Int8Array(MAX_REGIONS), G_REGION),
      r: sta(new Int8Array(MAX_REGIONS), G_REGION),
      terrain: sta(new Uint8Array(MAX_REGIONS), G_REGION),
      flags: sta(new Uint8Array(MAX_REGIONS), G_REGION),
      fog: dyn(new Uint8Array(MAX_REGIONS), G_REGION),
      find: dyn(new Uint8Array(MAX_REGIONS).fill(FIND_UNKNOWN), G_REGION),
    },
    native: {
      disposition: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      strength: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      variant: sta(new Uint8Array(MAX_PLANETS), G_PLANET),
      revealed: dyn(new Uint8Array(MAX_PLANETS), G_PLANET),
      homeRegionMask: sta(new Uint32Array(MAX_PLANETS), G_PLANET),
      shift: dyn(new Int8Array(MAX_PLANETS), G_PLANET),
      claimed: dyn(new Uint32Array(MAX_PLANETS), G_PLANET),
      expelled: dyn(new Uint8Array(MAX_PLANETS), G_PLANET),
    },

    ship: {
      hull: dyn(new Uint8Array(E), G_ENTITY),
      integrity: dyn(new Int16Array(E), G_ENTITY),
      speedSetting: dyn(new Uint8Array(E), G_ENTITY),
    },
    shipManifest: {
      colonists: dyn(new Int32Array(E), G_ENTITY),
      supplies: dyn(new Int32Array(E), G_ENTITY),
      fuel: dyn(new Int32Array(E), G_ENTITY),
      kit: dyn(new Int32Array(E), G_ENTITY),
      security: dyn(new Int32Array(E), G_ENTITY),
    },
    shipRoute: {
      destPlanet: dyn(new Int16Array(E), G_ENTITY),
      originSystem: dyn(new Int16Array(E), G_ENTITY),
      distance: dyn(new Int32Array(E), G_ENTITY),
      progress: dyn(new Int32Array(E), G_ENTITY),
      originX: dyn(new Int32Array(E), G_ENTITY),
      originY: dyn(new Int32Array(E), G_ENTITY),
      delay: dyn(new Int16Array(E), G_ENTITY),
      drift: dyn(new Int16Array(E), G_ENTITY),
      fuelFrac: dyn(new Int32Array(E), G_ENTITY),
    },
    shipState: { state: dyn(new Uint8Array(E), G_ENTITY) },
    shipLog: {
      lostReason: dyn(new Uint8Array(E), G_ENTITY),
      lostDay: dyn(new Int32Array(E), G_ENTITY),
      arrivedDay: dyn(new Int32Array(E), G_ENTITY),
    },

    expedition: {
      ship: dyn(new Int32Array(E), G_ENTITY),
      planet: dyn(new Int16Array(E), G_ENTITY),
      region: dyn(new Int16Array(E), G_ENTITY),
      round: dyn(new Int16Array(E), G_ENTITY),
      status: dyn(new Uint8Array(E), G_ENTITY),
      target: dyn(new Int16Array(E).fill(-1), G_ENTITY),
      target2: dyn(new Int16Array(E).fill(-1), G_ENTITY),
      roundDay: dyn(new Int16Array(E), G_ENTITY),
      roundLen: dyn(new Int16Array(E), G_ENTITY),
      delay: dyn(new Int16Array(E), G_ENTITY),
      landedDay: dyn(new Int32Array(E), G_ENTITY),
    },
    expeditionTeam: {
      explorers: dyn(new Int32Array(E), G_ENTITY),
      guards: dyn(new Int32Array(E), G_ENTITY),
      supplies: dyn(new Int32Array(E), G_ENTITY),
      kit: dyn(new Int32Array(E), G_ENTITY),
      wounded: dyn(new Int32Array(E), G_ENTITY),
    },
    expeditionStance: { stance: dyn(new Uint8Array(E), G_ENTITY) },
    expeditionRoll: {
      rec: dyn(
        new Int32Array(E * LAST_ROLL_SLOTS * LR_STRIDE),
        G_ENTITY,
        LAST_ROLL_SLOTS * LR_STRIDE,
      ),
    },

    colony: {
      planet: dyn(new Int16Array(E), G_ENTITY),
      population: dyn(new Int32Array(E), G_ENTITY),
      spaceport: dyn(new Uint8Array(E), G_ENTITY),
      nativeStance: dyn(new Uint8Array(E), G_ENTITY),
      tier: dyn(new Uint8Array(E), G_ENTITY),
      penaltyDays: dyn(new Int16Array(E), G_ENTITY),
      site: dyn(new Int16Array(E), G_ENTITY),
      hunger: dyn(new Uint8Array(E), G_ENTITY),
    },
    stockpile: {
      supplies: dyn(new Int32Array(E), G_ENTITY),
      fuel: dyn(new Int32Array(E), G_ENTITY),
      production: dyn(new Int32Array(E), G_ENTITY),
    },
    district: {
      kind: dyn(new Uint8Array(E * MAX_REGIONS_PER_PLANET), G_ENTITY, MAX_REGIONS_PER_PLANET),
      left: dyn(new Uint8Array(E * MAX_REGIONS_PER_PLANET), G_ENTITY, MAX_REGIONS_PER_PLANET),
    },
    colonyFlow: {
      supplies: dyn(new Int32Array(E), G_ENTITY),
      fuel: dyn(new Int32Array(E), G_ENTITY),
      production: dyn(new Int32Array(E), G_ENTITY),
      research: dyn(new Int32Array(E), G_ENTITY),
      eat: dyn(new Int32Array(E), G_ENTITY),
      housing: dyn(new Int32Array(E), G_ENTITY),
      raidDay: dyn(new Int32Array(E).fill(-1), G_ENTITY),
      raidLoss: dyn(new Int32Array(E), G_ENTITY),
      upkeep: dyn(new Int32Array(E), G_ENTITY),
      defendUnpaid: dyn(new Uint8Array(E), G_ENTITY),
    },

    pendingEventCard: {
      card: fixed(new Int16Array(MAX_PENDING_EVENTS).fill(-1)),
      subject: fixed(new Int32Array(MAX_PENDING_EVENTS)),
      day: fixed(new Int32Array(MAX_PENDING_EVENTS)),
    },
    eventHistory: {
      lastDay: dyn(new Int32Array(E * MAX_EVENT_DEFS).fill(-1), G_ENTITY, MAX_EVENT_DEFS),
    },

    prevPosition: new Float32Array(E * 2),
    currPosition: new Float32Array(E * 2),
  };
  return stores;
}
