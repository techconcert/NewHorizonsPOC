import { EVENTS, PLANETFALL, TERRAINS, type AmountDef, type EffectsDef } from '../data';
import { ceilDiv, detourFuel } from './loadout';

/**
 * Event card tables for the sim (rolls, effects) and the UI (text, cost preview), compiled once
 * from src/data/events.json. One pure function, `choiceCost`, produces the numbers a choice shows
 * before commit AND the numbers the sim applies, so the two cannot disagree (GAME_DESIGN pillar 3).
 */

export const EVENT_CARD_COUNT = EVENTS.length;
/** Choices per card slot in the tables (the complexity budget: at most 3). */
export const EVENT_CHOICE_SLOTS = 3;

export const EVENT_IDS: readonly string[] = EVENTS.map((c) => c.id);
export const EVENT_TITLES: readonly string[] = EVENTS.map((c) => c.title);
export const EVENT_BODIES: readonly string[] = EVENTS.map((c) => c.body);

/** Number of choices per card (2 or 3). */
export const EVENT_CHOICE_COUNT: Uint8Array = Uint8Array.from(EVENTS, (c) => c.choices.length);
export const EVENT_WEIGHT: Int32Array = Int32Array.from(EVENTS, (c) => c.weight);
export const EVENT_COOLDOWN: Int32Array = Int32Array.from(EVENTS, (c) => c.cooldownDays);
/** 1 when the card can fire for a ship in transit (scene Transit, ship state Cruising). */
export const EVENT_IS_TRANSIT: Uint8Array = Uint8Array.from(EVENTS, (c) =>
  c.scenes.includes('Transit') && c.trigger.shipState === 'Cruising' ? 1 : 0,
);

/** Scene of each card: 0 Transit, 1 Exploration, 2 NativeContact (M4; one scene per card). */
export const SCENE_TRANSIT = 0;
export const SCENE_EXPLORATION = 1;
export const SCENE_NATIVE_CONTACT = 2;
export const EVENT_SCENE: Uint8Array = Uint8Array.from(EVENTS, (c) =>
  c.scenes.includes('Transit')
    ? SCENE_TRANSIT
    : c.scenes.includes('Exploration')
      ? SCENE_EXPLORATION
      : SCENE_NATIVE_CONTACT,
);
/** Terrain id a planetfall card is limited to, or -1 for any (terrain.json order). */
export const EVENT_TRIGGER_TERRAIN: Int8Array = Int8Array.from(EVENTS, (c) =>
  c.trigger.terrain === undefined ? -1 : TERRAINS.findIndex((t) => t.name === c.trigger.terrain),
);
/** Native disposition a contact card is for (1 Peaceful, 2 Wary, 3 Hostile), or 0. */
export const EVENT_TRIGGER_NATIVE: Uint8Array = Uint8Array.from(EVENTS, (c) =>
  c.trigger.native === 'Peaceful'
    ? 1
    : c.trigger.native === 'Wary'
      ? 2
      : c.trigger.native === 'Hostile'
        ? 3
        : 0,
);

/** Native variant (1-based, planetfall.json natives.variants) a contact card is for, or 0 for any. */
export const EVENT_TRIGGER_VARIANT: Uint8Array = Uint8Array.from(EVENTS, (c) =>
  c.trigger.variant === undefined
    ? 0
    : PLANETFALL.natives.variants.findIndex((v) => v.id === c.trigger.variant) + 1,
);

/** Text lookups, index = card * EVENT_CHOICE_SLOTS + choice. */
export const EVENT_CHOICE_LABELS: readonly string[] = flatChoices((ch) => ch.label);
export const EVENT_CHOICE_PREVIEWS: readonly string[] = flatChoices((ch) => ch.preview);
export const EVENT_RISK_LABELS: readonly string[] = flatChoices((ch) => ch.risk?.label ?? '');

function flatChoices(f: (ch: (typeof EVENTS)[number]['choices'][number]) => string): string[] {
  const out: string[] = new Array<string>(EVENTS.length * EVENT_CHOICE_SLOTS).fill('');
  EVENTS.forEach((c, i) =>
    c.choices.forEach((ch, k) => {
      out[i * EVENT_CHOICE_SLOTS + k] = f(ch);
    }),
  );
  return out;
}

// ---- Outcome table: per (card, choice, branch) 11 integers ------------------------------------

