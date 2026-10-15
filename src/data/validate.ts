import {
  COLONY_STANCE_COUNT,
  DISTRICT_TYPE_COUNT,
  MAX_EVENT_DEFS,
  MAX_TECHS,
  TECH_BRANCH_COUNT,
  MAX_CARD_BODY_WORDS,
  MAX_CARD_LABEL_WORDS,
  MAX_CARD_PREVIEW_WORDS,
  MAX_EVENT_CHOICES,
  MAX_LOADOUT_DIALS,
  MAX_RESOURCES,
  MIN_EVENT_CHOICES,
  TERRAIN_COUNT,
} from './limits';

/** Hand-written validators. Each returns a list of error strings; empty means valid. */

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function posNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function str(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0;
}

function sumOf(a: unknown[]): number {
  let s = 0;
  for (const x of a) s += typeof x === 'number' ? x : NaN;
  return s;
}

function allNonNegNums(a: unknown[]): boolean {
  return a.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
}

function uniqueIds(items: Rec[], where: string, errs: string[]): void {
  const seen = new Set<string>();
  for (const it of items) {
    const id = String(it.id);
    if (seen.has(id)) errs.push(`${where}: duplicate id "${id}"`);
    seen.add(id);
  }
}

function listOf(root: unknown, key: string, where: string, errs: string[]): Rec[] {
  if (!isRec(root) || !Array.isArray(root[key])) {
    errs.push(`${where}: missing array "${key}"`);
    return [];
  }
  const out: Rec[] = [];
  for (const it of root[key] as unknown[]) {
    if (isRec(it)) out.push(it);
    else errs.push(`${where}: entry is not an object`);
  }
  return out;
}

export function validateHulls(root: unknown): string[] {
  const errs: string[] = [];
  const hulls = listOf(root, 'hulls', 'hulls', errs);
  if (hulls.length !== 3) errs.push(`hulls: expected 3 hull classes, got ${hulls.length}`);
  uniqueIds(hulls, 'hulls', errs);
  // Cargo capacity must grow with hull class (Scout < Ark < Heavy Ark).
  const caps = hulls.map((h) => h.cargoCapacity);
  for (let i = 1; i < caps.length; i++) {
    const prev = caps[i - 1];
    const cur = caps[i];
    if (!(typeof prev === 'number' && typeof cur === 'number' && cur > prev)) {
      errs.push('hulls: cargoCapacity must increase with hull class');
      break;
    }
  }
  for (const h of hulls) {
    const id = String(h.id);
    if (!str(h.id) || !str(h.name)) errs.push(`hulls: "${id}" needs id and name`);
    for (const f of ['cargoCapacity', 'baseSpeed', 'hullRating', 'productionCost']) {
      if (!posNum(h[f])) errs.push(`hulls: "${id}".${f} must be a positive number`);
      else if (!Number.isInteger(h[f])) errs.push(`hulls: "${id}".${f} must be an integer`);
    }
  }
  return errs;
}

export function validateSpeeds(root: unknown): string[] {
  const errs: string[] = [];
  const speeds = listOf(root, 'speeds', 'speeds', errs);
  if (speeds.length !== 3) errs.push(`speeds: expected 3 speed settings, got ${speeds.length}`);
  uniqueIds(speeds, 'speeds', errs);
  for (const s of speeds) {
    const id = String(s.id);
    if (!str(s.id) || !str(s.name)) errs.push(`speeds: "${id}" needs id and name`);
    if (!posNum(s.fuelMult)) errs.push(`speeds: "${id}".fuelMult must be positive`);
    if (!posNum(s.etaMult)) errs.push(`speeds: "${id}".etaMult must be positive`);
  }
  const fuel = speeds.map((s) => s.fuelMult);
  if (fuel.length === 3 && (fuel[0] !== 1 || fuel[1] !== 1.5 || fuel[2] !== 2.5)) {
    errs.push('speeds: fuelMult must be 1, 1.5, 2.5 (Economy, Cruise, Hard Burn; design)');
  }
  return errs;
}

const HAZARDS = ['Low', 'Medium', 'High', 'Variable'];
/** Flavour lines are short (terrain and native variants). */
const MAX_FLAVOUR_WORDS = 20;
/** Smallest mystery share a terrain's find table may have (it feeds the planetfall cards). */
const MIN_MYSTERY_PCT = 5;

export function validateTerrain(root: unknown): string[] {
  const errs: string[] = [];
  const terrains = listOf(root, 'terrains', 'terrain', errs);
  const kinds = isRec(root) && Array.isArray(root.findKinds) ? (root.findKinds as unknown[]) : [];
  if (kinds.length === 0 || !kinds.every(str))
    errs.push('terrain: findKinds must be non-empty strings');
  if (new Set(kinds).size !== kinds.length) errs.push('terrain: duplicate findKinds');
  if (terrains.length !== TERRAIN_COUNT) {
    errs.push(`terrain: expected ${TERRAIN_COUNT} terrains, got ${terrains.length}`);
  }
  uniqueIds(terrains, 'terrain', errs);
  for (const t of terrains) {
    const id = String(t.id);
    if (!str(t.id) || !str(t.name)) errs.push(`terrain: "${id}" needs id and name`);
    if (!HAZARDS.includes(String(t.hazard)))
      errs.push(`terrain: "${id}".hazard must be one of ${HAZARDS.join('/')}`);
    if (!str(t.flavour) || wordCount(t.flavour) > MAX_FLAVOUR_WORDS)
      errs.push(`terrain: "${id}".flavour must be a line of at most ${MAX_FLAVOUR_WORDS} words`);
    const finds = Array.isArray(t.finds) ? (t.finds as unknown[]) : null;
    if (!finds) {
      errs.push(`terrain: "${id}".finds must be an array`);
      continue;
    }
    // Every terrain feeds the mystery cards, so its table must hold a mystery share (M7a).
    const mystery = kinds.indexOf('mystery');
    if (mystery < 0) errs.push('terrain: findKinds must include "mystery"');
    else if (typeof finds[mystery] !== 'number' || (finds[mystery] as number) < MIN_MYSTERY_PCT)
      errs.push(`terrain: "${id}" needs a mystery share of at least ${MIN_MYSTERY_PCT}`);
    if (finds.length !== kinds.length)
      errs.push(`terrain: "${id}".finds length must equal findKinds length`);
    if (!allNonNegNums(finds)) errs.push(`terrain: "${id}".finds must be non-negative numbers`);
    else if (sumOf(finds) !== 100)
      errs.push(`terrain: "${id}".finds sum to ${sumOf(finds)}, expected 100`);
  }
  // No two terrains share a find table (M7a): each one has its own character.
  const tables = terrains.map((t) => JSON.stringify(t.finds));
  if (new Set(tables).size !== tables.length)
    errs.push('terrain: every terrain needs its own find table (two are identical)');
  return errs;
}

