import type { RerouteRejectReason, RerouteShipCommand } from '../shared/commands';
import {
  DISTANCE_FP,
  HULL_NAMES,
  SPEED_NAMES,
  distanceFpFromDelta,
  reroutePreview,
  type RerouteOption,
  type ReroutePreview,
} from '../shared/loadout';
import { META_SHIP_COUNT, SHIP_POS_STRIDE, type Snapshot } from '../shared/snapshot';
import {
  createTransitScratch,
  loadSystemGrid,
  rangeRadiusWorld,
  reachableSystems,
  rerouteBlockerOfRow,
  shipHasLiveExpedition,
  rerouteOptionsFor,
  shipFlightOf,
  shipRowOf,
  type TransitScratch,
} from '../shared/transit';
import { isParkedState } from '../shared/planetSnapshot';
import { createCommandGate, type CommandGate } from './commandGate';
import { marginClass, marginCue, surveyLabel } from './missionModel';
import { formatMargin, planetLabel } from './shipListModel';
import { GROUND_HELP_TEXT, groundBlockedPlanet } from './openPlanetModel';

/**
 * Pure model of the reroute panel: which ship is selected, which target system was clicked, the
 * preview numbers (the shared reroutePreview / rerouteOptions, so the shown cost is the applied
 * cost, D-052) and the texts. No DOM.
 */

export interface RerouteSession {
  /** Selected ship entity, or -1. */
  ship: number;
  /** Clicked target system, or -1. */
  system: number;
  /** Planet slot within that system. */
  slot: number;
  gate: CommandGate;
}

export function createRerouteSession(): RerouteSession {
  return { ship: -1, system: -1, slot: 0, gate: createCommandGate() };
}

/** Select a ship (or -1). Clears the target. */
export function selectShip(s: RerouteSession, entity: number): void {
  s.ship = entity;
  s.system = -1;
  s.slot = 0;
}

export type PanelMode = 'none' | 'blocked' | 'pick' | 'preview';

export interface PlanetChoice {
  planet: number;
  slot: number;
  label: string;
  inRange: boolean;
}

export interface ReroutePanelModel {
  mode: PanelMode;
  /** Ring radius in world units (0 when the ship cannot be rerouted). */
  radiusWorld: number;
  /** reachable[system] = 1 when the system has a planet in range. Shared scratch, copy before keeping. */
  reachable: Uint8Array;
  /** Target system for the preview line, or -1. */
  previewSystem: number;
  title: string;
  shipLine: string;
  hint: string;
  target: string;
  planets: PlanetChoice[];
  chosenSlot: number;
  eta: string;
  margin: string;
  marginClass: 'bad' | 'ok' | 'good';
  fuelPenalty: string;
  fuelTrip: string;
  fuelAfter: string;
  unload: string;
  warn: string;
  /** Confirm needs a chosen in-range planet and no send in flight. */
  confirmEnabled: boolean;
  /** The command Confirm would send, or null. */
  command: RerouteShipCommand | null;
  /** Planet the 'Open planet' button opens (a ground expedition blocks the ship), or -1. */
  openPlanet: number;
}

const EMPTY_FLAGS = new Uint8Array(64);

/** Human text for a state that blocks rerouting. */
export function blockerText(reason: RerouteRejectReason): string {
  switch (reason) {
    case 'EVENT_PENDING':
      return 'This ship has an event card waiting. Answer the card first.';
    case 'SHIP_DRIFTING':
      return 'This ship is out of fuel and drifting. It cannot change course.';
    case 'EXPEDITION_ACTIVE':
      return `An expedition is on the ground. ${GROUND_HELP_TEXT}`;
    case 'SHIP_NOT_IN_TRANSIT':
      return 'This ship is not in flight, so it cannot change course.';
    case 'SHIP_LOST':
      return 'This ship is lost.';
    default:
      return 'This ship cannot change course now.';
  }
}

