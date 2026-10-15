import { CARGO_DIALS, HULLS, LOADOUT, SPEEDS, TRANSIT } from '../data';
import type { LaunchRejectReason } from './commands';
import {
  arrivalFoodDays,
  foundingGradeMarginPct,
  foundingKitPct,
  foundingOddsBand,
  type OddsBand,
} from './planetfall';

export { foundingKitPct, foundingOddsBand, type OddsBand };

/**
 * LoadoutMath: pure launch-loadout formulas shared by the sim (validation and launch), the UI
 * (live preview) and tests. Integers only: every result that feeds state or a roll is an integer
 * (percentages are whole percents, distances are fixed-point grid units, multipliers are x100).
 * The only non-integer operation is Math.sqrt of an exact integer sum (D-025), then rounded.
 * Formulas follow docs/GAME_DESIGN.md section 4; numbers come from src/data (BALANCE.md).
 */

/** Grid units per world unit. Must equal FP_SCALE in src/sim/components.ts (tested). */
export const DISTANCE_FP = 256;

/** One fuel unit in the sim's fractional fuel accumulator: 10000 (burn scale) x DISTANCE_FP. */
export const FUEL_FRAC_UNIT = 10000 * DISTANCE_FP;

/** Largest accepted dial value (steps). Far above any cargo capacity; keeps arithmetic exact. */
export const MAX_DIAL_STEPS = 1_000_000;

export type DialKind = 'cargo' | 'speed';

export interface DialDef {
  id: 'passengers' | 'supplies' | 'fuel' | 'speed' | 'kit' | 'security';
  name: string;
  kind: DialKind;
}

function cargoDial(id: string): (typeof CARGO_DIALS)[number] {
  const d = CARGO_DIALS.find((c) => c.id === id);
  if (!d) throw new Error(`loadout.json is missing the "${id}" dial`);
  return d;
}

const PASSENGERS = cargoDial('passengers');
const SUPPLIES = cargoDial('supplies');
const FUEL = cargoDial('fuel');
const KIT = cargoDial('kit');
const SECURITY = cargoDial('security');

/**
 * The six loadout dials in display order (GAME_DESIGN section 4, D-006): Passengers, Supplies,
 * Fuel, Speed (Economy / Cruise / Hard Burn), Survey kit, Security. Speed costs no cargo.
 * No screen may show more than MAX_LOADOUT_DIALS of these (asserted in tests).
 */
export const LOADOUT_DIALS: readonly DialDef[] = [
  { id: 'passengers', name: PASSENGERS.name, kind: 'cargo' },
  { id: 'supplies', name: SUPPLIES.name, kind: 'cargo' },
  { id: 'fuel', name: FUEL.name, kind: 'cargo' },
  { id: 'speed', name: 'Speed', kind: 'speed' },
  { id: 'kit', name: KIT.name, kind: 'cargo' },
  { id: 'security', name: SECURITY.name, kind: 'cargo' },
];

export const HULL_NAMES: readonly string[] = HULLS.map((h) => h.name);
export const SPEED_NAMES: readonly string[] = SPEEDS.map((x) => x.name);

/** Speed table as integers: multipliers x100 (1.5 becomes 150). `etaMult` is the speed factor. */
const SPEED_MULT_X100: readonly number[] = SPEEDS.map((s) => Math.round(s.etaMult * 100));
const FUEL_MULT_X100: readonly number[] = SPEEDS.map((s) => Math.round(s.fuelMult * 100));

/** What LoadoutMath needs to know about a loadout. A LaunchShip command satisfies this. */
export interface Loadout {
  /** Index into the hull table. */
  hull: number;
  /** Index into the speed table: 0 Economy, 1 Cruise, 2 Hard Burn. */
  speed: number;
  passengers: number;
  supplies: number;
  fuel: number;
  kit: number;
  security: number;
}

export function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

export function isDialValue(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_DIAL_STEPS;
}

export function isHullIndex(h: unknown): h is number {
  return typeof h === 'number' && Number.isInteger(h) && h >= 0 && h < HULLS.length;
}

export function isSpeedIndex(s: unknown): s is number {
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 && s < SPEEDS.length;
}

// ---- Cargo accounting -------------------------------------------------------------------