export function validatePlanetTypes(root: unknown): string[] {
  const errs: string[] = [];
  const types = listOf(root, 'planetTypes', 'planetTypes', errs);
  if (types.length === 0) errs.push('planetTypes: at least one planet type required');
  uniqueIds(types, 'planetTypes', errs);
  for (const t of types) {
    const id = String(t.id);
    const w = Array.isArray(t.terrainWeights) ? (t.terrainWeights as unknown[]) : null;
    if (!w || w.length !== TERRAIN_COUNT) {
      errs.push(`planetTypes: "${id}".terrainWeights must have ${TERRAIN_COUNT} entries`);
    } else if (!allNonNegNums(w) || sumOf(w) !== 100) {
      errs.push(`planetTypes: "${id}".terrainWeights must be non-negative and sum to 100`);
    }
  }
  return errs;
}

/** An event card has 2 to 3 choices (D-015). */
export function validateEventCard(card: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(card) || !str(card.id)) return ['eventCard: needs an id'];
  const id = String(card.id);
  if (!Array.isArray(card.choices)) return [`eventCard "${id}": choices must be an array`];
  const n = card.choices.length;
  if (n > MAX_EVENT_CHOICES) errs.push(`eventCard "${id}": ${n} choices, max ${MAX_EVENT_CHOICES}`);
  if (n < MIN_EVENT_CHOICES) errs.push(`eventCard "${id}": ${n} choices, min ${MIN_EVENT_CHOICES}`);
  return errs;
}

/** A loadout screen has at most 6 dials (D-006, D-015). */
export function validateLoadoutDials(dials: unknown): string[] {
  if (!Array.isArray(dials)) return ['loadout: dials must be an array'];
  return dials.length > MAX_LOADOUT_DIALS
    ? [`loadout: ${dials.length} dials, max ${MAX_LOADOUT_DIALS}`]
    : [];
}

/** The game has at most 4 resources (D-015). */
export function validateResourceList(resources: unknown): string[] {
  if (!Array.isArray(resources)) return ['resources: must be an array'];
  return resources.length > MAX_RESOURCES
    ? [`resources: ${resources.length} resources, max ${MAX_RESOURCES}`]
    : [];
}

const CARGO_DIAL_IDS = ['passengers', 'supplies', 'fuel', 'kit', 'security'];

/** Loadout tables: the five cargo dials (speed is the sixth dial, see speeds.json) and odds inputs. */
export function validateLoadoutConfig(root: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(root)) return ['loadout: must be an object'];
  const dials = listOf(root, 'cargoDials', 'loadout', errs);
  // Five cargo dials plus the speed selector is the six-dial limit (D-006, D-015).
  if (dials.length + 1 > MAX_LOADOUT_DIALS)
    errs.push(`loadout: too many dials, max ${MAX_LOADOUT_DIALS}`);
  if (dials.map((d) => d.id).join() !== CARGO_DIAL_IDS.join()) {
    errs.push(`loadout: cargoDials ids must be ${CARGO_DIAL_IDS.join(', ')} in that order`);
  }
  uniqueIds(dials, 'loadout', errs);
  const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  for (const d of dials) {
    const id = String(d.id);
    if (!str(d.name)) errs.push(`loadout: "${id}" needs a name`);
    if (!isInt(d.cargoPerStep) || d.cargoPerStep < 1)
      errs.push(`loadout: "${id}".cargoPerStep must be an integer >= 1`);
    if (!isInt(d.amountPerStep) || d.amountPerStep < 1)
      errs.push(`loadout: "${id}".amountPerStep must be an integer >= 1`);
    if (!isInt(d.productionPerStep) || d.productionPerStep < 0)
      errs.push(`loadout: "${id}".productionPerStep must be an integer >= 0`);
  }
  if (!isInt(root.burnPerUnitX100) || root.burnPerUnitX100 < 1)
    errs.push('loadout: burnPerUnitX100 must be an integer >= 1');
  if (!isInt(root.supplyMarginCapPct) || root.supplyMarginCapPct < 100)
    errs.push('loadout: supplyMarginCapPct must be an integer >= 100');
  const f = root.founding;
  if (!isRec(f)) return [...errs, 'loadout: founding must be an object'];
  const bands = Array.isArray(f.siteQualityBands) ? (f.siteQualityBands as unknown[]) : [];
  if (bands.length !== 4)
    errs.push('loadout: founding.siteQualityBands needs 4 bands (one per survey level)');
  let prevLo = 0;
  let prevHi = 100;
  for (const b of bands) {
    const ok =
      Array.isArray(b) &&
      b.length === 2 &&
      isInt(b[0]) &&
      isInt(b[1]) &&
      b[0] >= 0 &&
      b[0] <= b[1] &&
      b[1] <= 100;
    if (!ok) {
      errs.push(
        'loadout: each site quality band must be [lo, hi] integers with 0 <= lo <= hi <= 100',
      );
      break;
    }
    const [lo, hi] = b as number[];
    // Founding odds narrow as survey data improves: bands may only shrink.
    if (lo < prevLo || hi > prevHi)
      errs.push('loadout: site quality bands must narrow with survey level');
    prevLo = lo;
    prevHi = hi;
  }
  if (!isInt(f.delayAllowancePct) || f.delayAllowancePct < 0)
    errs.push('loadout: founding.delayAllowancePct must be an integer >= 0');
  if (!isInt(f.kitBasePct) || f.kitBasePct < 0 || f.kitBasePct > 100)
    errs.push('loadout: founding.kitBasePct must be 0..100');
  if (!isInt(f.kitSaturationSteps) || f.kitSaturationSteps < 1)
    errs.push('loadout: founding.kitSaturationSteps must be an integer >= 1');
  return errs;
}

