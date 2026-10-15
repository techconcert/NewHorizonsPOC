import type { LaunchShipCommand, RejectReason } from '../shared/commands';
import {
  amountPerStep,
  ceilDiv,
  computePreview,
  dialMax,
  DISTANCE_FP,
  distanceFpFromDelta,
  etaDays,
  fuelNeeded,
  hullCapacity,
  isHullIndex,
  isSpeedIndex,
  LOADOUT_DIALS,
  PROBLEM_TEXT,
  SUPPLY_MARGIN_COMFORT_PCT,
  SUPPLY_MARGIN_WARN_PCT,
  type CargoDialId,
  type Loadout,
  type LoadoutPreview,
} from '../shared/loadout';
import {
  colonistsFactorPct,
  foundingGradeMarginPct,
  PF,
  supplyFactorPct,
} from '../shared/planetfall';
import { expectedEventsX100 } from '../shared/transit';
import {
  C_FUEL,
  C_POPULATION,
  C_PRODUCTION,
  C_SPACEPORT,
  C_SUPPLIES,
  C_SYSTEM,
  COLONY_STRIDE,
  META_COLONY_COUNT,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Pure Mission Command model: dial state, clamping to the hull cap, and the live preview. No DOM,
 * so it is unit-tested. The preview runs on the main thread from the latest snapshot and the shared
 * LoadoutMath (D-041), so a dial change shows its numbers in the same frame.
 */

export const CARGO_DIAL_IDS: readonly CargoDialId[] = [
  'passengers',
  'supplies',
  'fuel',
  'kit',
  'security',
];

/** Order in which dials give up cargo when a smaller hull is picked. */
const TRIM_ORDER: readonly CargoDialId[] = ['kit', 'security', 'supplies', 'fuel', 'passengers'];

export interface MissionState {
  /** Dials the player has set by hand; defaults never overwrite these. */
  edited: Record<CargoDialId, boolean>;
  /** Selected destination system, or -1. */
  system: number;
  /** Which planet of that system. */
  planetSlot: number;
  hull: number;
  speed: number;
  passengers: number;
  supplies: number;
  fuel: number;
  kit: number;
  security: number;
}

/** A sensible Ark starting loadout (steps). */
export function createMissionState(): MissionState {
  return {
    edited: { passengers: false, supplies: false, fuel: false, kit: false, security: false },
    system: -1,
    planetSlot: 0,
    hull: 1,
    speed: 0,
    passengers: 20,
    supplies: 60,
    fuel: 20,
    kit: 2,
    security: 0,
  };
}

/** The dials shown on the Mission Command screen: exactly the shared dial list (at most 6). */
export function dialsOnScreen(): readonly { id: string; name: string; kind: string }[] {
  return LOADOUT_DIALS;
}

export function loadoutOf(state: MissionState): Loadout {
  return {
    hull: state.hull,
    speed: state.speed,
    passengers: state.passengers,
    supplies: state.supplies,
    fuel: state.fuel,
    kit: state.kit,
    security: state.security,
  };
}

/** Largest value a cargo dial can take now (hull cap minus the other dials). */
export function sliderMax(state: MissionState, id: CargoDialId): number {
  return dialMax(loadoutOf(state), id);
}

/** Set a cargo dial; non-integers are floored, values are clamped to [0, sliderMax]. */
export function setDial(state: MissionState, id: CargoDialId, value: number): void {
  state.edited[id] = true;
  const v = Number.isFinite(value) ? Math.floor(value) : 0;
  const max = sliderMax(state, id);
  state[id] = v < 0 ? 0 : v > max ? max : v;
}

/** Shrink dials (in TRIM_ORDER) until the loadout fits the current hull. */
export function fitToHull(state: MissionState): void {
  for (const id of TRIM_ORDER) {
    const max = sliderMax(state, id);
    if (state[id] > max) state[id] = max;
  }
}

export function setHull(state: MissionState, hull: number): void {
  state.hull = hull;
  fitToHull(state);
}

export function setSpeed(state: MissionState, speed: number): void {
  state.speed = speed;
}

export function setSystem(state: MissionState, system: number): void {
  state.system = system;
  state.planetSlot = 0;
}

/** Row index of the first colony with a spaceport in the snapshot, or -1. */
export function launchingColonyRow(snap: Snapshot): number {
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 0; i < n; i++) {
    if (snap.colonies[i * COLONY_STRIDE + C_SPACEPORT] !== 0) return i;
  }
  return -1;
}