const O_COLONISTS_FLAT = 0;
const O_COLONISTS_PCT = 1;
const O_SUPPLIES_FLAT = 2;
const O_SUPPLIES_PCT = 3;
const O_FUEL_FLAT = 4;
const O_FUEL_PCT = 5;
const O_HULL = 6;
const O_DELAY = 7;
const O_DETOUR = 8;
const O_SPEED_DROP = 9;
/** Transit: scan a planet (revealPlanet). Planetfall: explore a frontier region (revealRegion). */
const O_REVEAL = 10;
const O_MOOD = 11;
const OUTCOME_STRIDE = 12;

/** branch 0 = the choice itself, branch 1 = its risk. */
const OUTCOMES = new Int32Array(EVENTS.length * EVENT_CHOICE_SLOTS * 2 * OUTCOME_STRIDE);
/** Risk odds in percent per (card, choice); 0 when the choice has no risk. */
export const EVENT_RISK_ODDS: Uint8Array = new Uint8Array(EVENTS.length * EVENT_CHOICE_SLOTS);
/** Odds points a risk gains per guard in the expedition (signed), per (card, choice). */
export const EVENT_RISK_SECURITY: Int8Array = new Int8Array(EVENTS.length * EVENT_CHOICE_SLOTS);

function amount(a: AmountDef | undefined, flatAt: number, pctAt: number, base: number): void {
  if (!a) return;
  OUTCOMES[base + flatAt] = a.flat ?? 0;
  OUTCOMES[base + pctAt] = a.pct ?? 0;
}

function writeOutcomes(fx: EffectsDef, base: number): void {
  amount(fx.colonists, O_COLONISTS_FLAT, O_COLONISTS_PCT, base);
  amount(fx.supplies, O_SUPPLIES_FLAT, O_SUPPLIES_PCT, base);
  amount(fx.fuel, O_FUEL_FLAT, O_FUEL_PCT, base);
  OUTCOMES[base + O_HULL] = fx.hullPct ?? 0;
  OUTCOMES[base + O_DELAY] = fx.delayDays ?? 0;
  OUTCOMES[base + O_DETOUR] = fx.detourDays ?? 0;
  OUTCOMES[base + O_SPEED_DROP] = fx.speedDrop ?? 0;
  OUTCOMES[base + O_REVEAL] = fx.revealPlanet ?? fx.revealRegion ?? 0;
  OUTCOMES[base + O_MOOD] = fx.nativeMood ?? 0;
}

EVENTS.forEach((card, c) => {
  card.choices.forEach((ch, k) => {
    const slot = c * EVENT_CHOICE_SLOTS + k;
    writeOutcomes(ch.outcomes, slot * 2 * OUTCOME_STRIDE);
    if (ch.risk) {
      EVENT_RISK_ODDS[slot] = ch.risk.oddsPct;
      EVENT_RISK_SECURITY[slot] = ch.risk.securityOddsPerGuard ?? 0;
      writeOutcomes(ch.risk.outcomes, (slot * 2 + 1) * OUTCOME_STRIDE);
    }
  });
});

// ---- Choice cost layout (Int32 values per choice, also the snapshot layout) ----------------------

/** Deltas the choice applies (negative = cost). Resource deltas are already clamped at zero. */
export const CC_COLONISTS = 0;
export const CC_SUPPLIES = 1;
/** Includes the fuel a detour burns. */
export const CC_FUEL = 2;
/** Hull integrity points (percent of a new hull). */
export const CC_HULL = 3;
/** Days the ship stands still (delay plus detour days). */
export const CC_DELAY = 4;
/** Speed levels lost (already limited to the levels the ship has). */
export const CC_SPEED_DROP = 5;
/** 1 when a nearby planet is scanned. */
export const CC_REVEAL = 6;
/** Percent chance of the risk, 0 when none. */
export const CC_RISK_ODDS = 7;
/** Extra deltas applied only when the risk hits. */
export const CC_RISK_COLONISTS = 8;
export const CC_RISK_SUPPLIES = 9;
export const CC_RISK_FUEL = 10;
export const CC_RISK_HULL = 11;
export const CC_RISK_DELAY = 12;
/** Planetfall: -1 the natives grow calmer, 1 angrier (0 none); only when the choice itself is taken. */
export const CC_NATIVE_MOOD = 13;
/** The same, applied only when the risk hits. */
export const CC_RISK_MOOD = 14;
export const CHOICE_COST_STRIDE = 15;