const SCENES = ['Transit', 'Exploration', 'NativeContact', 'Colony'];
const SHIP_STATES = ['Cruising'];
const TERRAIN_NAMES = ['Plains', 'Highlands', 'Jungle', 'Ice', 'Crater', 'Ruins'];
const NATIVE_NAMES = ['Peaceful', 'Wary', 'Hostile'];
/** Effects only a card in the Transit scene may use, and only planetfall cards may use. */
const TRANSIT_ONLY_EFFECTS = ['fuel', 'hullPct', 'detourDays', 'speedDrop', 'revealPlanet'];
const PLANETFALL_ONLY_EFFECTS = ['revealRegion', 'nativeMood'];
/** The only keys an effect may use: the resources (colonists, supplies, fuel) and ship fields. */
const RESOURCE_KEYS = ['colonists', 'supplies', 'fuel'];
const OTHER_EFFECT_KEYS = [
  'hullPct',
  'delayDays',
  'detourDays',
  'speedDrop',
  'revealPlanet',
  'revealRegion',
  'nativeMood',
];

function wordCount(v: unknown): number {
  return typeof v === 'string' ? v.trim().split(/\s+/).filter(Boolean).length : 0;
}

function intIn(v: unknown, lo: number, hi: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * One effects object: only colonists / supplies / fuel as {flat} or {pct}, plus hull, delay,
 * detour, speed drop and reveal. A fifth resource (or any unknown key) is rejected: the game has
 * at most 4 resources (D-015; production is a colony resource and never appears in transit).
 */
export function validateEffects(fx: unknown, where: string): string[] {
  const errs: string[] = [];
  if (!isRec(fx)) return [`${where}: effects must be an object`];
  for (const key of Object.keys(fx)) {
    if (RESOURCE_KEYS.includes(key)) {
      const a = fx[key];
      if (!isRec(a)) {
        errs.push(`${where}: ${key} must be {flat} or {pct}`);
        continue;
      }
      const keys = Object.keys(a);
      const ok = keys.length === 1 && (keys[0] === 'flat' || keys[0] === 'pct');
      if (!ok) errs.push(`${where}: ${key} needs exactly one of flat or pct`);
      else if (!intIn(a[keys[0] as string], -100000, 100000))
        errs.push(`${where}: ${key}.${keys[0]} must be an integer`);
      else if (keys[0] === 'pct' && !intIn(a.pct, -100, 100))
        errs.push(`${where}: ${key}.pct must be -100..100`);
    } else if (OTHER_EFFECT_KEYS.includes(key)) {
      const v = fx[key];
      const ok =
        key === 'hullPct'
          ? intIn(v, -100, 100)
          : key === 'speedDrop'
            ? intIn(v, 0, 2)
            : key === 'revealPlanet' || key === 'revealRegion'
              ? intIn(v, 0, 1)
              : key === 'nativeMood'
                ? intIn(v, -1, 1)
                : intIn(v, 0, 30);
      if (!ok) errs.push(`${where}: ${key} is out of range`);
    } else {
      errs.push(
        `${where}: unknown effect "${key}" (resources are limited to colonists, supplies, fuel; max ${MAX_RESOURCES})`,
      );
    }
  }
  return errs;
}

/** A transit card never uses planetfall effects, and a planetfall card never uses ship effects. */
function sceneEffectProblems(fx: unknown, isTransit: boolean, where: string): string[] {
  if (!isRec(fx)) return [];
  const banned = isTransit ? PLANETFALL_ONLY_EFFECTS : TRANSIT_ONLY_EFFECTS;
  const errs: string[] = [];
  for (const k of banned) {
    if (k in fx)
      errs.push(
        `${where}: "${k}" is not allowed on a ${isTransit ? 'Transit' : 'planetfall'} card`,
      );
  }
  return errs;
}

/** Full event card check: choices 2..3 (validateEventCard) plus the content-guide fields and rules. */
export function validateEventCardFull(card: unknown): string[] {
  const errs = validateEventCard(card);
  if (!isRec(card)) return errs;
  const id = String(card.id);
  const w = `eventCard "${id}"`;
  if (!/^[a-z][a-z0-9_]*$/.test(id)) errs.push(`${w}: id must be snake_case`);
  const scenes = Array.isArray(card.scenes) ? (card.scenes as unknown[]) : [];
  if (scenes.length === 0 || !scenes.every((s) => typeof s === 'string' && SCENES.includes(s)))
    errs.push(`${w}: scenes must be a non-empty list of ${SCENES.join('/')}`);
  const trig = card.trigger;
  const sceneList = scenes as string[];
  const isTransit = sceneList.includes('Transit');
  if (!isRec(trig)) errs.push(`${w}: trigger must be an object`);
  else {
    for (const k of Object.keys(trig)) {
      if (k === 'shipState') {
        if (!SHIP_STATES.includes(String(trig[k])))
          errs.push(`${w}: trigger.shipState must be one of ${SHIP_STATES.join('/')}`);
      } else if (k === 'terrain') {
        if (!TERRAIN_NAMES.includes(String(trig[k])))
          errs.push(`${w}: trigger.terrain must be one of ${TERRAIN_NAMES.join('/')}`);
      } else if (k === 'native') {
        if (!NATIVE_NAMES.includes(String(trig[k])))
          errs.push(`${w}: trigger.native must be one of ${NATIVE_NAMES.join('/')}`);
      } else if (k === 'variant') {
        if (typeof trig[k] !== 'string' || !/^[a-z][a-z0-9_]*$/.test(trig[k]))
          errs.push(`${w}: trigger.variant must be a native variant id`);
      } else errs.push(`${w}: unknown trigger "${k}"`);
    }
    if (isTransit && !('shipState' in trig))
      errs.push(`${w}: a Transit card needs trigger.shipState`);
    if (!isTransit && ('shipState' in trig || scenes.length > 1))
      errs.push(`${w}: a planetfall card has exactly one scene and no shipState trigger`);
    if (sceneList.includes('NativeContact') && !('native' in trig))
      errs.push(`${w}: a NativeContact card needs trigger.native`);
    if (!sceneList.includes('NativeContact') && 'native' in trig)
      errs.push(`${w}: trigger.native is only for NativeContact cards`);
    if ('variant' in trig && !('native' in trig))
      errs.push(`${w}: trigger.variant is only for NativeContact cards (with trigger.native)`);
  }
  if (!intIn(card.weight, 1, 1000)) errs.push(`${w}: weight must be an integer 1..1000`);
  if (!intIn(card.cooldownDays, 0, 10000)) errs.push(`${w}: cooldownDays must be an integer >= 0`);
  if (!str(card.title)) errs.push(`${w}: needs a title`);
  if (!str(card.body)) errs.push(`${w}: needs a body`);
  else if (wordCount(card.body) > MAX_CARD_BODY_WORDS)
    errs.push(`${w}: body is over ${MAX_CARD_BODY_WORDS} words`);
  if (!Array.isArray(card.choices)) return errs;
  card.choices.forEach((ch: unknown, i: number) => {
    const cw = `${w} choice ${i}`;
    if (!isRec(ch)) {
      errs.push(`${cw}: must be an object`);
      return;
    }
    if (!str(ch.label)) errs.push(`${cw}: needs a label`);
    else if (wordCount(ch.label) > MAX_CARD_LABEL_WORDS)
      errs.push(`${cw}: label is over ${MAX_CARD_LABEL_WORDS} words`);
    // Every choice must show its cost before commit (design pillar 3): a preview is required.
    if (!str(ch.preview)) errs.push(`${cw}: needs a preview showing every cost`);
    else {
      if (wordCount(ch.preview) > MAX_CARD_PREVIEW_WORDS)
        errs.push(`${cw}: preview is over ${MAX_CARD_PREVIEW_WORDS} words`);
      // Numbers come from the outcomes through choiceCost; text must not repeat them.
      if (
        /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|double)\b/i.test(
          String(ch.preview),
        )
      )
        errs.push(`${cw}: preview must not contain numbers (they come from the outcomes)`);
    }
    errs.push(...validateEffects(ch.outcomes, cw));
    errs.push(...sceneEffectProblems(ch.outcomes, isTransit, cw));
    if (ch.risk !== undefined) {
      const r = ch.risk;
      if (!isRec(r)) errs.push(`${cw}: risk must be an object`);
      else {
        // Hidden odds are not allowed: the percent is required and shown.
        if (!intIn(r.oddsPct, 1, 99)) errs.push(`${cw}: risk.oddsPct must be an integer 1..99`);
        if (!str(r.label)) errs.push(`${cw}: risk needs a label`);
        errs.push(...validateEffects(r.outcomes, `${cw} risk`));
        errs.push(...sceneEffectProblems(r.outcomes, isTransit, `${cw} risk`));
        if ('securityOddsPerGuard' in r) {
          if (isTransit) errs.push(`${cw}: securityOddsPerGuard is only for planetfall cards`);
          else if (!intIn(r.securityOddsPerGuard, -20, 20))
            errs.push(`${cw}: risk.securityOddsPerGuard must be an integer -20..20`);
        }
        // A trap can cost resources, hull or time; it never changes speed or reveals planets.
        if (isRec(r.outcomes)) {
          for (const k of ['detourDays', 'speedDrop', 'revealPlanet', 'revealRegion']) {
            if (k in r.outcomes) errs.push(`${cw}: risk outcomes may not use ${k}`);
          }
        }
      }
    }
  });
  return errs;
}