/** Planet index chosen by the destination card, or -1. */
export function targetPlanet(state: MissionState, snap: Snapshot): number {
  if (state.system < 0 || state.system >= snap.planetCount.length) return -1;
  if (state.planetSlot < 0 || state.planetSlot >= snap.planetCount[state.system]) return -1;
  return snap.systemPlanetStart[state.system] + state.planetSlot;
}

/** Distance between two systems in grid units, from the snapshot's float positions (exact). */
export function systemDistanceFpFromSnapshot(snap: Snapshot, a: number, b: number): number {
  const dx =
    Math.round(snap.positions[a * 2] * DISTANCE_FP) -
    Math.round(snap.positions[b * 2] * DISTANCE_FP);
  const dy =
    Math.round(snap.positions[a * 2 + 1] * DISTANCE_FP) -
    Math.round(snap.positions[b * 2 + 1] * DISTANCE_FP);
  return distanceFpFromDelta(dx, dy);
}

export interface MissionView {
  preview: LoadoutPreview;
  /** Expected event cards on the trip, x100 (faster means fewer; shared with the sim's formula). */
  expectedEventsX100: number;
  colonyEntity: number;
  planet: number;
  survey: number;
  habLo: number;
  habHi: number;
}

/** The live preview, or null when there is no launching colony or no destination yet. */
export function buildView(state: MissionState, snap: Snapshot): MissionView | null {
  const row = launchingColonyRow(snap);
  const planet = targetPlanet(state, snap);
  if (row < 0 || planet < 0) return null;
  const o = row * COLONY_STRIDE;
  const survey = snap.planetSurvey[planet];
  const habLo = snap.planetHabLo[planet];
  const habHi = snap.planetHabHi[planet];
  const distance = systemDistanceFpFromSnapshot(
    snap,
    snap.colonies[o + C_SYSTEM],
    snap.planetSystem[planet],
  );
  const preview = computePreview(
    loadoutOf(state),
    distance,
    {
      survey,
      habLo,
      habHi,
      natives: snap.planetNative[planet] > 0 ? snap.planetNative[planet] : -1,
    },
    {
      population: snap.colonies[o + C_POPULATION],
      supplies: snap.colonies[o + C_SUPPLIES],
      fuel: snap.colonies[o + C_FUEL],
      production: snap.colonies[o + C_PRODUCTION],
    },
  );
  // An owned planet is not a valid destination (the sim rejects INVALID_TARGET).
  if (snap.planetOwned[planet] !== 0) preview.problem = 'INVALID_TARGET';
  const hazard = snap.hazard[snap.planetSystem[planet]];
  const expected =
    isHullIndex(state.hull) && isSpeedIndex(state.speed)
      ? expectedEventsX100(distance, state.hull, state.speed, hazard)
      : 0;
  return {
    preview,
    expectedEventsX100: expected,
    colonyEntity: snap.colonies[o],
    planet,
    survey,
    habLo,
    habHi,
  };
}

/** The LaunchShip command for the current state, or null when it cannot launch. */
export function launchCommand(state: MissionState, snap: Snapshot): LaunchShipCommand | null {
  const view = buildView(state, snap);
  if (!view || view.preview.problem !== null) return null;
  return {
    type: 'LaunchShip',
    colony: view.colonyEntity,
    target: view.planet,
    hull: state.hull,
    passengers: state.passengers,
    supplies: state.supplies,
    fuel: state.fuel,
    speed: state.speed,
    kit: state.kit,
    security: state.security,
  };
}

