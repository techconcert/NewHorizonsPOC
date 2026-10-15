import type { FoundColonyCommand } from '../shared/commands';
import {
  colonistsFactorPct,
  ExpeditionStatus,
  foundingChanceOf,
  nativesFoundingMax,
  nativesFoundingMin,
  nativeKindText,
  nativesFoundingPct,
  PF,
  siteQualityPct,
  siteScore,
  supplyFactorPct,
} from '../shared/planetfall';
import {
  EXPEDITION_STRIDE,
  X_ENTITY,
  X_EXPLORED,
  X_EXPLORERS,
  X_GUARDS,
  X_KIT_PCT,
  X_LANDED,
  X_LANDED_SUPPLIES,
  X_REGION_COUNT,
  X_STATUS,
  X_TARGET,
  X_WOUNDED,
  type Snapshot,
} from '../shared/snapshot';
import { findLabel, terrainName } from '../shared/terrain';
import { FOG_EXPLORED } from '../shared/fog';
import { regionName } from './planetRegions';
import {
  FOUNDING_FACTOR_LABELS,
  percentX10,
  runningPercentsX10,
  type BreakdownRow,
} from './rollModel';

/**
 * Pure model of the "Found colony" panel. Before the player commits it shows every factor of the
 * founding roll for the chosen site, the resulting chance (a range while the habitability and the
 * natives are only partly known), the three outcome tiers with their odds and what each one means.
 * The numbers use the same shared functions as the sim and the snapshot's founding preview.
 */

export interface TierView {
  name: 'Thriving' | 'Struggling' | 'Failed';
  /** Odds in whole percent at the low and high end of the chance range. */
  oddsLo: number;
  oddsHi: number;
  oddsText: string;
  consequence: string;
}

export interface FoundingView {
  /** Site region, or -1. */
  region: number;
  siteText: string;
  rows: BreakdownRow[];
  chanceLo: number;
  chanceHi: number;
  chanceText: string;
  tiers: TierView[];
  /** Why Found cannot be pressed, or null. */
  problem: string | null;
  command: FoundColonyCommand | null;
}

function range(lo: number, hi: number): string {
  return lo === hi ? `${lo}%` : `${lo} to ${hi}%`;
}

function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/** The tier odds for a chance: Thriving below the share of it, Struggling up to it, else Failed. */
export function tierOdds(chance: number): { thriving: number; struggling: number; failed: number } {
  const thriving = Math.floor((chance * PF.founding.thrivingSharePct) / 100);
  return { thriving, struggling: chance - thriving, failed: 100 - chance };
}

/**
 * Build the founding view for expedition row `row` on `planet` with the site `region` (local
 * index; any region, the problem field says if it cannot be used). Allocates.
 */
