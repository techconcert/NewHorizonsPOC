import type { ResolveEventChoiceCommand } from '../shared/commands';
import {
  CC_COLONISTS,
  CC_DELAY,
  CC_FUEL,
  CC_HULL,
  CC_NATIVE_MOOD,
  CC_REVEAL,
  CC_RISK_COLONISTS,
  CC_RISK_DELAY,
  CC_RISK_FUEL,
  CC_RISK_HULL,
  CC_RISK_MOOD,
  CC_RISK_ODDS,
  CC_RISK_SUPPLIES,
  CC_SPEED_DROP,
  CC_SUPPLIES,
  CHOICE_COST_STRIDE,
  EVENT_BODIES,
  EVENT_CHOICE_COUNT,
  EVENT_CHOICE_LABELS,
  EVENT_CHOICE_PREVIEWS,
  EVENT_CHOICE_SLOTS,
  EVENT_RISK_LABELS,
  EVENT_SCENE,
  EVENT_TITLES,
  SCENE_TRANSIT,
} from '../shared/events';
import { HULL_NAMES, ceilDiv, speedFpPerDay, supplyMarginPct } from '../shared/loadout';
import {
  EXPEDITION_STRIDE,
  META_EVENT_SEQ,
  META_EXPEDITION_COUNT,
  META_PENDING_CARD,
  META_PENDING_COUNT,
  META_PENDING_SHIP,
  type Snapshot,
  X_ENTITY,
  X_EXPLORERS,
  X_PLANET,
  X_SUPPLIES,
  X_WOUNDED,
} from '../shared/snapshot';
import { shipRowOf } from '../shared/transit';
import { formatMargin, formatMarginCue, planetLabel } from './shipListModel';
import { marginClass } from './missionModel';

/**
 * Pure model of the event card (M3b). The numbers come from the snapshot's `eventCosts`, which the
 * worker fills with the shared `choiceCost`, the same function the sim applies: what the card
 * shows before the player commits is exactly what happens (GAME_DESIGN pillar 3). The supply
 * margin after a choice is computed here with the shared LoadoutMath from the ship's own row.
 */

export interface CardChoiceView {
  /** Choice index sent in ResolveEventChoice, and the key (1, 2, 3) that picks it. */
  index: number;
  key: string;
  label: string;
  preview: string;
  /** One line per cost or gain; "No cost" when the choice changes nothing. */
  lines: string[];
  /** Risk line with odds, or ''. */
  risk: string;
  fuelLeft: string;
  /** "118%" and the class for colouring, then the figure if the risk hits ('' when no risk). */
  marginAfter: string;
  marginClass: 'bad' | 'ok' | 'good';
  marginIfRisk: string;
  marginIfRiskClass: 'bad' | 'ok' | 'good';
  /**
   * The two summary lines under the costs, ready to show: fuel and supply margin for a ship in
   * transit, explorers and supplies left for a planetfall card. `marginRiskLine` is '' without a risk.
   */
  fuelLine: string;
  marginLine: string;
  marginRiskLine: string;
}

export interface CardView {
  /** Identity of the card on screen: changes when another card (or the same card for another ship) shows. */
  key: string;
  card: number;
  ship: number;
  title: string;
  body: string;
  shipLine: string;
  /** "Card 1 of 3" when more are queued, else ''. */
  queueLine: string;
  pending: number;
  /** 'planetfall' when the card is about an expedition on the ground (its subject is the expedition). */
  scene: 'transit' | 'planetfall';
  choices: CardChoiceView[];
}

/** Signed amount: "+300", "-12". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Cost lines for the guaranteed part of a choice, from `costs[off ..]`. */
export function costLines(costs: ArrayLike<number>, off: number, planetfall = false): string[] {
  const lines: string[] = [];
  const d = (i: number): number => costs[off + i];
  const people = planetfall ? 'Explorers' : 'Colonists';
  if (d(CC_COLONISTS) !== 0) lines.push(`${people} ${signed(d(CC_COLONISTS))}`);
  if (d(CC_SUPPLIES) !== 0) lines.push(`Supplies ${signed(d(CC_SUPPLIES))}`);
  if (d(CC_FUEL) !== 0) lines.push(`Fuel ${signed(d(CC_FUEL))}`);
  if (d(CC_HULL) !== 0) lines.push(`Hull ${signed(d(CC_HULL))}%`);
  if (d(CC_DELAY) > 0) lines.push(`${d(CC_DELAY)} ${plural(d(CC_DELAY), 'day', 'days')} lost`);
  if (d(CC_SPEED_DROP) > 0) {
    lines.push(`Speed drops ${d(CC_SPEED_DROP)} ${plural(d(CC_SPEED_DROP), 'level', 'levels')}`);
  }
  if (d(CC_REVEAL) > 0) {
    lines.push(planetfall ? 'Explores a nearby region' : 'Scans a nearby planet');
  }
  if (d(CC_NATIVE_MOOD) < 0) lines.push('The natives grow calmer');
  if (d(CC_NATIVE_MOOD) > 0) lines.push('The natives grow angrier');
  if (lines.length === 0) lines.push('No cost');
  return lines;
}