// ---- Formatting (pure) -------------------------------------------------------------------

export const SURVEY_LABELS: readonly string[] = ['Unknown', 'Scanned', 'Surveyed', 'Explored'];

export function surveyLabel(level: number): string {
  return SURVEY_LABELS[level] ?? 'Unknown';
}

/** "35 to 60%", or "40%" when the band is a single value. */
export function formatOdds(lo: number, hi: number): string {
  return lo === hi ? `${lo}%` : `${lo} to ${hi}%`;
}

/** Range in whole world units (the galaxy is 1000 across). */
export function formatRange(rangeFp: number): number {
  return Math.floor(rangeFp / DISTANCE_FP);
}

/** Colour class for the supply margin: bad under 100%, ok to 130%, good beyond. */
export function marginClass(pct: number): 'bad' | 'ok' | 'good' {
  return pct < SUPPLY_MARGIN_WARN_PCT ? 'bad' : pct < SUPPLY_MARGIN_COMFORT_PCT ? 'ok' : 'good';
}

/** Text cue for the margin class, so status never rests on colour alone. */
export function marginCue(pct: number): 'LOW' | 'OK' | 'SAFE' {
  const c = marginClass(pct);
  return c === 'bad' ? 'LOW' : c === 'ok' ? 'OK' : 'SAFE';
}

/**
 * Days of food per head on arrival as text. A negative value means the colonists run out on the
 * way, said in words so the cue never rests on colour alone.
 */
export function arrivalFoodText(days: number): string {
  if (days < 0) return `short by ${-days} days: colonists starve before arrival`;
  return days === 1 ? '1 day per head' : `${days} days per head`;
}

/** Cue for the arrival food: none left, under the founding reserve, or enough for it. */
export function arrivalFoodCue(days: number): 'NONE' | 'THIN' | 'OK' {
  return days <= 0
    ? 'NONE'
    : days < PF.founding.reserveDays + PF.founding.planGroundDays
      ? 'THIN'
      : 'OK';
}

/**
 * The founding-grade margin line: the margin that gives full supplies at founding for this trip,
 * and whether the loadout reaches it ("met") or how many points it falls short.
 */
export function foundingGradeText(gradePct: number, marginPct: number): string {
  const gap = gradePct - marginPct;
  return gap <= 0 ? `${gradePct}% (met)` : `${gradePct}% (${gap} points short)`;
}

/** Resource shown next to each cargo dial's step count. */
export const DIAL_UNIT: Record<CargoDialId, string> = {
  passengers: 'colonists',
  supplies: 'supplies',
  fuel: 'fuel',
  kit: 'kits',
  security: 'escort',
};

export function dialAmountText(id: CargoDialId, steps: number): string {
  return `${steps * amountPerStep(id)} ${DIAL_UNIT[id]}`;
}

// ---- Default loadout ---------------------------------------------------------------------

/** Trip length assumed for defaults before a destination is chosen (world units). */
export const TYPICAL_TRIP_UNITS = 150;
const DEFAULT_KIT_STEPS = 4;

/**
 * A sensible loadout for a hull over `distanceFp` at Economy: fuel for the trip, one kit, then the
 * passengers and supplies that maximise the colonists and supplies factors the founding roll will
 * see: food for the trip, the planned ground days and the reserve (the founding-grade margin)
 * where the cargo allows, fewer passengers when it does not. Integer search over the passenger
 * count; ties keep more passengers. Pure.
 */
