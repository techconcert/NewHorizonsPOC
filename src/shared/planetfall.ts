import { FIND_KINDS, LOADOUT, PLANETFALL } from '../data';

/**
 * Planetfall math shared by the sim (rolls), the snapshot and the UI (previews): exploration
 * success, hazards, ambushes, and the founding roll with its factor breakdown. Integer math only,
 * percent factors where 100 is neutral; every number comes from src/data/planetfall.json.
 * docs/GAME_DESIGN.md sections 6 and 7; decisions D-065 to D-075.
 */

export const Stance = { Cautious: 0, Balanced: 1, Bold: 2 } as const;
export const STANCE_COUNT = 3;
export const STANCE_NAMES: readonly string[] = ['Cautious', 'Balanced', 'Bold'];

/** Expedition lifecycle (stored in expedition.status). */
export const ExpeditionStatus = {
  None: 0,
  /** On the ground, exploring or waiting for orders. */
  Active: 1,
  /** The founding failed: survivors wait to re-embark. */
  Stranded: 2,
  /** A colony was founded; the expedition is over. */
  Founded: 3,
  /** Everyone died. */
  Dead: 4,
  /** Survivors and cargo went back aboard the ship. */
  Returned: 5,
  /** A planetfall card is waiting for the player; the expedition stands still. */
  Event: 6,
} as const;

/** True while the expedition is on the ground, stranded or waiting on a card. */
export function isLiveStatus(status: number): boolean {
  return (
    status === ExpeditionStatus.Active ||
    status === ExpeditionStatus.Stranded ||
    status === ExpeditionStatus.Event
  );
}

/** Founding outcome tiers (GAME_DESIGN section 6). */
export const FoundTier = { Failed: 0, Struggling: 1, Thriving: 2 } as const;
export const FOUND_TIER_NAMES: readonly string[] = ['Failed', 'Struggling', 'Thriving'];

export const Disp = { None: 0, Peaceful: 1, Wary: 2, Hostile: 3 } as const;

/** Find kinds that act, by id in terrain.json findKinds. */
export const FIND_DISEASE = FIND_KINDS.indexOf('disease');
export const FIND_MYSTERY = FIND_KINDS.indexOf('mystery');
export const FIND_NOTHING = FIND_KINDS.indexOf('nothing');
/** region.find value before a region is explored. */
export const FIND_UNKNOWN = 255;

// ---- Last roll record ------------------------------------------------------------------------

/** Records kept per expedition: the last round's rolls (one, or two for Bold / split). */
export const LAST_ROLL_SLOTS = 2;
export const LR_STRIDE = 24;

export const LR_KIND = 0; // 0 none, 1 exploration, 2 founding
export const LR_DAY = 1;
export const LR_REGION = 2; // local region index
export const LR_TERRAIN = 3;
// Exploration factors (success chance = base x team x kit x stance x natives):
export const LR_BASE = 4; // terrain base percent
export const LR_TEAM = 5; // team size percent
export const LR_KITPCT = 6; // survey kit percent
export const LR_STANCEPCT = 7; // stance percent
export const LR_NATIVESPCT = 8; // natives percent (guides, hostile ground)
export const LR_RAW_CHANCE = 9; // the product before the clamp
export const LR_CLAMPED = 10; // 0 as computed, 1 raised to the minimum, 2 lowered to the maximum
export const LR_CHANCE = 11; // final percent
export const LR_ROLL = 12; // the d100 (0..99); success when roll < chance
export const LR_RESULT = 13; // exploration: 1 explored, 0 not; founding: FoundTier
export const LR_FIND = 14; // find kind id, or -1
export const LR_HAZARD_CHANCE = 15;
export const LR_HAZARD_ROLL = 16; // -1 when not rolled
export const LR_HAZARD_KIND = 17; // 0 none, 1 injury, 2 death, 3 supplies lost
export const LR_HAZARD_AMOUNT = 18;
export const LR_AMBUSH_CHANCE = 19; // 0 when no ambush could happen
export const LR_AMBUSH_ROLL = 20; // -1 when not rolled
export const LR_AMBUSH_HARM = 21; // explorers lost, after Security
export const LR_TEAM_SIZE = 22; // explorers on that team
export const LR_SPLIT = 23; // 1 when the team was split
// Founding factors (chance = habitability x site x supplies x colonists x natives x kit, plus
// the research bonus) reuse the slots: the sim writes these named aliases.
export const FR_HABITABILITY = 4;
export const FR_SITE = 5; // site quality from the explored regions
export const FR_SUPPLIES = 6; // supplies remaining
export const FR_COLONISTS = 7;
export const FR_NATIVES = 8;
export const FR_KIT = 9;
export const FR_RESEARCH = 10; // life-support bonus points: 0 until M5
export const FR_SURVIVORS = 21; // founding: colonists that settled (success) or survived (failure)