function emptyModel(): ReroutePanelModel {
  return {
    mode: 'none',
    radiusWorld: 0,
    reachable: EMPTY_FLAGS,
    previewSystem: -1,
    title: 'Reroute',
    shipLine: '',
    hint: 'Click a ship to plan a course change.',
    target: '',
    planets: [],
    chosenSlot: 0,
    eta: '-',
    margin: '-',
    marginClass: 'good',
    fuelPenalty: '-',
    fuelTrip: '-',
    fuelAfter: '-',
    unload: '',
    warn: '',
    confirmEnabled: false,
    command: null,
    openPlanet: -1,
  };
}

/** Shared scratch for the model builder; one per panel. */
export interface RerouteScratch {
  transit: TransitScratch;
  reachable: Uint8Array;
}

export function createRerouteScratch(): RerouteScratch {
  return { transit: createTransitScratch(), reachable: new Uint8Array(64) };
}

/**
 * First planet slot of `system` that is in range (the model's best default), else 0. Used when the
 * player clicks a system.
 */
export function defaultSlot(
  snap: Snapshot,
  system: number,
  options: readonly RerouteOption[],
): number {
  const start = snap.systemPlanetStart[system];
  const n = snap.planetCount[system];
  for (let slot = 0; slot < n; slot++) {
    for (const o of options) if (o.planet === start + slot) return slot;
  }
  return 0;
}

/** True when the clicked system holds at least one planet in range for the session's ship. */
export function systemInRange(
  options: readonly RerouteOption[],
  snap: Snapshot,
  system: number,
): boolean {
  for (const o of options) if (snap.planetSystem[o.planet] === system) return true;
  return false;
}

/** The target system was clicked: pick its best planet. Returns false when no ship is selected. */
export function selectTargetSystem(
  s: RerouteSession,
  snap: Snapshot,
  system: number,
  scratch: RerouteScratch,
): boolean {
  if (s.ship < 0) return false;
  const row = shipRowOf(snap, s.ship);
  const options = row >= 0 ? rerouteOptionsFor(snap, row, scratch.transit) : [];
  s.system = system;
  s.slot = system >= 0 ? defaultSlot(snap, system, options) : 0;
  return true;
}