/** Cargo capacity of a hull class, or 0 for an invalid hull index. */
export function hullCapacity(hull: number): number {
  return isHullIndex(hull) ? HULLS[hull].cargoCapacity : 0;
}

/** Cargo units used by the five cargo dials (speed uses none). Pure sum of steps x cargoPerStep. */
export function cargoUsed(l: Loadout): number {
  return (
    l.passengers * PASSENGERS.cargoPerStep +
    l.supplies * SUPPLIES.cargoPerStep +
    l.fuel * FUEL.cargoPerStep +
    l.kit * KIT.cargoPerStep +
    l.security * SECURITY.cargoPerStep
  );
}

/** Colonists carried (passengers steps x amountPerStep). */
export function passengerAmount(l: Loadout): number {
  return l.passengers * PASSENGERS.amountPerStep;
}
export function supplyAmount(l: Loadout): number {
  return l.supplies * SUPPLIES.amountPerStep;
}
export function fuelAmount(l: Loadout): number {
  return l.fuel * FUEL.amountPerStep;
}
export function kitAmount(l: Loadout): number {
  return l.kit * KIT.amountPerStep;
}
export function securityAmount(l: Loadout): number {
  return l.security * SECURITY.amountPerStep;
}

/** Production spent at launch: hull cost plus kit and security production. */
export function productionCost(l: Loadout): number {
  return (
    (isHullIndex(l.hull) ? HULLS[l.hull].productionCost : 0) +
    l.kit * KIT.productionPerStep +
    l.security * SECURITY.productionPerStep
  );
}

export type CargoDialId = 'passengers' | 'supplies' | 'fuel' | 'kit' | 'security';

/** Cargo units one step of a cargo dial occupies. */
export function cargoPerStep(id: CargoDialId): number {
  return cargoDial(id).cargoPerStep;
}

/** Resource units one step of a cargo dial carries. */
export function amountPerStep(id: CargoDialId): number {
  return cargoDial(id).amountPerStep;
}

/**
 * Largest value dial `id` may take without exceeding the hull cap, given every other dial.
 * Used for slider limits. Never negative.
 */
export function dialMax(l: Loadout, id: CargoDialId): number {
  const per = cargoPerStep(id);
  const others = cargoUsed(l) - l[id] * per;
  const free = hullCapacity(l.hull) - others;
  return free < per ? 0 : Math.floor(free / per);
}

/**
 * Validate a loadout. Returns the first problem, or null. Order: hull, speed, dial values
 * (non-integer, negative or absurd values), cargo cap, passengers. At most the hull's capacity
 * may be used; exactly at the cap passes, one over fails.
 */
export function validateLoadout(l: Loadout): LaunchRejectReason | null {
  if (!isHullIndex(l.hull)) return 'INVALID_HULL';
  if (!isSpeedIndex(l.speed)) return 'INVALID_SPEED_SETTING';
  if (
    !isDialValue(l.passengers) ||
    !isDialValue(l.supplies) ||
    !isDialValue(l.fuel) ||
    !isDialValue(l.kit) ||
    !isDialValue(l.security)
  ) {
    return 'INVALID_LOADOUT';
  }
  if (cargoUsed(l) > HULLS[l.hull].cargoCapacity) return 'OVER_CAPACITY';
  if (l.passengers === 0) return 'NO_PASSENGERS';
  return null;
}

// ---- Derived numbers --------------------------------------------------------------------

/** Distance in fixed-point grid units from an exact integer delta (D-025). */
export function distanceFpFromDelta(dxFp: number, dyFp: number): number {
  return Math.round(Math.sqrt(dxFp * dxFp + dyFp * dyFp));
}

/**
 * ETA in whole days = distance / speed setting, rounded up, at least 1.
 * speed per day = baseSpeed (world units) x speed multiplier; distance is in grid units.
 */
export function etaDaysRaw(distanceFp: number, baseSpeed: number, speedMultX100: number): number {
  const days = ceilDiv(distanceFp * 100, baseSpeed * DISTANCE_FP * speedMultX100);
  return days < 1 ? 1 : days;
}

export function etaDays(distanceFp: number, hull: number, speed: number): number {
  return etaDaysRaw(distanceFp, HULLS[hull].baseSpeed, SPEED_MULT_X100[speed]);
}

/**
 * Fuel burned per world unit of distance, x10000: base burn x100 times the speed's burn
 * multiplier x100. Economy 1.0 / Cruise 1.5 / Hard Burn 2.5 (design).
 */