/** The events file: unique ids and every card valid. */
export function validateEventDefs(root: unknown): string[] {
  const errs: string[] = [];
  const cards = listOf(root, 'events', 'events', errs);
  if (cards.length === 0) errs.push('events: at least one card required');
  if (cards.length > MAX_EVENT_DEFS)
    errs.push(`events: ${cards.length} cards, max ${MAX_EVENT_DEFS}`);
  uniqueIds(cards, 'events', errs);
  for (const c of cards) errs.push(...validateEventCardFull(c));
  return errs;
}

export function validateTransitConfig(root: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(root)) return ['transit: must be an object'];
  if (!intIn(root.reroutePenaltyFuel, 0, 1_000_000))
    errs.push('transit: reroutePenaltyFuel must be an integer >= 0');
  if (!intIn(root.starvationPctPerDay, 1, 100))
    errs.push('transit: starvationPctPerDay must be 1..100');
  if (!intIn(root.driftDaysToLost, 1, 1000)) errs.push('transit: driftDaysToLost must be >= 1');
  if (!intIn(root.eventChancePermilleScale, 0, 1000))
    errs.push('transit: eventChancePermilleScale must be 0..1000');
  if (!intIn(root.eventChanceMaxPermille, 1, 1000))
    errs.push('transit: eventChanceMaxPermille must be 1..1000');
  const f = Array.isArray(root.eventSpeedFactorX100)
    ? (root.eventSpeedFactorX100 as unknown[])
    : [];
  if (f.length !== 3 || !f.every((v) => intIn(v, 1, 10000)))
    errs.push('transit: eventSpeedFactorX100 needs 3 positive integers');
  else if (!((f[0] as number) > (f[1] as number) && (f[1] as number) > (f[2] as number)))
    errs.push('transit: eventSpeedFactorX100 must fall with speed (faster means fewer events)');
  const s = root.survey;
  if (!isRec(s)) errs.push('transit: survey must be an object');
  else {
    for (const k of ['scannedRemainingPct', 'surveyedRemainingPct']) {
      if (!intIn(s[k], 0, 100)) errs.push(`transit: survey.${k} must be 0..100`);
    }
    if (!intIn(s.kitBonusPctPerStep, 0, 100))
      errs.push('transit: survey.kitBonusPctPerStep must be 0..100');
    // A capped bonus keeps a huge kit from surveying a target at launch (thresholds stay under 100).
    if (!intIn(s.kitBonusMaxPct, 0, 100))
      errs.push('transit: survey.kitBonusMaxPct must be 0..100');
    else if (
      intIn(s.scannedRemainingPct, 0, 100) &&
      (s.scannedRemainingPct as number) + (s.kitBonusMaxPct as number) >= 100
    )
      errs.push('transit: scannedRemainingPct + kitBonusMaxPct must stay under 100');
    if (intIn(s.scannedRemainingPct, 0, 100) && intIn(s.surveyedRemainingPct, 0, 100)) {
      if ((s.surveyedRemainingPct as number) > (s.scannedRemainingPct as number))
        errs.push(
          'transit: survey.surveyedRemainingPct must not exceed scannedRemainingPct (survey improves on approach)',
        );
    }
    for (const k of ['scannedHalfWidth', 'surveyedHalfWidth']) {
      if (!intIn(s[k], 0, 50)) errs.push(`transit: survey.${k} must be 0..50`);
    }
    if (
      intIn(s.scannedHalfWidth, 0, 50) &&
      intIn(s.surveyedHalfWidth, 0, 50) &&
      (s.surveyedHalfWidth as number) > (s.scannedHalfWidth as number)
    )
      errs.push('transit: survey ranges must narrow (surveyedHalfWidth <= scannedHalfWidth)');
  }
  return errs;
}

