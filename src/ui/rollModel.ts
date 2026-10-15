import {
  clampKind,
  explorationChancePct,
  explorationRawPct,
  FOUND_TIER_NAMES,
  foundingChanceOf,
  FoundTier,
  FR_COLONISTS,
  FR_HABITABILITY,
  FR_KIT,
  FR_NATIVES,
  FR_RESEARCH,
  FR_SITE,
  FR_SUPPLIES,
  FR_SURVIVORS,
  HAZARD_DEATH,
  HAZARD_INJURY,
  HAZARD_SUPPLIES,
  LAST_ROLL_SLOTS,
  LR_AMBUSH_CHANCE,
  LR_AMBUSH_HARM,
  LR_AMBUSH_ROLL,
  LR_BASE,
  LR_CHANCE,
  LR_CLAMPED,
  LR_DAY,
  LR_FIND,
  LR_HAZARD_AMOUNT,
  LR_HAZARD_CHANCE,
  LR_HAZARD_KIND,
  LR_HAZARD_ROLL,
  LR_KIND,
  LR_KITPCT,
  LR_NATIVESPCT,
  LR_RAW_CHANCE,
  LR_REGION,
  LR_RESULT,
  LR_ROLL,
  LR_SPLIT,
  LR_STANCEPCT,
  LR_STRIDE,
  LR_TEAM,
  LR_TEAM_SIZE,
  LR_TERRAIN,
  PF,
  STANCE_NAMES,
  foundingTier,
} from '../shared/planetfall';
import type { Snapshot } from '../shared/snapshot';
import { findLabel, terrainName } from '../shared/terrain';
import { regionName } from './planetRegions';

/**
 * Factor breakdowns of the exploration and founding rolls (pure). The same function lays out the
 * preview before a decision and the record of a roll afterwards, and always uses the shared
 * planetfall formulas, so the percent shown for each factor reproduces the chance exactly: the
 * running percent after each factor is the product so far, and the last one rounds down once.
 */

export interface BreakdownRow {
  label: string;
  /** The factor in percent, as text ("120%"). */
  value: string;
  /** The percentage after applying this factor and every one above it ("84.0%"). */
  running: string;
  /** Extra words for the factor ("guides", "raised to the minimum"), or ''. */
  note: string;
}

/** Percent with one decimal from a x10 integer: 756 gives "75.6%". */
export function percentX10(x10: number): string {
  return `${Math.floor(x10 / 10)}.${x10 % 10}%`;
}

/** Running products of percent factors, x10 and floored: running[k] = floor(10 x prod(0..k) / 100^k). */
export function runningPercentsX10(factors: readonly number[]): number[] {
  const out: number[] = [];
  let prod = 1;
  let div = 1;
  for (let k = 0; k < factors.length; k++) {
    prod *= factors[k];
    out.push(Math.floor((prod * 10) / div));
    div *= 100;
  }
  return out;
}

export interface ExplorationFactorInfo {
  terrain: string;
  explorers: number;
  kitSteps: number;
  stance: number;
  /** Words for the natives factor: "no natives met", "guides", "hostile ground"... */
  nativesNote: string;
}

export interface ExplorationBreakdown {
  rows: BreakdownRow[];
  /** The floored product before the clamp. */
  raw: number;
  clamp: number;
  clampText: string;
  chance: number;
}

export function clampText(kind: number): string {
  return kind === 1
    ? `Raised to the minimum of ${PF.successMinPct}%`
    : kind === 2
      ? `Lowered to the cap of ${PF.successMaxPct}%`
      : '';
}

/** Rows and totals of an exploration chance; `base`..`natives` are percents (100 neutral). */
export function explorationBreakdown(
  base: number,
  team: number,
  kit: number,
  stance: number,
  natives: number,
  info: ExplorationFactorInfo,
): ExplorationBreakdown {
  const factors = [base, team, kit, stance, natives];
  const run = runningPercentsX10(factors);
  const labels = [
    `Terrain base (${info.terrain})`,
    `Team size (${info.explorers} ${info.explorers === 1 ? 'explorer' : 'explorers'})`,
    `Survey kit (${info.kitSteps})`,
    `Stance (${STANCE_NAMES[info.stance] ?? 'Balanced'})`,
    'Natives',
  ];
  const notes = ['', '', '', '', info.nativesNote];
  const rows: BreakdownRow[] = factors.map((f, i) => ({
    label: labels[i],
    value: `${f}%`,
    running: percentX10(run[i]),
    note: notes[i],
  }));
  const raw = explorationRawPct(base, team, kit, stance, natives);
  const clamp = clampKind(raw);
  return {
    rows,
    raw,
    clamp,
    clampText: clampText(clamp),
    chance: explorationChancePct(base, team, kit, stance, natives),
  };
}