export function burnRateX10000(speed: number): number {
  return LOADOUT.burnPerUnitX100 * FUEL_MULT_X100[speed];
}

/** Range = fuel / burn rate, in fixed-point grid units (rounded down). */
export function rangeFpRaw(fuelUnits: number, burnX10000: number): number {
  return Math.floor((fuelUnits * 10000 * DISTANCE_FP) / burnX10000);
}

export function rangeFp(fuelUnits: number, speed: number): number {
  return rangeFpRaw(fuelUnits, burnRateX10000(speed));
}

/** Fuel units needed to cover `distanceFp` at a speed setting (rounded up). */
export function fuelNeeded(distanceFp: number, speed: number): number {
  return ceilDiv(distanceFp * burnRateX10000(speed), 10000 * DISTANCE_FP);
}

/**
 * Supply margin in whole percent = supplies / (passengers x ETA) x 100, rounded down and capped
 * (cap also stands in for "nobody aboard"). Below 100 is the red warning; about 130 is comfortable.
 */
export function supplyMarginPct(supplies: number, passengers: number, eta: number): number {
  const need = passengers * eta;
  const cap = LOADOUT.supplyMarginCapPct;
  if (need <= 0) return cap;
  const pct = Math.floor((supplies * 100) / need);
  return pct > cap ? cap : pct;
}

/**
 * Distance a ship covers per day in grid units: hull base speed x speed multiplier. Exact for the
 * shipped tables (tested), so the ETA above is the day the ship arrives.
 */
export function speedFpPerDay(hull: number, speed: number): number {
  return Math.floor((HULLS[hull].baseSpeed * DISTANCE_FP * SPEED_MULT_X100[speed]) / 100);
}

/**
 * Chance of an event card per ship per day, in permille: route hazard x speed factor / hull
 * rating (GAME_DESIGN section 5), scaled by the tuned constant in transit.json. Integer math.
 */
export function eventChancePermille(
  hazard: number,
  hull: number,
  speed: number,
  hullRatingBonusPct = 0,
): number {
  const p = Math.floor(
    (hazard * TRANSIT.eventSpeedFactorX100[speed] * TRANSIT.eventChancePermilleScale) /
      (HULLS[hull].hullRating * (100 + hullRatingBonusPct)),
  );
  return p > TRANSIT.eventChanceMaxPermille ? TRANSIT.eventChanceMaxPermille : p;
}

/** Extra fuel a detour of `days` burns (the distance the ship would have covered). */
export function detourFuel(days: number, hull: number, speed: number): number {
  return fuelNeeded(days * speedFpPerDay(hull, speed), speed);
}

// ---- Rerouting ---------------------------------------------------------------------------

/** Fixed fuel cost of a course change; the new distance is paid on top (GAME_DESIGN section 5). */
export const REROUTE_PENALTY_FUEL: number = TRANSIT.reroutePenaltyFuel;

/** What a ship needs to know for a reroute preview. */
export interface ShipFlight {
  hull: number;
  speed: number;
  fuel: number;
  supplies: number;
  colonists: number;
  /** Days the ship still stands still (event delays). */
  delay: number;
}

export interface ReroutePreview {
  distanceFp: number;
  /** Days to arrive: remaining delay plus the new leg. */
  etaDays: number;
  /** Fuel the new leg burns. */
  tripFuel: number;
  penaltyFuel: number;
  /** penalty + trip. */
  totalFuel: number;
  /** Fuel left on arrival (negative when the target is out of range). */
  fuelAfter: number;
  inRange: boolean;
  supplyMarginPct: number;
}

/** Preview of rerouting to a target `distanceFp` from the ship's position. Allocates one object. */
export function reroutePreview(distanceFp: number, ship: ShipFlight): ReroutePreview {
  const eta = ship.delay + etaDays(distanceFp, ship.hull, ship.speed);
  const trip = fuelNeeded(distanceFp, ship.speed);
  const total = REROUTE_PENALTY_FUEL + trip;
  return {
    distanceFp,
    etaDays: eta,
    tripFuel: trip,
    penaltyFuel: REROUTE_PENALTY_FUEL,
    totalFuel: total,
    fuelAfter: ship.fuel - total,
    inRange: ship.fuel >= total,
    supplyMarginPct: supplyMarginPct(ship.supplies, ship.colonists, eta),
  };
}

