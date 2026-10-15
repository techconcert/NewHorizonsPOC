export interface HullDef {
  id: string;
  name: string;
  cargoCapacity: number;
  baseSpeed: number;
  hullRating: number;
  productionCost: number;
}

export interface SpeedDef {
  id: string;
  name: string;
  fuelMult: number;
  etaMult: number;
}

export interface TerrainDef {
  id: string;
  name: string;
  hazard: string;
  /** One short line of flavour text, shown on the region card. */
  flavour: string;
  finds: number[];
}

export interface PlanetTypeDef {
  id: string;
  name: string;
  terrainWeights: number[];
}

/** A resource change: exactly one of `flat` (units) or `pct` (percent of what the ship holds). */
export interface AmountDef {
  flat?: number;
  pct?: number;
}

/** What a choice does. Only the four resources, hull, delay, speed and one reveal (CONTENT_GUIDE). */
export interface EffectsDef {
  colonists?: AmountDef;
  supplies?: AmountDef;
  fuel?: AmountDef;
  hullPct?: number;
  delayDays?: number;
  detourDays?: number;
  speedDrop?: number;
  revealPlanet?: number;
  /** Planetfall cards: reveal one frontier region (1). */
  revealRegion?: number;
  /** Planetfall cards: -1 natives turn calmer (toward Peaceful), 1 angrier (toward Hostile). */
  nativeMood?: number;
}

export interface RiskDef {
  oddsPct: number;
  /** Odds points added per guard in the expedition (signed); planetfall cards only. */
  securityOddsPerGuard?: number;
  label: string;
  outcomes: EffectsDef;
}

export interface EventChoiceDef {
  label: string;
  preview: string;
  outcomes: EffectsDef;
  risk?: RiskDef;
}

export interface EventCardDef {
  id: string;
  scenes: string[];
  trigger: { shipState?: string; terrain?: string; native?: string; variant?: string };
  weight: number;
  cooldownDays: number;
  title: string;
  body: string;
  choices: EventChoiceDef[];
}

export interface SurveyConfig {
  /** Percent of the current leg still to fly at which the destination becomes Scanned / Surveyed. */
  scannedRemainingPct: number;
  surveyedRemainingPct: number;
  /** Each survey kit step adds this many percentage points to both thresholds (earlier survey). */
  kitBonusPctPerStep: number;
  /** The kit bonus never exceeds this many points in total. */
  kitBonusMaxPct: number;
  /** Habitability range half widths (percent) at Scanned / Surveyed. */
  scannedHalfWidth: number;
  surveyedHalfWidth: number;
}

export interface TransitConfig {
  /** Fixed fuel cost of a course change, on top of the new distance. */
  reroutePenaltyFuel: number;
  /** Percent of unfed colonists that die each day without supplies (rounded up). */
  starvationPctPerDay: number;
  /** Days a ship with no fuel drifts before it is Lost. */
  driftDaysToLost: number;
  /** Event chance per day in permille = hazard x speed factor x scale / (hull rating x 100). */
  eventChancePermilleScale: number;
  /** Cap on the per-day card chance in permille, so a hazardous route never floods the player. */
  eventChanceMaxPermille: number;
  /** Event speed factor x100 per speed setting (Economy, Cruise, Hard Burn). */
  eventSpeedFactorX100: number[];
  survey: SurveyConfig;
}

export interface CargoDialDef {
  id: string;
  name: string;
  /** Cargo units one step occupies. */
  cargoPerStep: number;
  /** Resource units one step carries (colonists, supplies, fuel, kits, escort strength). */
  amountPerStep: number;
  /** Production spent per step at launch. */
  productionPerStep: number;
}

export interface FoundingDef {
  /** [lo, hi] percent per survey level (Unknown, Scanned, Surveyed, Explored); narrows with survey. */
  siteQualityBands: number[][];
  /** Supply margin is assumed to lose this many percent to delays in the low end of the band. */
  delayAllowancePct: number;
  kitBasePct: number;
  kitSaturationSteps: number;
}

export interface LoadoutConfig {
  cargoDials: CargoDialDef[];
  /** Fuel per world unit of distance at Economy, x100. */
  burnPerUnitX100: number;
  supplyMarginCapPct: number;
  founding: FoundingDef;
}

/** A kind of native people (M7a). Fixed at generation; the disposition is the starting mood. */
export interface NativeVariantDef {
  id: string;
  name: string;
  /** Peaceful, Wary or Hostile: the disposition natives of this kind start with. */
  disposition: string;
  /** Added to the native strength rolled at generation (ambush and raid size, existing mechanics). */
  strengthDelta: number;
  flavour: string;
}