function intArray(v: unknown, len: number, lo: number, hi: number): boolean {
  return Array.isArray(v) && v.length === len && v.every((x) => intIn(x, lo, hi));
}

/** Planetfall tables (M4): exploration, hazards, natives and founding. All integers. */
export function validatePlanetfallConfig(root: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(root)) return ['planetfall: must be an object'];
  const st = root.stances;
  if (!isRec(st)) errs.push('planetfall: stances must be an object');
  else {
    if (!intArray(st.successPct, 3, 1, 500))
      errs.push('planetfall: stances.successPct needs 3 percents');
    if (!intArray(st.hazardPct, 3, 0, 1000))
      errs.push('planetfall: stances.hazardPct needs 3 percents');
    if (!intArray(st.regionsPerRound, 3, 1, 2))
      errs.push('planetfall: stances.regionsPerRound needs 3 values of 1 or 2');
    if (!intArray(st.roundDays, 3, 1, 60))
      errs.push('planetfall: stances.roundDays needs 3 day counts');
    // The design: Bold explores two regions and doubles the hazard odds; Cautious is the reverse.
    if (intArray(st.regionsPerRound, 3, 1, 2) && intArray(st.hazardPct, 3, 0, 1000)) {
      const r = st.regionsPerRound as number[];
      const h = st.hazardPct as number[];
      if (r[2] !== 2 || r[0] !== 1 || r[1] !== 1)
        errs.push('planetfall: only Bold explores two regions a round (design)');
      if (!(h[0] < h[1] && h[1] < h[2]))
        errs.push('planetfall: hazardPct must rise Cautious < Balanced < Bold');
      if (h[2] !== h[1] * 2) errs.push('planetfall: Bold doubles the hazard odds (design)');
    }
  }
  if (!intArray(root.terrainExploreBasePct, TERRAIN_COUNT, 1, 100))
    errs.push(`planetfall: terrainExploreBasePct needs ${TERRAIN_COUNT} percents`);
  if (!intArray(root.hazardPctByLevel, 4, 0, 100) || (root.hazardPctByLevel as number[])[0] !== 0)
    errs.push('planetfall: hazardPctByLevel needs 4 percents, index 0 unused (0)');
  else {
    const h = root.hazardPctByLevel as number[];
    if (!(h[1] < h[2] && h[2] < h[3]))
      errs.push('planetfall: hazardPctByLevel must rise Low < Medium < High');
  }
  if (!intIn(root.splitHazardPct, 100, 1000))
    errs.push('planetfall: splitHazardPct must be >= 100');
  if (!intIn(root.minExplorersPerTeam, 1, 1000))
    errs.push('planetfall: minExplorersPerTeam must be >= 1');
  for (const k of ['team', 'kit']) {
    const t = root[k];
    const full = k === 'team' ? 'fullExplorers' : 'fullSteps';
    if (
      !isRec(t) ||
      !intIn(t.minPct, 1, 500) ||
      !intIn(t.maxPct, 1, 500) ||
      !intIn(t[full], 1, 100000)
    )
      errs.push(`planetfall: ${k} needs minPct, maxPct and ${full}`);
    else if ((t.minPct as number) > (t.maxPct as number))
      errs.push(`planetfall: ${k}.minPct must not exceed maxPct`);
  }
  if (!intIn(root.successMinPct, 0, 100) || !intIn(root.successMaxPct, 1, 100))
    errs.push('planetfall: successMinPct / successMaxPct must be 0..100');
  else if ((root.successMinPct as number) > (root.successMaxPct as number))
    errs.push('planetfall: successMinPct must not exceed successMaxPct');
  const hz = root.hazard;
  if (!isRec(hz)) errs.push('planetfall: hazard must be an object');
  else {
    for (const k of ['injuryWeight', 'deathWeight', 'supplyLossWeight']) {
      if (!intIn(hz[k], 0, 100)) errs.push(`planetfall: hazard.${k} must be 0..100`);
    }
    if (
      intIn(hz.injuryWeight, 0, 100) &&
      intIn(hz.deathWeight, 0, 100) &&
      intIn(hz.supplyLossWeight, 0, 100) &&
      (hz.injuryWeight as number) + (hz.deathWeight as number) + (hz.supplyLossWeight as number) !==
        100
    )
      errs.push('planetfall: hazard weights must sum to 100');
    for (const k of ['injuryPct', 'deathPct', 'supplyLossPct', 'diseaseInjuredPct']) {
      if (!intIn(hz[k], 1, 100)) errs.push(`planetfall: hazard.${k} must be 1..100`);
    }
  }
  const nt = root.natives;
  if (!isRec(nt)) errs.push('planetfall: natives must be an object');
  else {
    for (const k of ['guideSuccessPct', 'hostileHomeSuccessPct'])
      if (!intIn(nt[k], 1, 500)) errs.push(`planetfall: natives.${k} must be a percent`);
    if (!intIn(nt.sharedFoodPerExplorer, 0, 1000))
      errs.push('planetfall: natives.sharedFoodPerExplorer must be >= 0');
    if (!intIn(nt.strengthBase, 1, 1000))
      errs.push('planetfall: natives.strengthBase must be >= 1');
    if (!intArray(nt.ambushBasePct, 4, 0, 100) || !intArray(nt.ambushHarmPct, 4, 0, 100))
      errs.push(
        'planetfall: natives ambush tables need 4 percents (None, Peaceful, Wary, Hostile)',
      );
    else {
      const a = nt.ambushBasePct as number[];
      if (a[0] !== 0 || a[1] !== 0 || a[2] !== 0)
        errs.push('planetfall: only Hostile natives ambush (Wary natives only make contact)');
      if (!(a[3] > 0)) errs.push('planetfall: Hostile natives must ambush');
    }
    if (
      !intIn(nt.securityReductionPctPerGuard, 0, 100) ||
      !intIn(nt.securityReductionMaxPct, 0, 100)
    )
      errs.push('planetfall: natives security reduction values must be percents');
    errs.push(...validateNativeVariants(nt.variants));
  }
  const fd = root.founding;
  if (!isRec(fd)) return [...errs, 'planetfall: founding must be an object'];
  if (!intIn(fd.reserveDays, 1, 1000)) errs.push('planetfall: founding.reserveDays must be >= 1');
  if (!intIn(fd.viableColonists, 1, 1_000_000))
    errs.push('planetfall: founding.viableColonists must be >= 1');
  for (const k of ['planGroundDays', 'bandGiftDays'])
    if (!intIn(fd[k], 0, 1000)) errs.push(`planetfall: founding.${k} must be >= 0`);
  for (const k of [
    'colonistsMinPct',
    'findWeightPct',
    'thrivingSharePct',
    'failedLossPct',
    'bandColonistLossPct',
    'bandSupplyLossPct',
  ])
    if (!intIn(fd[k], 0, 100)) errs.push(`planetfall: founding.${k} must be 0..100`);
  if (!intIn(fd.strugglingPenaltyDays, 0, 10000))
    errs.push('planetfall: founding.strugglingPenaltyDays must be >= 0');
  if (!intArray(fd.nativesPct, 4, 1, 100))
    errs.push('planetfall: founding.nativesPct needs 4 percents (None, Peaceful, Wary, Hostile)');
  else if ((fd.nativesPct as number[])[0] !== 100)
    errs.push('planetfall: founding.nativesPct[None] must be 100');
  for (const k of ['nativeHomePenaltyPts', 'securityPtsPerGuard', 'securityMaxPts'])
    if (!intIn(fd[k], 0, 100)) errs.push(`planetfall: founding.${k} must be 0..100`);
  if (!Array.isArray(fd.findSitePct) || !fd.findSitePct.every((x) => intIn(x, 0, 100)))
    errs.push('planetfall: founding.findSitePct must be percents');
  return errs;
}