/** Change of a resource: flat amount plus a percent of what is held; losses round up, gains down. */
function amountDelta(value: number, flat: number, pct: number): number {
  let d = flat;
  if (pct < 0) d -= ceilDiv(value * -pct, 100);
  else if (pct > 0) d += Math.floor((value * pct) / 100);
  return d < -value ? -value : d;
}

/**
 * Fill `out[off .. off + CHOICE_COST_STRIDE)` with the cost of `choice` of `card` for a ship
 * holding the given values. Pure integer math, no allocation. The sim applies exactly these
 * numbers, and the UI shows them before the player commits.
 */
export function choiceCost(
  card: number,
  choice: number,
  colonists: number,
  supplies: number,
  fuel: number,
  hull: number,
  speed: number,
  out: Int32Array,
  off: number,
): void {
  const slot = card * EVENT_CHOICE_SLOTS + choice;
  const b = slot * 2 * OUTCOME_STRIDE;
  const r = b + OUTCOME_STRIDE;

  const dFuelBase = amountDelta(fuel, OUTCOMES[b + O_FUEL_FLAT], OUTCOMES[b + O_FUEL_PCT]);
  const detourDays = OUTCOMES[b + O_DETOUR];
  let detourBurn = 0;
  if (detourDays > 0) {
    detourBurn = detourFuel(detourDays, hull, speed);
    const left = fuel + dFuelBase;
    if (detourBurn > left) detourBurn = left < 0 ? 0 : left;
  }
  const drop = OUTCOMES[b + O_SPEED_DROP];

  out[off + CC_COLONISTS] = amountDelta(
    colonists,
    OUTCOMES[b + O_COLONISTS_FLAT],
    OUTCOMES[b + O_COLONISTS_PCT],
  );
  out[off + CC_SUPPLIES] = amountDelta(
    supplies,
    OUTCOMES[b + O_SUPPLIES_FLAT],
    OUTCOMES[b + O_SUPPLIES_PCT],
  );
  out[off + CC_FUEL] = dFuelBase - detourBurn;
  out[off + CC_HULL] = OUTCOMES[b + O_HULL];
  out[off + CC_DELAY] = OUTCOMES[b + O_DELAY] + detourDays;
  out[off + CC_SPEED_DROP] = drop > speed ? speed : drop;
  out[off + CC_REVEAL] = OUTCOMES[b + O_REVEAL];

  out[off + CC_RISK_ODDS] = EVENT_RISK_ODDS[slot];
  out[off + CC_RISK_COLONISTS] = amountDelta(
    colonists,
    OUTCOMES[r + O_COLONISTS_FLAT],
    OUTCOMES[r + O_COLONISTS_PCT],
  );
  out[off + CC_RISK_SUPPLIES] = amountDelta(
    supplies,
    OUTCOMES[r + O_SUPPLIES_FLAT],
    OUTCOMES[r + O_SUPPLIES_PCT],
  );
  out[off + CC_RISK_FUEL] = amountDelta(fuel, OUTCOMES[r + O_FUEL_FLAT], OUTCOMES[r + O_FUEL_PCT]);
  out[off + CC_RISK_HULL] = OUTCOMES[r + O_HULL];
  out[off + CC_RISK_DELAY] = OUTCOMES[r + O_DELAY];
  out[off + CC_NATIVE_MOOD] = OUTCOMES[b + O_MOOD];
  out[off + CC_RISK_MOOD] = OUTCOMES[r + O_MOOD];
}

/**
 * Cost of a planetfall card choice for an expedition: `explorers` stand in for colonists, the
 * expedition `supplies` for supplies (no fuel or hull). A risk with a security tilt gains its
 * signed odds points per guard, kept within 1..99. The sim applies exactly these numbers and the
 * snapshot carries them, so the card shows what it will do.
 */
export function expeditionChoiceCost(
  card: number,
  choice: number,
  explorers: number,
  supplies: number,
  guards: number,
  out: Int32Array,
  off: number,
): void {
  choiceCost(card, choice, explorers, supplies, 0, 0, 0, out, off);
  const slot = card * EVENT_CHOICE_SLOTS + choice;
  const tilt = EVENT_RISK_SECURITY[slot];
  const odds = out[off + CC_RISK_ODDS];
  if (odds > 0 && tilt !== 0) {
    const tilted = odds + tilt * guards;
    out[off + CC_RISK_ODDS] = tilted < 1 ? 1 : tilted > 99 ? 99 : tilted;
  }
}