export interface PlanetfallConfig {
  stances: {
    successPct: number[];
    hazardPct: number[];
    regionsPerRound: number[];
    roundDays: number[];
  };
  /** Exploration success base per terrain (terrain.json order), percent. */
  terrainExploreBasePct: number[];
  /** Hazard chance per roll by hazard level: index 0 unused, 1 Low, 2 Medium, 3 High. */
  hazardPctByLevel: number[];
  /** Hazard odds multiplier (percent) for a team that split in two. */
  splitHazardPct: number;
  minExplorersPerTeam: number;
  team: { minPct: number; maxPct: number; fullExplorers: number };
  kit: { minPct: number; maxPct: number; fullSteps: number };
  successMinPct: number;
  successMaxPct: number;
  hazard: {
    injuryWeight: number;
    deathWeight: number;
    supplyLossWeight: number;
    injuryPct: number;
    deathPct: number;
    supplyLossPct: number;
    diseaseInjuredPct: number;
  };
  natives: {
    guideSuccessPct: number;
    hostileHomeSuccessPct: number;
    sharedFoodPerExplorer: number;
    strengthBase: number;
    ambushBasePct: number[];
    ambushHarmPct: number[];
    securityReductionPctPerGuard: number;
    securityReductionMaxPct: number;
    variants: NativeVariantDef[];
  };
  founding: {
    reserveDays: number;
    /** Ground days the default loadout plans for before founding (founding-grade margin). */
    planGroundDays: number;
    /** Days of food per colonist the band's high end credits (native gifts). */
    bandGiftDays: number;
    /** Share of colonists / supplies the band's low end allows to be lost. */
    bandColonistLossPct: number;
    bandSupplyLossPct: number;
    viableColonists: number;
    colonistsMinPct: number;
    findWeightPct: number;
    /** Site score per find kind (terrain.json findKinds order), percent. */
    findSitePct: number[];
    /** Natives factor by disposition: None, Peaceful, Wary, Hostile. */
    nativesPct: number[];
    nativeHomePenaltyPts: number;
    securityPtsPerGuard: number;
    securityMaxPts: number;
    thrivingSharePct: number;
    strugglingPenaltyDays: number;
    failedLossPct: number;
  };
}

export interface DistrictDef {
  id: string;
  name: string;
  buildCost: number;
  buildDays: number;
}

export interface NativeColonyConfig {
  raidIntervalDays: number;
  /** Raid chance per interval by effective disposition (None, Peaceful, Wary, Hostile). */
  raidChancePct: number[];
  /** Share of the colony's people a raid kills (before stance, strength and tech). */
  raidHarmPct: number;
  /** Chance a raid also destroys one built district. */
  raidDistrictPct: number;
  /** Stance multipliers (Coexist, Defend, Push out), percent. */
  stanceChancePct: number[];
  stanceHarmPct: number[];
  defendUpkeepProduction: number;
  pushIntervalDays: number;
  pushCostPct: number;
  pushCostMin: number;
  driftIntervalDays: number;
  /** Chance per drift interval that the mood shifts, by stance (Coexist, Defend, Push out). */
  driftChancePct: number[];
}

export interface EconomyConfig {
  districts: DistrictDef[];
  output: {
    farmSupplies: number;
    habitatSupplies: number;
    mineProduction: number;
    refineryFuel: number;
    researchPoints: number;
  };
  /** Terrain percent per productive district. */
  terrainPct: {
    farm: number[];
    mine: number[];
    refinery: number[];
    habitat: number[];
    research: number[];
  };
  /** Colonists a working district needs for full output. */
  workersFull: number;
  minWorkPct: number;
  /** Daily trickle of a settlement: flat Supplies plus one more per `suppliesPopDivisor` people (not the homeworld). */
  settlement: { supplies: number; production: number; suppliesPopDivisor: number };
  /** Grant when a colony is founded: starter Production and a food stock of N days for its people (capped); carried Supplies above that are kept. */
  founding: { starterProduction: number; starterFoodDays: number; starterFoodCap: number };
  /** Colony starvation (separate from the ship rate): percent of the unfed per day after `graceDays` hungry days. */
  starvation: { pctPerDay: number; graceDays: number };
  housing: { base: number; perHabitat: number };
  growth: { permillePerDay: number; tierPct: number[] };
  penaltyOutputPct: number;
  coexistBonusPct: number;
  stockCap: number;
  homeworld: { supplies: number; fuel: number; production: number };
  natives: NativeColonyConfig;
  win: { colonies: number; population: number; holdDays: number };
  lose: { minLaunchPassengers: number };
}

export interface TechDef {
  id: string;
  name: string;
  /** Index into TechsConfig.branches. */
  branch: number;
  /** Research points to learn it. */
  cost: number;
  /** Tech index that must be known first, or -1. */
  prereq: number;
  /** One effect key from TECH_EFFECTS (src/shared/research.ts). */
  effect: string;
  value: number;
  text: string;
}

export interface TechsConfig {
  branches: string[];
  techs: TechDef[];
}