export const HAZARD_NONE = 0;
export const HAZARD_INJURY = 1;
export const HAZARD_DEATH = 2;
export const HAZARD_SUPPLIES = 3;

export const PF = PLANETFALL;

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

// ---- Exploration -------------------------------------------------------------------------------

export function stanceRoundDays(stance: number): number {
  return PF.stances.roundDays[stance];
}

export function stanceRegionsPerRound(stance: number): number {
  return PF.stances.regionsPerRound[stance];
}

export function stanceSuccessPct(stance: number): number {
  return PF.stances.successPct[stance];
}

/** Terrain base success percent (terrain.json order). */
export function terrainBasePct(terrain: number): number {
  return PF.terrainExploreBasePct[terrain];
}

/** Team size bonus: minPct for a lone explorer, rising linearly to maxPct at the full team. */
export function teamSizePct(explorers: number): number {
  const t = PF.team;
  const n = explorers < 0 ? 0 : explorers > t.fullExplorers ? t.fullExplorers : explorers;
  return t.minPct + Math.floor(((t.maxPct - t.minPct) * n) / t.fullExplorers);
}

/** Survey kit bonus for exploring: minPct with no kit, rising linearly to maxPct. */
export function exploreKitPct(kitSteps: number): number {
  const k = PF.kit;
  const n = kitSteps < 0 ? 0 : kitSteps > k.fullSteps ? k.fullSteps : kitSteps;
  return k.minPct + Math.floor(((k.maxPct - k.minPct) * n) / k.fullSteps);
}

/**
 * Exploration success chance in whole percent = terrain base x team size x kit x stance x natives
 * (each a percent, 100 neutral), floored once on the full product and kept within successMinPct..successMaxPct. The five
 * factors multiply to at most about 4e10, exact in a double.
 */
export function explorationChancePct(
  base: number,
  team: number,
  kit: number,
  stance: number,
  natives: number,
): number {
  return clampExploration(explorationRawPct(base, team, kit, stance, natives));
}

/** The floored product of the five factors, before the clamp (recorded as LR_RAW_CHANCE). */
export function explorationRawPct(
  base: number,
  team: number,
  kit: number,
  stance: number,
  natives: number,
): number {
  return Math.floor((base * team * kit * stance * natives) / 100_000_000);
}

export function clampExploration(raw: number): number {
  return raw < PF.successMinPct
    ? PF.successMinPct
    : raw > PF.successMaxPct
      ? PF.successMaxPct
      : raw;
}

/** 0 when the raw chance stands, 1 when it was raised to the minimum, 2 when lowered to the cap. */
export function clampKind(raw: number): number {
  return raw < PF.successMinPct ? 1 : raw > PF.successMaxPct ? 2 : 0;
}

/** Hazard chance per region roll in percent: level (1 Low, 2 Medium, 3 High) x stance x split. */
export function hazardChancePct(level: number, stance: number, split: boolean): number {
  const c = Math.floor(
    (PF.hazardPctByLevel[level] *
      PF.stances.hazardPct[stance] *
      (split ? PF.splitHazardPct : 100)) /
      10000,
  );
  return c > 95 ? 95 : c;
}