/** Radius of the reroute range ring in grid units: what the fuel left after the penalty covers. */
export function rerouteRangeFp(fuel: number, speed: number): number {
  return fuel > REROUTE_PENALTY_FUEL ? rangeFp(fuel - REROUTE_PENALTY_FUEL, speed) : 0;
}

/** Fuel a course change to a target `distanceFp` away costs in all: the fixed penalty plus the leg. */
export function rerouteFuelCost(distanceFp: number, speed: number): number {
  return REROUTE_PENALTY_FUEL + fuelNeeded(distanceFp, speed);
}

/**
 * Range check of a reroute: `spendableFuel` is the whole fuel units the ship can still burn
 * (the sim passes its fuel minus a started unit). Null when the target is inside the range.
 * No allocation.
 */
export function rerouteRangeProblem(
  distanceFp: number,
  speed: number,
  spendableFuel: number,
): 'OUT_OF_RANGE' | null {
  return spendableFuel >= rerouteFuelCost(distanceFp, speed) ? null : 'OUT_OF_RANGE';
}

/** A ship's place and state for a reroute preview. */
export interface ReroutePoint extends ShipFlight {
  /** Position in grid units. */
  xFp: number;
  yFp: number;
  /** Planet the ship is flying to now; it is not offered as an option. */
  destPlanet: number;
}

/** Planet positions as parallel arrays (grid units), as the snapshot can supply them. */
export interface RerouteTargets {
  count: number;
  /** System index of each planet, and the grid position of each system. */
  planetSystem: ArrayLike<number>;
  systemXFp: ArrayLike<number>;
  systemYFp: ArrayLike<number>;
  /** 1 when an own colony holds the planet (arriving there unloads the ship). */
  planetOwned: ArrayLike<number>;
}

export interface RerouteOption {
  planet: number;
  /** True when the ship would unload at an own colony on arrival. */
  unloads: boolean;
  preview: ReroutePreview;
}

/**
 * Every planet inside the ship's remaining fuel range, ascending by planet index, each with the
 * new ETA, fuel cost and supply margin (the same numbers the sim uses to accept the command).
 * Allocates; call on selection, not per frame. `ship.fuel` must be the spendable fuel.
 */
export function rerouteOptions(ship: ReroutePoint, targets: RerouteTargets): RerouteOption[] {
  const out: RerouteOption[] = [];
  for (let p = 0; p < targets.count; p++) {
    if (p === ship.destPlanet) continue;
    const sys = targets.planetSystem[p];
    const d = distanceFpFromDelta(
      targets.systemXFp[sys] - ship.xFp,
      targets.systemYFp[sys] - ship.yFp,
    );
    if (rerouteRangeProblem(d, ship.speed, ship.fuel) !== null) continue;
    out.push({
      planet: p,
      unloads: targets.planetOwned[p] !== 0,
      preview: reroutePreview(d, ship),
    });
  }
  return out;
}

export const SUPPLY_MARGIN_WARN_PCT = 100;
export const SUPPLY_MARGIN_COMFORT_PCT = 130;

// ---- Launch checks and preview ----------------------------------------------------------

/**
 * First problem that stops this loadout launching from a stockpile, or null. Shared by the sim
 * (LaunchShip validation) and the UI (Launch button), so both agree. Order: loadout problems,
 * OUT_OF_RANGE (fuel aboard cannot cover the trip), then the colony's stockpile.
 */
export function firstLaunchProblem(
  l: Loadout,
  distanceFp: number,
  population: number,
  supplies: number,
  fuel: number,
  production: number,
): LaunchRejectReason | null {
  const bad = validateLoadout(l);
  if (bad) return bad;
  if (fuelAmount(l) < fuelNeeded(distanceFp, l.speed)) return 'OUT_OF_RANGE';
  if (passengerAmount(l) > population) return 'INSUFFICIENT_PASSENGERS';
  if (supplyAmount(l) > supplies) return 'INSUFFICIENT_SUPPLIES';
  if (fuelAmount(l) > fuel) return 'INSUFFICIENT_FUEL';
  if (productionCost(l) > production) return 'INSUFFICIENT_PRODUCTION';
  return null;
}