/**
 * Native variants (M7a): at least 3, at most 15 (they are stored in a byte), unique snake_case ids,
 * a name, a flavour line, a starting disposition and a small strength change. Every disposition
 * has at least one variant, so every native planet gets a kind.
 */
export function validateNativeVariants(v: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(v)) return ['planetfall: natives.variants must be an array'];
  if (v.length < 3 || v.length > 15)
    errs.push(`planetfall: natives.variants needs 3 to 15 entries, got ${v.length}`);
  const seen = new Set<string>();
  const perDisp: Record<string, number> = { Peaceful: 0, Wary: 0, Hostile: 0 };
  v.forEach((x: unknown, i: number) => {
    const w = `planetfall: natives.variants[${i}]`;
    if (!isRec(x)) {
      errs.push(`${w} must be an object`);
      return;
    }
    if (typeof x.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(x.id))
      errs.push(`${w}.id must be snake_case`);
    else if (seen.has(x.id)) errs.push(`${w}.id "${x.id}" is a duplicate`);
    else seen.add(x.id);
    if (!str(x.name) || wordCount(x.name) > 2) errs.push(`${w}.name must be one or two words`);
    if (!str(x.flavour) || wordCount(x.flavour) > MAX_FLAVOUR_WORDS)
      errs.push(`${w}.flavour must be a line of at most ${MAX_FLAVOUR_WORDS} words`);
    if (typeof x.disposition !== 'string' || !(x.disposition in perDisp))
      errs.push(`${w}.disposition must be one of ${NATIVE_NAMES.join('/')}`);
    else perDisp[x.disposition]++;
    if (!intIn(x.strengthDelta, -30, 30)) errs.push(`${w}.strengthDelta must be -30..30`);
  });
  for (const d of NATIVE_NAMES) {
    if (perDisp[d] < 1) errs.push(`planetfall: natives.variants needs a ${d} variant`);
  }
  return errs;
}

/**
 * Event cards against the native variants (M7a): a card's trigger.variant names a real variant
 * whose disposition is the card's trigger.native, and every disposition keeps a generic contact
 * card (no variant), so a contact always finds a card even after the mood has moved.
 */