export function defaultDials(
  hull: number,
  distanceFp: number,
): Record<CargoDialId, number> & { speed: number } {
  const cap = hullCapacity(hull);
  const eta = etaDays(distanceFp, hull, 0);
  let fuel = ceilDiv(fuelNeeded(distanceFp, 0), amountPerStep('fuel'));
  const kit = cap >= 2 * DEFAULT_KIT_STEPS + 1 ? DEFAULT_KIT_STEPS : 0;
  if (fuel > cap - 2 * kit - 2) fuel = Math.max(0, cap - 2 * kit - 2);
  const room = cap - fuel - 2 * kit;
  const perPassengerStep = amountPerStep('passengers') * eta * foundingGradeMarginPct(eta);
  const perSupplyStep = 100 * amountPerStep('supplies');
  const groundDays = eta + PF.founding.planGroundDays;
  // First choice: the most passengers whose supplies still reach the founding-grade margin, so a
  // default launch never founds on a thin food factor (fewer passengers beat thin supplies).
  for (let p = Math.max(1, room); p >= 1; p--) {
    const s = ceilDiv(p * perPassengerStep, perSupplyStep);
    if (p + s <= room) return { passengers: p, supplies: s, fuel, kit, security: 0, speed: 0 };
  }
  // Cargo cannot hold even one passenger at the grade: best product of the two factors.
  let bestScore = -1;
  let passengers = Math.max(1, room);
  let supplies = 0;
  for (let p = Math.max(1, room); p >= 1; p--) {
    let s = ceilDiv(p * perPassengerStep, perSupplyStep);
    if (p + s > room) s = Math.max(0, room - p);
    const people = p * amountPerStep('passengers');
    const left = s * amountPerStep('supplies') - people * groundDays;
    const score = colonistsFactorPct(people) * supplyFactorPct(left < 0 ? 0 : left, people);
    if (score > bestScore) {
      bestScore = score;
      passengers = p;
      supplies = s;
    }
  }
  return { passengers, supplies, fuel, kit, security: 0, speed: 0 };
}

/**
 * Re-choose defaults after the destination or hull changed. Only dials the player has not edited
 * change; edited ones are kept (trimmed only if the new hull cannot hold them). Needs a snapshot to
 * measure the trip, else uses TYPICAL_TRIP_UNITS.
 */
export function applyDefaults(state: MissionState, snap: Snapshot | null): void {
  let distance = TYPICAL_TRIP_UNITS * DISTANCE_FP;
  if (snap) {
    const row = launchingColonyRow(snap);
    const planet = targetPlanet(state, snap);
    if (row >= 0 && planet >= 0) {
      distance = systemDistanceFpFromSnapshot(
        snap,
        snap.colonies[row * COLONY_STRIDE + C_SYSTEM],
        snap.planetSystem[planet],
      );
    }
  }
  const d = defaultDials(state.hull, distance);
  fitToHull(state);
  // Clear the unedited dials, then fill them in priority order so fuel for the trip is never
  // squeezed out by passengers: fuel, kit, passengers, supplies, security.
  for (const id of CARGO_DIAL_IDS) if (!state.edited[id]) state[id] = 0;
  for (const id of DEFAULT_ORDER) {
    if (state.edited[id]) continue;
    const max = sliderMax(state, id);
    state[id] = d[id] > max ? max : d[id];
  }
}

const DEFAULT_ORDER: readonly CargoDialId[] = ['fuel', 'kit', 'passengers', 'supplies', 'security'];

/** Pick a hull (player action) and refresh the defaults. */
export function chooseHull(state: MissionState, hull: number, snap: Snapshot | null): void {
  state.hull = hull;
  applyDefaults(state, snap);
}

/** Pick a destination system or planet slot (player action) and refresh the defaults. */
export function chooseDestination(
  state: MissionState,
  system: number,
  slot: number,
  snap: Snapshot | null,
): void {
  state.system = system;
  state.planetSlot = slot;
  applyDefaults(state, snap);
}

// ---- Launch button gate ------------------------------------------------------------------

/** After a launch is sent the button stays off until a snapshot or the command reply arrives. */
export interface LaunchGate {
  awaiting: boolean;
}

export function createLaunchGate(): LaunchGate {
  return { awaiting: false };
}

/** Enabled only when nothing is in flight and the preview has no problem. */
export function launchEnabled(gate: LaunchGate, problem: string | null): boolean {
  return !gate.awaiting && problem === null;
}