export interface PlanetKnowledge {
  survey: number;
  habLo: number;
  habHi: number;
  /** Native disposition once met (0 None .. 3 Hostile); omitted or -1 while unmet. */
  natives?: number;
}

export interface Stockpile {
  population: number;
  supplies: number;
  fuel: number;
  production: number;
}

/** Everything the Mission Command screen shows for a loadout. */
export interface LoadoutPreview {
  cargoUsed: number;
  cargoCapacity: number;
  cargoFree: number;
  distanceFp: number;
  etaDays: number;
  rangeFp: number;
  fuelNeeded: number;
  colonists: number;
  supplyNeed: number;
  supplyMarginPct: number;
  oddsLo: number;
  oddsHi: number;
  /** Days of food per head left on arrival (negative: the ship starves on the way). */
  arrivalFoodDays: number;
  /** Launch margin at which the founding supplies factor reaches 100 for this ETA. */
  foundingGradeMarginPct: number;
  productionCost: number;
  /** First reason this loadout cannot launch now, or null. */
  problem: LaunchRejectReason | null;
}

/** Compute the live preview. Allocates one object; call on input events, not per frame. */
export function computePreview(
  l: Loadout,
  distanceFp: number,
  planet: PlanetKnowledge,
  stock: Stockpile,
): LoadoutPreview {
  const problem = firstLaunchProblem(
    l,
    distanceFp,
    stock.population,
    stock.supplies,
    stock.fuel,
    stock.production,
  );
  const cap = hullCapacity(l.hull);
  const used = isHullIndex(l.hull) ? cargoUsed(l) : 0;
  const ok = isHullIndex(l.hull) && isSpeedIndex(l.speed);
  const eta = ok ? etaDays(distanceFp, l.hull, l.speed) : 0;
  const margin = ok ? supplyMarginPct(supplyAmount(l), passengerAmount(l), eta) : 0;
  const known = planet.natives === undefined || planet.natives < 0 ? -1 : planet.natives;
  const odds = foundingOddsBand(
    planet.habLo,
    planet.habHi,
    planet.survey,
    ok ? supplyAmount(l) : 0,
    ok ? passengerAmount(l) : 0,
    ok ? securityAmount(l) : 0,
    eta,
    l.kit,
    known,
  );
  return {
    cargoUsed: used,
    cargoCapacity: cap,
    cargoFree: cap - used,
    distanceFp,
    etaDays: eta,
    rangeFp: ok ? rangeFp(fuelAmount(l), l.speed) : 0,
    fuelNeeded: ok ? fuelNeeded(distanceFp, l.speed) : 0,
    colonists: passengerAmount(l),
    supplyNeed: passengerAmount(l) * eta,
    supplyMarginPct: margin,
    oddsLo: odds.lo,
    oddsHi: odds.hi,
    arrivalFoodDays: ok ? arrivalFoodDays(supplyAmount(l), passengerAmount(l), eta) : 0,
    foundingGradeMarginPct: ok ? foundingGradeMarginPct(eta) : 0,
    productionCost: productionCost(l),
    problem,
  };
}

/** Human-readable text for a launch problem (UI). */
export const PROBLEM_TEXT: Record<LaunchRejectReason, string> = {
  NO_SUCH_COLONY: 'No launching colony.',
  NO_SPACEPORT: 'This colony has no spaceport.',
  INVALID_TARGET: 'Pick a destination planet that is not yet colonised.',
  INVALID_HULL: 'Pick a hull.',
  INVALID_SPEED_SETTING: 'Pick a speed setting.',
  INVALID_LOADOUT: 'A dial has an invalid value.',
  OVER_CAPACITY: 'Over the hull cargo capacity.',
  NO_PASSENGERS: 'Load at least one step of passengers.',
  OUT_OF_RANGE: 'Not enough fuel aboard to reach the destination at this speed.',
  INSUFFICIENT_PASSENGERS: 'The colony does not have that many colonists.',
  INSUFFICIENT_SUPPLIES: 'The colony stockpile has too few supplies.',
  INSUFFICIENT_FUEL: 'The colony stockpile has too little fuel.',
  INSUFFICIENT_PRODUCTION: 'Not enough Production for this hull and equipment.',
  SHIP_LIMIT: 'Too many ships in flight.',
  ENTITY_LIMIT: 'The simulation cannot track more ships.',
};