/** Build the whole panel model from a snapshot and the session. Allocates; call on change only. */
export function buildReroutePanelModel(
  snap: Snapshot,
  s: RerouteSession,
  scratch: RerouteScratch,
): ReroutePanelModel {
  const m = emptyModel();
  if (s.ship < 0) return m;
  const row = shipRowOf(snap, s.ship);
  if (row < 0) {
    m.hint = 'That ship is no longer in flight.';
    m.title = `Ship #${s.ship}`;
    m.mode = 'blocked';
    return m;
  }
  const state = snap.shipState[row];
  const hull = snap.shipHull[row];
  m.title = `Reroute ${HULL_NAMES[hull] ?? 'ship'} #${s.ship}`;
  m.shipLine = isParkedState(state)
    ? `${SPEED_NAMES[snap.shipSpeed[row]] ?? ''}, fuel ${snap.shipFuel[row]}, in orbit at ${planetLabel(snap, snap.shipDest[row])}`
    : `${SPEED_NAMES[snap.shipSpeed[row]] ?? ''}, fuel ${snap.shipFuel[row]}, to ${planetLabel(snap, snap.shipDest[row])}, ${snap.shipEta[row]} days left`;

  const blocker = rerouteBlockerOfRow(snap, row);
  if (blocker !== null) {
    m.mode = 'blocked';
    m.hint = blockerText(blocker);
    m.openPlanet = groundBlockedPlanet(snap, row);
    return m;
  }

  const options = rerouteOptionsFor(snap, row, scratch.transit);
  m.radiusWorld = rangeRadiusWorld(snap, row);
  reachableSystems(options, snap.planetSystem, scratch.reachable);
  m.reachable = scratch.reachable;

  if (s.system < 0 || s.system >= snap.planetCount.length) {
    m.mode = 'pick';
    m.hint =
      options.length > 0
        ? `${options.length} planets in range. Click a lit star to see the new course.`
        : 'No planet is in range. The fuel left cannot cover a course change.';
    return m;
  }

  const start = snap.systemPlanetStart[s.system];
  const count = snap.planetCount[s.system];
  m.previewSystem = s.system;
  m.target = `System ${s.system}`;

  // Distance to the clicked system, for the out-of-range explanation.
  loadSystemGrid(snap, scratch.transit);
  const flight = shipFlightOf(snap, row);
  const dist = distanceFpFromDelta(
    scratch.transit.systemXFp[s.system] - flight.xFp,
    scratch.transit.systemYFp[s.system] - flight.yFp,
  );

  const byPlanet = new Map<number, RerouteOption>();
  for (const o of options) byPlanet.set(o.planet, o);
  for (let slot = 0; slot < count; slot++) {
    const p = start + slot;
    const inRange = byPlanet.has(p);
    const own = snap.planetOwned[p] !== 0 ? ', your colony' : '';
    m.planets.push({
      planet: p,
      slot,
      inRange,
      label: `Planet ${slot + 1} (${surveyLabel(snap.planetSurvey[p])}, habitability ${snap.planetHabLo[p]} to ${snap.planetHabHi[p]}%${own})${inRange ? '' : ' - out of range'}`,
    });
  }
  const slot = s.slot >= 0 && s.slot < count ? s.slot : 0;
  m.chosenSlot = slot;
  const planet = start + slot;
  m.mode = 'preview';
  m.hint = '';

  if (planet === snap.shipDest[row]) {
    m.hint = 'The ship is already flying to this planet.';
    return m;
  }
  const option = byPlanet.get(planet);
  const preview: ReroutePreview = option ? option.preview : reroutePreview(dist, flight);
  const fuel = snap.shipFuel[row];
  m.eta = `about ${preview.etaDays} days (now ${snap.shipEta[row]})`;
  m.margin = `about ${preview.supplyMarginPct >= 999 ? '999+' : preview.supplyMarginPct}% ${marginCue(preview.supplyMarginPct)} (now ${formatMargin(snap.shipMargin[row], snap.shipColonists[row], true)})`;
  m.marginClass = marginClass(preview.supplyMarginPct);
  m.fuelPenalty = `${preview.penaltyFuel}`;
  m.fuelTrip = `${preview.tripFuel}`;
  m.fuelAfter = `at least ${Math.max(0, fuel - preview.totalFuel)} of ${fuel}`;
  if (!option) {
    m.warn = `Out of range: this course needs ${preview.totalFuel} fuel and the ship can spend ${flight.fuel}.`;
    return m;
  }
  if (option.unloads) {
    m.unload = 'Your colony is there: colonists, supplies and fuel unload on arrival.';
  }
  if (preview.supplyMarginPct < 100) {
    m.warn = `Warning: supplies cover only ${preview.supplyMarginPct}% of the trip. Colonists will starve.`;
  }
  m.command = { type: 'RerouteShip', ship: s.ship, target: planet };
  m.confirmEnabled = !s.gate.awaiting;
  return m;
}

/** Cheap signature of everything the model depends on for the selected ship, for change guards. */
export const REROUTE_SIG_LENGTH = 14;

export function fillRerouteSig(snap: Snapshot, s: RerouteSession, out: Int32Array): void {
  out.fill(0);
  out[0] = s.ship;
  out[1] = s.system;
  out[2] = s.slot;
  out[3] = s.gate.awaiting ? 1 : 0;
  const row = s.ship >= 0 ? shipRowOf(snap, s.ship) : -1;
  out[4] = row;
  if (row >= 0) {
    out[5] = snap.shipState[row];
    out[6] = snap.shipFuel[row];
    out[7] = snap.shipEta[row];
    out[8] = snap.shipMargin[row];
    out[9] = snap.shipDest[row];
    out[10] = Math.round(snap.shipPos[row * SHIP_POS_STRIDE + 2] * DISTANCE_FP);
    out[11] = Math.round(snap.shipPos[row * SHIP_POS_STRIDE + 3] * DISTANCE_FP);
    out[12] = snap.meta[META_SHIP_COUNT];
    out[13] = shipHasLiveExpedition(snap, snap.shipEntity[row]) ? 1 : 0;
  }
}