export interface FoundingFactorValues {
  habitability: number;
  site: number;
  supplies: number;
  colonists: number;
  natives: number;
  kit: number;
  research: number;
}

export interface FoundingBreakdown {
  rows: BreakdownRow[];
  chance: number;
}

export const FOUNDING_FACTOR_LABELS: readonly string[] = [
  'Habitability',
  'Site quality (explored regions and survey)',
  'Supplies for the reserve days',
  'Colonists (viable colony size)',
  'Natives',
  'Survey kit',
];

/** Rows of a founding chance with every factor and the research bonus (a placeholder 0 until M5). */
export function foundingBreakdown(f: FoundingFactorValues): FoundingBreakdown {
  const factors = [f.habitability, f.site, f.supplies, f.colonists, f.natives, f.kit];
  const run = runningPercentsX10(factors);
  const rows: BreakdownRow[] = factors.map((v, i) => ({
    label: FOUNDING_FACTOR_LABELS[i],
    value: `${v}%`,
    running: percentX10(run[i]),
    note: '',
  }));
  rows.push({
    label: 'Life Support research bonus',
    value: `+${f.research} points`,
    running: '',
    note: f.research === 0 ? 'none yet (research arrives later)' : '',
  });
  return {
    rows,
    chance: foundingChanceOf(
      f.habitability,
      f.site,
      f.supplies,
      f.colonists,
      f.natives,
      f.kit,
      f.research,
    ),
  };
}

// ---- Last roll records ---------------------------------------------------------------------------

export interface LastRollView {
  kind: 'exploration' | 'founding';
  slot: number;
  title: string;
  rows: BreakdownRow[];
  /** "Product of the factors: 58% (rounded down once)". */
  productText: string;
  clampText: string;
  chance: number;
  /** True when the factors recorded reproduce the recorded chance with the shared formulas. */
  verified: boolean;
  /** "Rolled 31 against 58%: success (a roll below 58 wins)". */
  rollLine: string;
  resultText: string;
  hazardText: string;
  ambushText: string;
  /** Success / Thriving / Struggling is true; Not explored / Failed is false. */
  good: boolean;
  /** One sentence for a screen reader (aria-live). */
  spoken: string;
}

function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function hazardLine(kind: number, chance: number, roll: number, amount: number): string {
  if (roll < 0) return 'Hazard: not rolled';
  const base = `Hazard: ${chance}% chance, rolled ${roll}`;
  if (kind === HAZARD_INJURY)
    return `${base}: hit. ${amount} ${pluralize(amount, 'explorer', 'explorers')} hurt`;
  if (kind === HAZARD_DEATH)
    return `${base}: hit. ${amount} ${pluralize(amount, 'explorer', 'explorers')} died`;
  if (kind === HAZARD_SUPPLIES) return `${base}: hit. ${amount} supplies lost`;
  return `${base}: no hazard`;
}

function ambushLine(chance: number, roll: number, harm: number): string {
  if (chance <= 0 || roll < 0) return 'Ambush: none possible here';
  return roll < chance
    ? `Ambush: ${chance}% chance, rolled ${roll}: ambushed. ${harm} ${pluralize(harm, 'explorer', 'explorers')} lost`
    : `Ambush: ${chance}% chance, rolled ${roll}: no ambush`;
}

/** The last-roll views of expedition row `row` (0 to 2 records, in slot order). Allocates. */
export function buildLastRolls(snap: Snapshot, row: number): LastRollView[] {
  const out: LastRollView[] = [];
  if (row < 0) return out;
  for (let slot = 0; slot < LAST_ROLL_SLOTS; slot++) {
    const o = (row * LAST_ROLL_SLOTS + slot) * LR_STRIDE;
    const r = snap.expeditionRolls;
    const kind = r[o + LR_KIND];
    if (kind === 1) out.push(explorationView(r, o, slot));
    else if (kind === 2) out.push(foundingView(r, o, slot));
  }
  return out;
}