export function validateEventsAgainstVariants(events: unknown, planetfall: unknown): string[] {
  if (!isRec(events) || !Array.isArray(events.events)) return [];
  const nt = isRec(planetfall) && isRec(planetfall.natives) ? planetfall.natives : null;
  const variants: Rec[] =
    nt !== null && Array.isArray(nt.variants) ? (nt.variants as unknown[]).filter(isRec) : [];
  const errs: string[] = [];
  const generic: Record<string, number> = { Peaceful: 0, Wary: 0, Hostile: 0 };
  for (const c of events.events as unknown[]) {
    if (!isRec(c) || !isRec(c.trigger) || !Array.isArray(c.scenes)) continue;
    if (!c.scenes.includes('NativeContact')) continue;
    const trig = c.trigger;
    const nat = String(trig.native);
    if (typeof trig.variant === 'string') {
      const found = variants.find((x) => x.id === trig.variant);
      if (!found)
        errs.push(`eventCard "${String(c.id)}": unknown native variant "${trig.variant}"`);
      else if (found.disposition !== nat)
        errs.push(
          `eventCard "${String(c.id)}": variant "${trig.variant}" is ${String(found.disposition)}, not ${nat}`,
        );
    } else if (nat in generic) generic[nat]++;
  }
  for (const d of NATIVE_NAMES) {
    if (generic[d] < 1) errs.push(`events: ${d} natives need a contact card without a variant`);
  }
  return errs;
}

/** The find table length must line up with terrain.json findKinds (checked together). */
export function validatePlanetfallAgainstTerrain(planetfall: unknown, terrain: unknown): string[] {
  if (!isRec(planetfall) || !isRec(terrain) || !isRec(planetfall.founding)) return [];
  const kinds = Array.isArray(terrain.findKinds) ? terrain.findKinds.length : -1;
  const sites = planetfall.founding.findSitePct;
  return Array.isArray(sites) && sites.length === kinds
    ? []
    : ['planetfall: founding.findSitePct must have one entry per terrain findKind'];
}

const DISTRICT_IDS = ['farm', 'mine', 'refinery', 'habitat', 'research', 'spaceport'];
/** Effects a tech may have. Must equal TECH_EFFECTS in src/shared/research.ts (tested). */
export const TECH_EFFECT_KEYS = [
  'burnCutPct',
  'hullRatingPct',
  'refineryPct',
  'farmPct',
  'eatCutPct',
  'foundingPts',
  'researchPct',
  'surveyPts',
  'minePct',
  'raidCutPct',
];

/** Colony economy tables (M5): districts, outputs, growth, native stances, win and lose. */
export function validateEconomy(root: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(root)) return ['economy: must be an object'];
  const ds = listOf(root, 'districts', 'economy', errs);
  if (ds.length !== DISTRICT_TYPE_COUNT)
    errs.push(`economy: expected ${DISTRICT_TYPE_COUNT} district types, got ${ds.length}`);
  if (ds.map((d) => d.id).join() !== DISTRICT_IDS.join())
    errs.push(`economy: district ids must be ${DISTRICT_IDS.join(', ')} in that order`);
  for (const d of ds) {
    const id = String(d.id);
    if (!str(d.name)) errs.push(`economy: district "${id}" needs a name`);
    if (!intIn(d.buildCost, 0, 1_000_000)) errs.push(`economy: "${id}".buildCost must be >= 0`);
    if (!intIn(d.buildDays, 1, 255)) errs.push(`economy: "${id}".buildDays must be 1..255`);
  }
  const o = root.output;
  if (!isRec(o)) errs.push('economy: output must be an object');
  else {
    for (const k of [
      'farmSupplies',
      'habitatSupplies',
      'mineProduction',
      'refineryFuel',
      'researchPoints',
    ]) {
      if (!intIn(o[k], 0, 1_000_000)) errs.push(`economy: output.${k} must be an integer >= 0`);
    }
  }
  const tp = root.terrainPct;
  if (!isRec(tp)) errs.push('economy: terrainPct must be an object');
  else {
    for (const k of ['farm', 'mine', 'refinery', 'habitat', 'research']) {
      if (!intArray(tp[k], TERRAIN_COUNT, 0, 500))
        errs.push(`economy: terrainPct.${k} needs ${TERRAIN_COUNT} percents`);
    }
  }
  if (!intIn(root.workersFull, 1, 1_000_000)) errs.push('economy: workersFull must be >= 1');
  if (!intIn(root.minWorkPct, 0, 100)) errs.push('economy: minWorkPct must be 0..100');
  const se = root.settlement;
  if (
    !isRec(se) ||
    !intIn(se.supplies, 0, 100000) ||
    !intIn(se.production, 0, 100000) ||
    !intIn(se.suppliesPopDivisor, 1, 1_000_000)
  )
    errs.push('economy: settlement needs supplies, production >= 0 and suppliesPopDivisor >= 1');
  const fo = root.founding;
  if (
    !isRec(fo) ||
    !intIn(fo.starterProduction, 0, 1_000_000) ||
    !intIn(fo.starterFoodDays, 0, 1000) ||
    !intIn(fo.starterFoodCap, 0, 100_000_000)
  )
    errs.push('economy: founding needs starterProduction, starterFoodDays and starterFoodCap >= 0');
  const sv = root.starvation;
  if (!isRec(sv) || !intIn(sv.pctPerDay, 1, 100) || !intIn(sv.graceDays, 0, 200))
    errs.push('economy: starvation needs pctPerDay 1..100 and graceDays 0..200');
  const ho = root.housing;
  if (!isRec(ho) || !intIn(ho.base, 1, 10_000_000) || !intIn(ho.perHabitat, 0, 10_000_000))
    errs.push('economy: housing needs base >= 1 and perHabitat >= 0');
  const gr = root.growth;
  if (!isRec(gr) || !intIn(gr.permillePerDay, 0, 1000) || !intArray(gr.tierPct, 3, 0, 1000))
    errs.push('economy: growth needs permillePerDay and 3 tierPct (Failed, Struggling, Thriving)');
  else if ((gr.tierPct as number[])[2] < (gr.tierPct as number[])[1])
    errs.push('economy: Thriving colonies must not grow slower than Struggling ones');
  if (!intIn(root.penaltyOutputPct, 0, 100)) errs.push('economy: penaltyOutputPct must be 0..100');
  if (!intIn(root.coexistBonusPct, 0, 100)) errs.push('economy: coexistBonusPct must be 0..100');
  if (!intIn(root.stockCap, 1_000_000, 2_000_000_000))
    errs.push('economy: stockCap must be 1000000..2000000000 (Int32 stockpiles)');
  const hw = root.homeworld;
  if (
    !isRec(hw) ||
    !intIn(hw.supplies, 0, 1_000_000) ||
    !intIn(hw.fuel, 0, 1_000_000) ||
    !intIn(hw.production, 0, 1_000_000)
  )
    errs.push('economy: homeworld needs supplies, fuel and production >= 0');
  const n = root.natives;
  if (!isRec(n)) errs.push('economy: natives must be an object');
  else {
    for (const k of ['raidIntervalDays', 'pushIntervalDays', 'driftIntervalDays'])
      if (!intIn(n[k], 1, 10000)) errs.push(`economy: natives.${k} must be >= 1`);
    for (const k of ['raidHarmPct', 'raidDistrictPct', 'pushCostPct'])
      if (!intIn(n[k], 0, 100)) errs.push(`economy: natives.${k} must be 0..100`);
    for (const k of ['defendUpkeepProduction', 'pushCostMin'])
      if (!intIn(n[k], 0, 100000)) errs.push(`economy: natives.${k} must be >= 0`);
    if (!intArray(n.raidChancePct, 4, 0, 100))
      errs.push('economy: natives.raidChancePct needs 4 percents (None, Peaceful, Wary, Hostile)');
    else {
      const r = n.raidChancePct as number[];
      if (r[0] !== 0 || r[1] !== 0 || r[2] !== 0 || !(r[3] > 0))
        errs.push('economy: only Hostile natives raid (design, section 7)');
    }
    for (const k of ['stanceChancePct', 'stanceHarmPct'])
      if (!intArray(n[k], COLONY_STANCE_COUNT, 0, 1000))
        errs.push(`economy: natives.${k} needs ${COLONY_STANCE_COUNT} percents`);
    if (!intArray(n.driftChancePct, COLONY_STANCE_COUNT, 0, 100))
      errs.push(`economy: natives.driftChancePct needs ${COLONY_STANCE_COUNT} percents`);
    if (intArray(n.stanceChancePct, 3, 0, 1000) && intArray(n.stanceHarmPct, 3, 0, 1000)) {
      const c = n.stanceChancePct as number[];
      const h = n.stanceHarmPct as number[];
      if (!(c[1] < c[0]) || !(h[1] < h[0]))
        errs.push('economy: Defend must cut raid chance and harm below Coexist (design)');
    }
  }
  const w = root.win;
  if (
    !isRec(w) ||
    !intIn(w.colonies, 1, 15) ||
    !intIn(w.population, 1, 1_000_000) ||
    !intIn(w.holdDays, 1, 5000)
  )
    errs.push('economy: win needs colonies 1..15, population >= 1 and holdDays >= 1');
  const l = root.lose;
  if (!isRec(l) || !intIn(l.minLaunchPassengers, 1, 1_000_000))
    errs.push('economy: lose.minLaunchPassengers must be >= 1');
  return errs;
}