/** Which hazard a hazard roll (0..99) hits: injury, death or lost supplies. */
export function hazardKindOf(roll: number): number {
  const h = PF.hazard;
  if (roll < h.injuryWeight) return HAZARD_INJURY;
  if (roll < h.injuryWeight + h.deathWeight) return HAZARD_DEATH;
  return HAZARD_SUPPLIES;
}

/** Explorers hurt or killed, or supplies lost, by a hazard (at least 1 while any are left). */
export function hazardAmount(kind: number, explorers: number, supplies: number): number {
  const h = PF.hazard;
  if (kind === HAZARD_SUPPLIES) {
    const n = ceilDiv(supplies * h.supplyLossPct, 100);
    return n > supplies ? supplies : n;
  }
  const pct = kind === HAZARD_INJURY ? h.injuryPct : h.deathPct;
  const n = Math.max(1, ceilDiv(explorers * pct, 100));
  return n > explorers ? explorers : n;
}

/** Explorers made sick by a disease find. */
export function diseaseAmount(explorers: number): number {
  const n = Math.max(1, ceilDiv(explorers * PF.hazard.diseaseInjuredPct, 100));
  return n > explorers ? explorers : n;
}

// ---- Natives ------------------------------------------------------------------------------------

/**
 * Natives factor for exploration success: Peaceful natives guide (bonus everywhere once
 * contacted); Hostile natives make their home regions harder; everything else is neutral.
 */
export function nativesExplorePct(disp: number, revealed: boolean, inHomeRegion: boolean): number {
  if (!revealed) return 100;
  if (disp === Disp.Peaceful) return PF.natives.guideSuccessPct;
  if (disp === Disp.Hostile && inHomeRegion) return PF.natives.hostileHomeSuccessPct;
  return 100;
}

/** Ambush chance in percent: Wary / Hostile base scaled by the group's strength (0 otherwise). */
export function ambushChancePct(disp: number, strength: number): number {
  const n = PF.natives;
  const c = Math.floor(
    (n.ambushBasePct[disp] * (n.strengthBase + strength)) / (2 * n.strengthBase),
  );
  return c > 95 ? 95 : c;
}

/** Share of ambush harm Security (guards) removes, in percent. */
export function securityReductionPct(guards: number): number {
  const n = PF.natives;
  const r = guards * n.securityReductionPctPerGuard;
  return r > n.securityReductionMaxPct ? n.securityReductionMaxPct : r;
}

/** Explorers lost to an ambush: harm scales with the natives' strength, Security removes a share. */
export function ambushHarm(
  explorers: number,
  disp: number,
  strength: number,
  guards: number,
): number {
  const n = PF.natives;
  const raw = ceilDiv(
    explorers * n.ambushHarmPct[disp] * (n.strengthBase + strength),
    200 * n.strengthBase,
  );
  const harm = Math.floor((raw * (100 - securityReductionPct(guards))) / 100);
  return harm > explorers ? explorers : harm;
}

// ---- Native variants (M7a) ----------------------------------------------------------------------

/** The kinds of natives from planetfall.json. Variant ids are 1-based everywhere (0 = none / unknown). */
export const NATIVE_VARIANT_COUNT = PF.natives.variants.length;
export const NATIVE_VARIANT_IDS: readonly string[] = PF.natives.variants.map((v) => v.id);
export const NATIVE_VARIANT_NAMES: readonly string[] = [
  '',
  ...PF.natives.variants.map((v) => v.name),
];
export const NATIVE_VARIANT_FLAVOUR: readonly string[] = [
  '',
  ...PF.natives.variants.map((v) => v.flavour),
];
const DISP_WORD: readonly string[] = ['', 'peaceful', 'wary', 'hostile'];
/** Variant ids (1-based) that start with each disposition (index 0 unused), in file order. */
const VARIANTS_BY_DISP: readonly (readonly number[])[] = [0, 1, 2, 3].map((d) =>
  PF.natives.variants
    .map((v, i) => (Disp[v.disposition as 'Peaceful' | 'Wary' | 'Hostile'] === d ? i + 1 : 0))
    .filter((i) => i > 0),
);