function explorationView(r: ArrayLike<number>, o: number, slot: number): LastRollView {
  const base = r[o + LR_BASE];
  const team = r[o + LR_TEAM];
  const kit = r[o + LR_KITPCT];
  const stance = r[o + LR_STANCEPCT];
  const natives = r[o + LR_NATIVESPCT];
  const size = r[o + LR_TEAM_SIZE];
  const terrain = terrainName(r[o + LR_TERRAIN]);
  const natNote = natives > 100 ? 'guides help' : natives < 100 ? 'hostile ground' : 'no effect';
  const b = explorationBreakdown(base, team, kit, stance, natives, {
    terrain,
    explorers: size,
    kitSteps: 0,
    stance: stanceOfPct(stance),
    nativesNote: natNote,
  });
  // The kit row shows the recorded percent; the step count is not part of the record.
  b.rows[2].label = 'Survey kit';
  b.rows[3].label = `Stance (${STANCE_NAMES[stanceOfPct(stance)] ?? '?'})`;
  const chance = r[o + LR_CHANCE];
  const roll = r[o + LR_ROLL];
  const success = r[o + LR_RESULT] === 1;
  const verified =
    b.raw === r[o + LR_RAW_CHANCE] && b.chance === chance && b.clamp === r[o + LR_CLAMPED];
  const find = r[o + LR_FIND];
  const region = regionName(r[o + LR_REGION]);
  const split = r[o + LR_SPLIT] === 1;
  const rollLine = `Rolled ${roll} against ${chance}%: ${success ? 'success' : 'failure'} (a roll below ${chance} wins)`;
  const resultText = success
    ? `${region} explored.${findLabel(find) !== '' ? ` Find: ${findLabel(find)}.` : ''}`
    : `${region} not explored this round; try again.`;
  const hazardText = hazardLine(
    r[o + LR_HAZARD_KIND],
    r[o + LR_HAZARD_CHANCE],
    r[o + LR_HAZARD_ROLL],
    r[o + LR_HAZARD_AMOUNT],
  );
  const ambushText = ambushLine(
    r[o + LR_AMBUSH_CHANCE],
    r[o + LR_AMBUSH_ROLL],
    r[o + LR_AMBUSH_HARM],
  );
  return {
    kind: 'exploration',
    slot,
    title: `Last exploration roll: ${region} (${terrain}), day ${r[o + LR_DAY]}${split ? ', split team' : ''}`,
    rows: b.rows,
    productText: `Product of the factors: ${b.raw}% (rounded down once)`,
    clampText: b.clampText,
    chance,
    verified,
    rollLine,
    resultText,
    hazardText,
    ambushText,
    good: success,
    spoken: `${region}: ${rollLine}. ${resultText}`,
  };
}

/** Stance index whose success percent equals `pct` (the record stores the percent, not the id). */
export function stanceOfPct(pct: number): number {
  const i = PF.stances.successPct.indexOf(pct);
  return i < 0 ? 1 : i;
}

function foundingView(r: ArrayLike<number>, o: number, slot: number): LastRollView {
  const f: FoundingFactorValues = {
    habitability: r[o + FR_HABITABILITY],
    site: r[o + FR_SITE],
    supplies: r[o + FR_SUPPLIES],
    colonists: r[o + FR_COLONISTS],
    natives: r[o + FR_NATIVES],
    kit: r[o + FR_KIT],
    research: r[o + FR_RESEARCH],
  };
  const b = foundingBreakdown(f);
  const chance = r[o + LR_CHANCE];
  const roll = r[o + LR_ROLL];
  const tier = r[o + LR_RESULT];
  const thriving = Math.floor((chance * PF.founding.thrivingSharePct) / 100);
  const survivors = r[o + FR_SURVIVORS];
  const name = FOUND_TIER_NAMES[tier] ?? '?';
  const verified = b.chance === chance && foundingTier(roll, chance) === tier;
  const rollLine = `Rolled ${roll} against ${chance}%: ${name} (Thriving below ${thriving}, Struggling below ${chance}, otherwise Failed)`;
  const resultText =
    tier === FoundTier.Failed
      ? `Founding failed. ${survivors} ${pluralize(survivors, 'survivor is', 'survivors are')} stranded on the ground; re-embark to leave. The planet stays free.`
      : tier === FoundTier.Thriving
        ? `Thriving colony founded with ${survivors} people.`
        : `Struggling colony founded with ${survivors} people. It carries a penalty period and needs supplies from elsewhere.`;
  const region = regionName(r[o + LR_REGION]);
  return {
    kind: 'founding',
    slot,
    title: `Founding roll at ${region} (${terrainName(r[o + LR_TERRAIN])}), day ${r[o + LR_DAY]}`,
    rows: b.rows,
    productText: `Chance: ${chance}% (product of the six factors, plus research points, capped at 100)`,
    clampText: '',
    chance,
    verified,
    rollLine,
    resultText,
    hazardText: '',
    ambushText: '',
    good: tier !== FoundTier.Failed,
    spoken: `Founding at ${region}: ${rollLine}. ${resultText}`,
  };
}