/** About 10 techs in three short branches, one fixed effect each (M5). */
export function validateTechs(root: unknown): string[] {
  const errs: string[] = [];
  if (!isRec(root)) return ['techs: must be an object'];
  const branches = Array.isArray(root.branches) ? (root.branches as unknown[]) : [];
  if (branches.length !== TECH_BRANCH_COUNT || !branches.every(str))
    errs.push(`techs: expected ${TECH_BRANCH_COUNT} branch names`);
  const techs = listOf(root, 'techs', 'techs', errs);
  if (techs.length < 8 || techs.length > MAX_TECHS)
    errs.push(`techs: expected about 10 techs (8..${MAX_TECHS}), got ${techs.length}`);
  uniqueIds(techs, 'techs', errs);
  techs.forEach((t, i) => {
    const id = String(t.id);
    if (!/^[a-z][a-z0-9_]*$/.test(id)) errs.push(`techs: "${id}" id must be snake_case`);
    if (!str(t.name) || !str(t.text)) errs.push(`techs: "${id}" needs a name and text`);
    if (!intIn(t.branch, 0, TECH_BRANCH_COUNT - 1)) errs.push(`techs: "${id}".branch is invalid`);
    if (!intIn(t.cost, 1, 1_000_000)) errs.push(`techs: "${id}".cost must be >= 1`);
    if (!intIn(t.prereq, -1, techs.length - 1) || t.prereq === i)
      errs.push(`techs: "${id}".prereq must be -1 or another tech`);
    else if ((t.prereq as number) > i)
      errs.push(`techs: "${id}".prereq must come earlier in the list (no cycles)`);
    if (!TECH_EFFECT_KEYS.includes(String(t.effect)))
      errs.push(`techs: "${id}".effect must be one of ${TECH_EFFECT_KEYS.join('/')}`);
    if (!intIn(t.value, 1, 1000)) errs.push(`techs: "${id}".value must be >= 1`);
  });
  return errs;
}

export function validateAllContent(c: {
  hulls: unknown;
  loadout: unknown;
  speeds: unknown;
  terrain: unknown;
  planetTypes: unknown;
  transit: unknown;
  events: unknown;
  planetfall: unknown;
  economy: unknown;
  techs: unknown;
}): string[] {
  return [
    ...validateHulls(c.hulls),
    ...validateSpeeds(c.speeds),
    ...validateLoadoutConfig(c.loadout),
    ...validateTerrain(c.terrain),
    ...validatePlanetTypes(c.planetTypes),
    ...validateTransitConfig(c.transit),
    ...validateEventDefs(c.events),
    ...validatePlanetfallConfig(c.planetfall),
    ...validatePlanetfallAgainstTerrain(c.planetfall, c.terrain),
    ...validateEventsAgainstVariants(c.events, c.planetfall),
    ...validateEconomy(c.economy),
    ...validateTechs(c.techs),
  ];
}