/**
 * The kind of natives for a planet whose generation rolled `rawStrength` (10..90): the variants of
 * the starting disposition take turns by strength, so the choice needs no extra random draw and
 * the galaxy stream is unchanged. 0 when the disposition has no variant.
 */
export function pickNativeVariant(disp: number, rawStrength: number): number {
  const list = VARIANTS_BY_DISP[disp];
  if (list === undefined || list.length === 0) return 0;
  return list[rawStrength % list.length];
}

/** Strength after the variant's change (kept within 1..99). */
export function variantStrength(variant: number, rawStrength: number): number {
  const d = variant > 0 ? PF.natives.variants[variant - 1].strengthDelta : 0;
  const v = rawStrength + d;
  return v < 1 ? 1 : v > 99 ? 99 : v;
}

/** "peaceful traders", "wary herders"; "peaceful natives" when the kind is not known. */
export function nativeKindText(disp: number, variant: number): string {
  const word = DISP_WORD[disp] ?? '';
  const kind = variant > 0 ? NATIVE_VARIANT_NAMES[variant].toLowerCase() : 'natives';
  return word === '' ? kind : `${word} ${kind}`;
}

/** Supplies the Peaceful natives share with the team after each round of exploring. */
export function sharedFood(explorers: number): number {
  return explorers * PF.natives.sharedFoodPerExplorer;
}

// ---- Founding ----------------------------------------------------------------------------------