export function gateSent(gate: LaunchGate): void {
  gate.awaiting = true;
}

/** A snapshot or a command reply arrived. */
export function gateSettled(gate: LaunchGate): void {
  gate.awaiting = false;
}

// ---- Human text for rejected commands ----------------------------------------------------

const OTHER_REJECTS: Record<Exclude<RejectReason, keyof typeof PROBLEM_TEXT>, string> = {
  UNKNOWN_COMMAND: 'Unknown command.',
  INVALID_SHAPE: 'The command was malformed.',
  INVALID_SPEED: 'That game speed is not available.',
  NOT_IMPLEMENTED_YET: 'Not available yet.',
  QUEUE_FULL: 'Too many commands at once. Try again.',
  LOG_FULL: 'The command log is full.',
  NO_SUCH_SHIP: 'There is no such ship.',
  SHIP_LOST: 'That ship is lost.',
  SHIP_DRIFTING: 'That ship has no fuel and cannot change course.',
  EVENT_PENDING: 'Resolve the event card first.',
  SHIP_NOT_IN_TRANSIT: 'That ship is not in flight.',
  EXPEDITION_ACTIVE: 'Bring the expedition back aboard first.',
  SAME_TARGET: 'The ship is already flying there.',
  NO_PENDING_EVENT: 'No event card is waiting.',
  INVALID_CHOICE: 'That choice does not exist.',
  SHIP_NOT_ARRIVED: 'That ship is not in orbit at a planet.',
  PLANET_OWNED: 'A colony already holds this planet.',
  EXPEDITION_EXISTS: 'This ship already has an expedition.',
  EXPEDITION_LIMIT: 'Too many expeditions at once.',
  INVALID_STANCE: 'Pick Cautious, Balanced or Bold.',
  INVALID_EXPEDITION: 'The expedition amounts are not valid.',
  NO_EXPLORERS: 'Send at least one explorer.',
  INSUFFICIENT_COLONISTS: 'The ship does not carry that many colonists.',
  INSUFFICIENT_SECURITY: 'The ship does not carry that much security.',
  INSUFFICIENT_KIT: 'The ship does not carry that much survey kit.',
  NO_SUCH_EXPEDITION: 'There is no such expedition.',
  EXPEDITION_NOT_ACTIVE: 'That expedition is not on the ground.',
  ROUND_IN_PROGRESS: 'The expedition is still out on a round.',
  INVALID_REGION: 'That region does not exist.',
  ALREADY_EXPLORED: 'That region is already explored.',
  NOT_ADJACENT: 'Pick a region next to explored land.',
  INVALID_SPLIT: 'The team cannot split that way.',
  REGION_NOT_EXPLORED: 'Found a colony only in an explored region.',
  INVALID_DISTRICT: 'That district cannot be built here.',
  SPACEPORT_EXISTS: 'This colony already has a Spaceport.',
  DISTRICT_EXISTS: 'That region already has a district.',
  NATIVE_REGION: 'Native ground: claim it first by pushing the natives out.',
  INVALID_TECH: 'That tech does not exist.',
  TECH_KNOWN: 'That tech is already known.',
  TECH_LOCKED: 'Learn its prerequisite tech first.',
  GAME_ENDED: 'The run is over. Start a new game.',
};

/** Player-facing text for any rejection reason (including the worker's NOT_INITIALIZED). */
export function describeReject(reason: string): string {
  const launch = (PROBLEM_TEXT as Record<string, string>)[reason];
  if (launch !== undefined) return `Launch refused: ${launch}`;
  const other = (OTHER_REJECTS as Record<string, string>)[reason];
  if (other !== undefined) return other;
  if (reason === 'NOT_INITIALIZED') return 'The simulation is still starting.';
  if (reason === 'WORKER_FAILED')
    return 'The simulation has stopped after an error. Reload the page.';
  if (reason === 'STALE_WORLD') return 'That game has been replaced. Try again.';
  return 'Command refused.';
}