/** The risk of a choice: "25% chance (trap): Hull -20%, Colonists -2", or '' when there is none. */
export function riskLine(
  costs: ArrayLike<number>,
  off: number,
  label: string,
  planetfall = false,
): string {
  const odds = costs[off + CC_RISK_ODDS];
  if (odds <= 0) return '';
  const parts: string[] = [];
  if (costs[off + CC_RISK_COLONISTS] !== 0)
    parts.push(
      `${planetfall ? 'Explorers' : 'Colonists'} ${signed(costs[off + CC_RISK_COLONISTS])}`,
    );
  if (costs[off + CC_RISK_SUPPLIES] !== 0)
    parts.push(`Supplies ${signed(costs[off + CC_RISK_SUPPLIES])}`);
  if (costs[off + CC_RISK_FUEL] !== 0) parts.push(`Fuel ${signed(costs[off + CC_RISK_FUEL])}`);
  if (costs[off + CC_RISK_HULL] !== 0) parts.push(`Hull ${signed(costs[off + CC_RISK_HULL])}%`);
  if (costs[off + CC_RISK_DELAY] > 0) parts.push(`${costs[off + CC_RISK_DELAY]} days lost`);
  if (costs[off + CC_RISK_MOOD] < 0) parts.push('the natives grow calmer');
  if (costs[off + CC_RISK_MOOD] > 0) parts.push('the natives grow angrier');
  const what = label !== '' ? ` (${label})` : '';
  return `${odds}% chance${what}: ${parts.length > 0 ? parts.join(', ') : 'extra trouble'}`;
}

/** Inputs of the margin-after calculation: the ship's own numbers. */
export interface MarginInput {
  hull: number;
  /** Speed setting index (0 Economy, 1 Cruise, 2 Hard Burn). */
  speed: number;
  colonists: number;
  supplies: number;
  /** Days the ship still stands still. */
  delay: number;
  /** Leg distance still to fly, grid units. */
  distanceLeft: number;
}

/**
 * Supply margin in percent after a choice: supplies and colonists change by the choice's deltas,
 * the trip changes by its delay days, and a speed drop slows the rest of the leg (same formula as
 * the snapshot's ETA, so the figure matches the ship's row once the choice is applied).
 * `riskHits` adds the risk branch's deltas and delay on top.
 */
export function marginAfterChoice(
  ship: MarginInput,
  costs: ArrayLike<number>,
  off: number,
  riskHits: boolean,
): number {
  let supplies = ship.supplies + costs[off + CC_SUPPLIES];
  let colonists = ship.colonists + costs[off + CC_COLONISTS];
  let delay = ship.delay + costs[off + CC_DELAY];
  if (riskHits) {
    supplies += costs[off + CC_RISK_SUPPLIES];
    colonists += costs[off + CC_RISK_COLONISTS];
    delay += costs[off + CC_RISK_DELAY];
  }
  if (supplies < 0) supplies = 0;
  if (colonists < 0) colonists = 0;
  const speed = ship.speed - costs[off + CC_SPEED_DROP];
  const flying =
    ship.distanceLeft > 0
      ? ceilDiv(ship.distanceLeft, speedFpPerDay(ship.hull, speed < 0 ? 0 : speed))
      : 0;
  return supplyMarginPct(supplies, colonists, delay + flying);
}

/** The margin inputs of a snapshot ship row. */
export function marginInputOf(snap: Snapshot, row: number): MarginInput {
  return {
    hull: snap.shipHull[row],
    speed: snap.shipSpeed[row],
    colonists: snap.shipColonists[row],
    supplies: snap.shipSupplies[row],
    delay: snap.shipDelay[row],
    distanceLeft: Math.max(0, snap.shipDistance[row] - snap.shipProgress[row]),
  };
}