export function clampPct(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

/**
 * Supplies factor: how many of the reserve days the supplies remaining cover per colonist, capped
 * at 100 (nobody to feed counts as covered).
 */
export function supplyFactorPct(supplies: number, colonists: number): number {
  const need = colonists * PF.founding.reserveDays;
  if (need <= 0) return 100;
  return clampPct(Math.floor((supplies * 100) / need));
}

/** Colonists factor: colonistsMinPct for a handful, 100 from the viable colony size. */
export function colonistsFactorPct(colonists: number): number {
  const f = PF.founding;
  const n = colonists < 0 ? 0 : colonists > f.viableColonists ? f.viableColonists : colonists;
  return f.colonistsMinPct + Math.floor(((100 - f.colonistsMinPct) * n) / f.viableColonists);
}

/** Site score 0..100: the region's find, blended with the share of the planet explored. */
export function siteScore(findKind: number, explored: number, regions: number): number {
  const f = PF.founding;
  const find = findKind >= 0 && findKind < f.findSitePct.length ? f.findSitePct[findKind] : 0;
  const share = regions > 0 ? Math.floor((100 * explored) / regions) : 0;
  return Math.floor((find * f.findWeightPct + share * (100 - f.findWeightPct)) / 100);
}

/** Site quality percent: the survey level's band (loadout.json) filled by the site score. */
export function siteQualityPct(score: number, survey: number): number {
  const bands = LOADOUT.founding.siteQualityBands;
  const lvl = survey < 0 ? 0 : survey >= bands.length ? bands.length - 1 : survey;
  const lo = bands[lvl][0];
  const hi = bands[lvl][1];
  return lo + Math.floor(((hi - lo) * clampPct(score)) / 100);
}

/**
 * Natives factor at founding: the disposition's base, Security helps against Wary / Hostile
 * natives and unsettles Peaceful ones, and settling in their home region costs points more.
 */
export function nativesFoundingPct(disp: number, inHomeRegion: boolean, guards: number): number {
  const f = PF.founding;
  if (disp === Disp.None) return 100;
  const sec = Math.min(f.securityMaxPts, guards * f.securityPtsPerGuard);
  let v = f.nativesPct[disp] + (disp === Disp.Peaceful ? -sec : sec);
  if (inHomeRegion) v -= f.nativeHomePenaltyPts;
  return v < 1 ? 1 : v > 100 ? 100 : v;
}

export interface FoundingFactors {
  habitability: number;
  site: number;
  supplies: number;
  colonists: number;
  natives: number;
  kit: number;
  /** Life Support research bonus in points; a placeholder 0 until M5. */
  research: number;
}

/**
 * Founding chance in whole percent = habitability x site x supplies x colonists x natives x kit
 * (each a percent), floored, times (100 + research bonus) / 100, at most 100. With neutral
 * colonists, natives and research it equals the product LoadoutMath.foundingOddsBand bounds, in
 * the same rounding, so the band contains it (tested).
 */
export function foundingChancePct(f: FoundingFactors): number {
  return foundingChanceOf(
    f.habitability,
    f.site,
    f.supplies,
    f.colonists,
    f.natives,
    f.kit,
    f.research,
  );
}

/** The same with positional arguments (no object, for the snapshot fill). */
export function foundingChanceOf(
  habitability: number,
  site: number,
  supplies: number,
  colonists: number,
  natives: number,
  kit: number,
  research: number,
): number {
  const base = habitability * site * supplies * colonists * natives * kit;
  const c = Math.floor((base * (100 + research)) / 1_000_000_000_000);
  return c > 100 ? 100 : c;
}

/** The founding kit factor for a number of kit steps (same as the odds band's). */
export function foundingKitFactorPct(kitSteps: number): number {
  return foundingKitPct(kitSteps);
}

/**
 * Tier of a founding roll (0..99): Thriving below chance x thrivingSharePct / 100, Struggling
 * below the chance, otherwise Failed. P(Thriving or Struggling) = chance.
 */
export function foundingTier(roll: number, chance: number): number {
  if (roll < Math.floor((chance * PF.founding.thrivingSharePct) / 100)) return FoundTier.Thriving;
  return roll < chance ? FoundTier.Struggling : FoundTier.Failed;
}

/** Founding kit factor in percent: base rising to 100 at the saturation step count (D-044). */
export function foundingKitPct(kitSteps: number): number {
  const f = LOADOUT.founding;
  const steps =
    kitSteps < 0 ? 0 : kitSteps > f.kitSaturationSteps ? f.kitSaturationSteps : kitSteps;
  return f.kitBasePct + Math.floor(((100 - f.kitBasePct) * steps) / f.kitSaturationSteps);
}

// ---- Food planning and the launch odds band ------------------------------------------------------

/**
 * Days of food per head left on arrival: supplies / colonists (floored) minus the trip. Negative
 * when the ship starves on the way. Nobody aboard counts as 0.
 */
export function arrivalFoodDays(supplies: number, passengers: number, eta: number): number {
  if (passengers <= 0) return 0;
  return Math.floor(supplies / passengers) - eta;
}

/**
 * The launch supply margin (supplies / (passengers x ETA), percent) at which the founding supplies
 * factor reaches 100 for the planned trip: food for the ETA, the ground days a typical
 * exploration takes (planGroundDays) and the reserve (reserveDays). Capped like the margin.
 */
export function foundingGradeMarginPct(eta: number): number {
  const days = eta < 1 ? 1 : eta;
  const f = PF.founding;
  const m = ceilDiv(100 * (days + f.planGroundDays + f.reserveDays), days);
  const cap = LOADOUT.supplyMarginCapPct;
  return m > cap ? cap : m;
}

/** Natives factor at founding, lowest over what the player cannot know yet (known -1 = unmet). */
export function nativesFoundingMin(known: number, guards: number): number {
  let best = 100;
  const from = known < 0 ? 0 : known;
  const to = known < 0 ? 3 : known;
  for (let d = from; d <= to; d++) {
    for (let home = 0; home < 2; home++) {
      for (let g = 0; g < 2; g++) {
        const v = nativesFoundingPct(d, home === 1, g === 0 ? 0 : guards);
        if (v < best) best = v;
      }
    }
  }
  return best;
}

/** The same, highest. */
export function nativesFoundingMax(known: number, guards: number): number {
  let best = 0;
  const from = known < 0 ? 0 : known;
  const to = known < 0 ? 3 : known;
  for (let d = from; d <= to; d++) {
    for (let home = 0; home < 2; home++) {
      for (let g = 0; g < 2; g++) {
        const v = nativesFoundingPct(d, home === 1, g === 0 ? 0 : guards);
        if (v > best) best = v;
      }
    }
  }
  return best;
}

export interface OddsBand {
  lo: number;
  hi: number;
}

const bandOut: OddsBand = { lo: 0, hi: 0 };

function bandCorner(
  hab: number,
  site: number,
  rem: number,
  c: number,
  nat: number,
  kit: number,
): void {
  const v = foundingChanceOf(
    clampPct(hab),
    site,
    supplyFactorPct(rem, c),
    colonistsFactorPct(c),
    nat,
    kit,
    0,
  );
  if (v < bandOut.lo) bandOut.lo = v;
  if (v > bandOut.hi) bandOut.hi = v;
}

/**
 * Founding odds band in whole percent for a loadout, from what the player knows at launch:
 * the habitability window, the survey level's site-quality band, the food left after the ETA,
 * the colonists carried, the kit steps and escort, and the natives (known = the disposition once
 * met, -1 while unmet, which spans None to Hostile at home or away). It is the min and max of the
 * founding chance over the corners of every range, so the real chance of a normal landing is
 * inside it: the low end allows for event delays (delayAllowancePct), planGroundDays on the ground,
 * a loss of bandColonistLossPct colonists and bandSupplyLossPct of supplies; the high end credits
 * the natives' gifts (bandGiftDays) and no ground time. It assumes all the kit and escort land
 * with the team (guards 0 to all are spanned for the natives factor). PLACEHOLDER shape; numbers in loadout.json and planetfall.json.
 */
export function foundingOddsBand(
  habLo: number,
  habHi: number,
  survey: number,
  supplies: number,
  passengers: number,
  security: number,
  eta: number,
  kitSteps: number,
  known: number,
): OddsBand {
  const lf = LOADOUT.founding;
  const f = PF.founding;
  const lvl =
    survey < 0 ? 0 : survey >= lf.siteQualityBands.length ? lf.siteQualityBands.length - 1 : survey;
  const siteLo = lf.siteQualityBands[lvl][0];
  const siteHi = lf.siteQualityBands[lvl][1];
  const kit = foundingKitPct(kitSteps);
  const days = eta < 1 ? 1 : eta;
  const people = passengers < 0 ? 0 : passengers;
  let remHi = supplies - people * days + people * f.bandGiftDays;
  if (remHi < 0) remHi = 0;
  const daysLo = ceilDiv(days * (100 + lf.delayAllowancePct), 100) + f.planGroundDays;
  let remLo = supplies - people * daysLo;
  if (remLo < 0) remLo = 0;
  remLo -= ceilDiv(remLo * f.bandSupplyLossPct, 100);
  const cHi = people;
  const cLo = people - ceilDiv(people * f.bandColonistLossPct, 100);
  const nLo = nativesFoundingMin(known, security);
  const nHi = nativesFoundingMax(known, security);
  bandOut.lo = 101;
  bandOut.hi = -1;
  for (let h = 0; h < 2; h++) {
    const hab = h === 0 ? habLo : habHi;
    for (let si = 0; si < 2; si++) {
      const site = si === 0 ? siteLo : siteHi;
      for (let r = 0; r < 2; r++) {
        const rem = r === 0 ? remLo : remHi;
        // The colonist count may land anywhere in [cLo, cHi]: ends, plus the count where the
        // supplies factor just reaches 100 (the product peaks there).
        const star = Math.floor(rem / f.reserveDays);
        for (let n = 0; n < 2; n++) {
          const nat = n === 0 ? nLo : nHi;
          bandCorner(hab, site, rem, cLo, nat, kit);
          bandCorner(hab, site, rem, cHi, nat, kit);
          if (star > cLo && star < cHi) bandCorner(hab, site, rem, star, nat, kit);
          if (star + 1 > cLo && star + 1 < cHi) bandCorner(hab, site, rem, star + 1, nat, kit);
        }
      }
    }
  }
  const lo = bandOut.lo > bandOut.hi ? bandOut.hi : bandOut.lo;
  return { lo, hi: bandOut.hi };
}