export function buildFoundingView(
  snap: Snapshot,
  planet: number,
  row: number,
  region: number,
): FoundingView {
  const empty: FoundingView = {
    region,
    siteText: '',
    rows: [],
    chanceLo: 0,
    chanceHi: 0,
    chanceText: '',
    tiers: [],
    problem: null,
    command: null,
  };
  if (row < 0) {
    empty.problem = 'No expedition is on the ground.';
    return empty;
  }
  const o = row * EXPEDITION_STRIDE;
  const x = snap.expeditions;
  const status = x[o + X_STATUS];
  const n = snap.planetRegionCount[planet];
  if (status === ExpeditionStatus.Event) empty.problem = 'Answer the event card first.';
  else if (status === ExpeditionStatus.Stranded)
    empty.problem = 'Stranded: the founding failed. Re-embark to leave.';
  else if (status !== ExpeditionStatus.Active) empty.problem = 'This expedition is over.';
  else if (snap.planetOwned[planet] !== 0) empty.problem = 'A colony already holds this planet.';
  else if (x[o + X_TARGET] >= 0) empty.problem = 'A round is under way. Wait for it to finish.';
  // Stranded or finished expeditions have no founding to preview.
  if (status !== ExpeditionStatus.Active && status !== ExpeditionStatus.Event) return empty;
  if (region < 0 || region >= n) {
    empty.problem = empty.problem ?? 'Pick an explored region as the site.';
    return empty;
  }
  const start = snap.planetRegionStart[planet];
  const g = start + region;
  if (snap.regionFog[g] !== FOG_EXPLORED) {
    empty.siteText = regionName(region);
    empty.problem = empty.problem ?? 'Found a colony only in an explored region.';
    return empty;
  }

  const find = snap.regionFind[g];
  const survey = snap.planetSurvey[planet];
  const explored = x[o + X_EXPLORED];
  const regions = x[o + X_REGION_COUNT];
  const site = siteQualityPct(siteScore(find === 255 ? -1 : find, explored, regions), survey);
  const landed = x[o + X_LANDED];
  const supplies = supplyFactorPct(x[o + X_LANDED_SUPPLIES], landed);
  const colonists = colonistsFactorPct(landed);
  const kit = x[o + X_KIT_PCT];
  const guards = x[o + X_GUARDS];
  const disp = snap.planetNative[planet];
  const met = disp > 0;
  const variant = snap.planetNativeVariant[planet];
  const home = snap.regionNative[g] === 1;
  const natLo = met ? nativesFoundingPct(disp, home, guards) : nativesFoundingMin(-1, guards);
  const natHi = met ? natLo : nativesFoundingMax(-1, guards);
  const habLo = snap.planetHabLo[planet];
  const habHi = snap.planetHabHi[planet];
  const research = 0;
  const lo = foundingChanceOf(habLo, site, supplies, colonists, natLo, kit, research);
  const hi = foundingChanceOf(habHi, site, supplies, colonists, natHi, kit, research);

  // Rows: the low-end running percents (the chance range is shown below them).
  const factorsLo = [habLo, site, supplies, colonists, natLo, kit];
  const runLo = runningPercentsX10(factorsLo);
  const runHi = runningPercentsX10([habHi, site, supplies, colonists, natHi, kit]);
  const values = [
    range(habLo, habHi),
    `${site}%`,
    `${supplies}%`,
    `${colonists}%`,
    range(natLo, natHi),
    `${kit}%`,
  ];
  const notes = [
    habLo === habHi ? '' : 'known range only; the true value is inside it',
    `${findLabel(find) || 'no find'} here, ${explored} of ${regions} regions explored, survey level ${survey}`,
    `${x[o + X_LANDED_SUPPLIES]} supplies for ${landed} people against ${PF.founding.reserveDays} reserve days each`,
    `${landed} people settle; full strength from ${PF.founding.viableColonists}`,
    met
      ? home
        ? `${nativeKindText(disp, variant)} met; this is their home region`
        : `${nativeKindText(disp, variant)} met`
      : 'natives not met yet: the range allows for every disposition',
    '',
  ];
  const rows: BreakdownRow[] = factorsLo.map((_, i) => ({
    label: FOUNDING_FACTOR_LABELS[i],
    value: values[i],
    running:
      runLo[i] === runHi[i]
        ? percentX10(runLo[i])
        : `${percentX10(runLo[i])} to ${percentX10(runHi[i])}`,
    note: notes[i],
  }));
  rows.push({
    label: 'Life Support research bonus',
    value: `+${research} points`,
    running: '',
    note: 'none yet (research arrives later)',
  });

  const pop = landed + guards;
  const group = x[o + X_EXPLORERS] + x[o + X_WOUNDED];
  const loss = Math.min(group, ceilDiv(group * PF.founding.failedLossPct, 100));
  const oddsLo = tierOdds(lo);
  const oddsHi = tierOdds(hi);
  const tiers: TierView[] = [
    {
      name: 'Thriving',
      oddsLo: oddsLo.thriving,
      oddsHi: oddsHi.thriving,
      oddsText: range(oddsLo.thriving, oddsHi.thriving),
      consequence: `A full colony: ${pop} people and ${x[o + X_LANDED_SUPPLIES]} supplies settle here, with bonus growth. The planet becomes yours.`,
    },
    {
      name: 'Struggling',
      oddsLo: oddsLo.struggling,
      oddsHi: oddsHi.struggling,
      oddsText: range(oddsLo.struggling, oddsHi.struggling),
      consequence: `A weak colony: ${pop} people settle, but it suffers a ${PF.founding.strugglingPenaltyDays} day penalty period and needs supplies from elsewhere.`,
    },
    {
      name: 'Failed',
      oddsLo: oddsLo.failed,
      oddsHi: oddsHi.failed,
      oddsText: range(oddsLo.failed, oddsHi.failed),
      consequence: `No colony. About ${loss} of the ${group} people on the ground die; the survivors are stranded until you re-embark. The planet stays free, but the supplies spent are gone.`,
    },
  ];

  const result: FoundingView = {
    region,
    siteText: `${regionName(region)} (${terrainName(snap.regionTerrain[g])}${findLabel(find) ? `, ${findLabel(find)}` : ''})`,
    rows,
    chanceLo: lo,
    chanceHi: hi,
    chanceText: range(lo, hi),
    tiers,
    problem: empty.problem,
    command: null,
  };
  if (result.problem === null) {
    result.command = { type: 'FoundColony', expedition: x[o + X_ENTITY], region };
  }
  return result;
}