/** Identity string of the card the snapshot shows, or '' when none is pending. */
export function pendingCardKey(snap: Snapshot): string {
  if (snap.meta[META_PENDING_COUNT] <= 0) return '';
  return `${snap.meta[META_PENDING_CARD]}:${snap.meta[META_PENDING_SHIP]}:${snap.meta[META_EVENT_SEQ]}`;
}

/** Expedition row whose entity is `entity`, or -1. */
function expeditionRowOfEntity(snap: Snapshot, entity: number): number {
  const n = snap.meta[META_EXPEDITION_COUNT];
  for (let i = 0; i < n; i++)
    if (snap.expeditions[i * EXPEDITION_STRIDE + X_ENTITY] === entity) return i;
  return -1;
}

function foodClass(days: number): 'bad' | 'ok' | 'good' {
  return days < 5 ? 'bad' : days < 15 ? 'ok' : 'good';
}

/** Days of food per head for a team (wounded eat too; guards do not, D-080). */
function teamFoodDays(supplies: number, heads: number): number {
  return heads > 0 ? Math.floor(Math.max(0, supplies) / heads) : 0;
}

/** Build the card view for the oldest pending card, or null when none waits. Allocates. */
export function buildCardView(snap: Snapshot): CardView | null {
  const pending = snap.meta[META_PENDING_COUNT];
  const card = snap.meta[META_PENDING_CARD];
  if (pending <= 0 || card < 0) return null;
  const subject = snap.meta[META_PENDING_SHIP];
  const planetfall = EVENT_SCENE[card] !== SCENE_TRANSIT;
  return planetfall
    ? buildPlanetfallCard(snap, card, subject, pending)
    : buildTransitCard(snap, card, subject, pending);
}

function buildPlanetfallCard(
  snap: Snapshot,
  card: number,
  expedition: number,
  pending: number,
): CardView {
  const row = expeditionRowOfEntity(snap, expedition);
  const o = row * EXPEDITION_STRIDE;
  const has = row >= 0;
  const explorers = has ? snap.expeditions[o + X_EXPLORERS] : 0;
  const wounded = has ? snap.expeditions[o + X_WOUNDED] : 0;
  const supplies = has ? snap.expeditions[o + X_SUPPLIES] : 0;
  const choices: CardChoiceView[] = [];
  const n = Math.min(EVENT_CHOICE_COUNT[card], EVENT_CHOICE_SLOTS);
  for (let c = 0; c < n; c++) {
    const off = c * CHOICE_COST_STRIDE;
    const risk = riskLine(
      snap.eventCosts,
      off,
      EVENT_RISK_LABELS[card * EVENT_CHOICE_SLOTS + c],
      true,
    );
    const exAfter = Math.max(0, explorers + snap.eventCosts[off + CC_COLONISTS]);
    const supAfter = Math.max(0, supplies + snap.eventCosts[off + CC_SUPPLIES]);
    const food = teamFoodDays(supAfter, exAfter + wounded);
    const exRisk = Math.max(0, exAfter + snap.eventCosts[off + CC_RISK_COLONISTS]);
    const supRisk = Math.max(0, supAfter + snap.eventCosts[off + CC_RISK_SUPPLIES]);
    const foodRisk = teamFoodDays(supRisk, exRisk + wounded);
    const hasRisk = risk !== '';
    choices.push({
      index: c,
      key: String(c + 1),
      label: EVENT_CHOICE_LABELS[card * EVENT_CHOICE_SLOTS + c],
      preview: EVENT_CHOICE_PREVIEWS[card * EVENT_CHOICE_SLOTS + c],
      lines: costLines(snap.eventCosts, off, true),
      risk,
      fuelLeft: '-',
      marginAfter: '-',
      marginClass: foodClass(food),
      marginIfRisk: hasRisk ? `${foodRisk} days of food per head` : '',
      marginIfRiskClass: foodClass(foodRisk),
      fuelLine: `Explorers after: ${exAfter}${wounded > 0 ? ` (${wounded} wounded)` : ''}`,
      marginLine: `Supplies after: ${supAfter} (${food} days of food per head, ${foodCue(food)})`,
      marginRiskLine: hasRisk
        ? `If the risk hits: ${exRisk} explorers, ${supRisk} supplies (${foodRisk} days of food per head)`
        : '',
    });
  }
  return {
    key: pendingCardKey(snap),
    card,
    ship: expedition,
    title: EVENT_TITLES[card],
    body: EVENT_BODIES[card],
    shipLine: has
      ? `Expedition on ${planetLabel(snap, snap.expeditions[o + X_PLANET])}: ${explorers} explorers${wounded > 0 ? `, ${wounded} wounded` : ''}, ${supplies} supplies`
      : `Expedition #${expedition}`,
    queueLine: pending > 1 ? `Card 1 of ${pending} waiting` : '',
    pending,
    scene: 'planetfall',
    choices,
  };
}

/** Text cue for days of food per head on the ground. */
function foodCue(days: number): 'LOW' | 'OK' | 'SAFE' {
  const c = foodClass(days);
  return c === 'bad' ? 'LOW' : c === 'ok' ? 'OK' : 'SAFE';
}

function buildTransitCard(snap: Snapshot, card: number, ship: number, pending: number): CardView {
  const row = shipRowOf(snap, ship);
  const hasRow = row >= 0;
  const input: MarginInput | null = hasRow ? marginInputOf(snap, row) : null;
  const nowMargin = hasRow ? snap.shipMargin[row] : 0;
  const choices: CardChoiceView[] = [];
  const n = Math.min(EVENT_CHOICE_COUNT[card], EVENT_CHOICE_SLOTS);
  for (let c = 0; c < n; c++) {
    const off = c * CHOICE_COST_STRIDE;
    const risk = riskLine(snap.eventCosts, off, EVENT_RISK_LABELS[card * EVENT_CHOICE_SLOTS + c]);
    const after = input ? marginAfterChoice(input, snap.eventCosts, off, false) : 0;
    const afterRisk =
      input && risk !== '' ? marginAfterChoice(input, snap.eventCosts, off, true) : 0;
    const colonistsAfter = input
      ? Math.max(0, input.colonists + snap.eventCosts[off + CC_COLONISTS])
      : 0;
    const fuelLeft = hasRow
      ? `${Math.max(0, snap.shipFuel[row] + snap.eventCosts[off + CC_FUEL])}`
      : '-';
    const marginAfter = hasRow
      ? `${formatMarginCue(after, colonistsAfter, true)} (now ${formatMargin(nowMargin, input ? input.colonists : 0, true)})`
      : '-';
    const marginIfRisk =
      risk !== '' ? formatMarginCue(afterRisk, input ? input.colonists : 0, true) : '';
    choices.push({
      index: c,
      key: String(c + 1),
      label: EVENT_CHOICE_LABELS[card * EVENT_CHOICE_SLOTS + c],
      preview: EVENT_CHOICE_PREVIEWS[card * EVENT_CHOICE_SLOTS + c],
      lines: costLines(snap.eventCosts, off),
      risk,
      fuelLeft,
      marginAfter,
      marginClass: marginClass(after),
      marginIfRisk,
      marginIfRiskClass: marginClass(afterRisk),
      fuelLine: `Fuel left: ${fuelLeft}`,
      marginLine: `Supply margin after: ${marginAfter}`,
      marginRiskLine: marginIfRisk !== '' ? `If the risk hits: ${marginIfRisk}` : '',
    });
  }
  return {
    key: pendingCardKey(snap),
    card,
    ship,
    title: EVENT_TITLES[card],
    body: EVENT_BODIES[card],
    shipLine: hasRow
      ? `${HULL_NAMES[snap.shipHull[row]] ?? 'Ship'} #${ship}, heading to ${planetLabel(snap, snap.shipDest[row])}`
      : `Ship #${ship}`,
    queueLine: pending > 1 ? `Card 1 of ${pending} waiting` : '',
    pending,
    scene: 'transit',
    choices,
  };
}

/** The command for choice `index` of the card on screen. Slot 0 is always the card shown. */
export function choiceCommand(view: CardView, index: number): ResolveEventChoiceCommand | null {
  if (index < 0 || index >= view.choices.length) return null;
  return { type: 'ResolveEventChoice', card: 0, choice: index, ship: view.ship };
}

/** Map a pressed key to a choice index (1 to 3), or -1. */
export function choiceForKey(key: string, choiceCount: number): number {
  const i = key.length === 1 ? key.charCodeAt(0) - 49 : -1;
  return i >= 0 && i < choiceCount && i < EVENT_CHOICE_SLOTS ? i : -1;
}
