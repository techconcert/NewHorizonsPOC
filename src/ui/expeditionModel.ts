import type { ExploreRegionCommand, ReEmbarkCommand } from '../shared/commands';
import {
  ambushChancePct,
  Disp,
  ExpeditionStatus,
  exploreKitPct,
  hazardChancePct,
  nativesExplorePct,
  PF,
  STANCE_NAMES,
  stanceRegionsPerRound,
  stanceRoundDays,
  stanceSuccessPct,
  teamSizePct,
  terrainBasePct,
} from '../shared/planetfall';
import { isParkedState } from '../shared/planetSnapshot';
import {
  EXPEDITION_STRIDE,
  X_DEPOT_COLONISTS,
  X_DEPOT_SUPPLIES,
  X_ENTITY,
  X_EXPLORED,
  X_EXPLORERS,
  X_FOUND_HI,
  X_FOUND_LO,
  X_GUARDS,
  X_KIT,
  X_REGION_COUNT,
  X_ROUND,
  X_ROUND_DAY,
  X_ROUND_LEN,
  X_STANCE,
  X_STATUS,
  X_SUPPLIES,
  X_TARGET,
  X_TARGET2,
  X_WOUNDED,
  X_DELAY,
  type Snapshot,
} from '../shared/snapshot';
import { TERRAIN_HAZARD_LEVEL, terrainName } from '../shared/terrain';
import { foodCue, type FoodCue } from './formationModel';
import { FOG_EXPLORED } from '../shared/fog';
import { isFrontier, regionName } from './planetRegions';
import { explorationBreakdown, type BreakdownRow } from './rollModel';

/**
 * Pure models of the exploration panel: the status of the expedition on the ground, the plan of
 * the next round (which regions, one team, Bold's two regions or a split) with the chance of
 * every region before the player commits, and the re-embark offer. The rules mirror the sim's
 * ExploreRegion check (frontier regions only, a distinct second region, enough explorers to
 * split) so the button is only enabled for a command the sim will accept.
 */

const SPLIT_MIN_EXPLORERS = 2 * PF.minExplorersPerTeam;

export const NATIVE_HOME_NOTE = 'Odds may change if this region is a native home.';

/**
 * True when expedition row `row` could split its team now: idle on the ground, a non-Bold stance,
 * enough healthy explorers and two regions next to explored land. Mirrors ExplorePlan.canSplit.
 */
export function splitAvailable(snap: Snapshot, planet: number, row: number): boolean {
  if (row < 0) return false;
  const o = row * EXPEDITION_STRIDE;
  const x = snap.expeditions;
  if (x[o + X_STATUS] !== ExpeditionStatus.Active || x[o + X_TARGET] >= 0) return false;
  if (stanceRegionsPerRound(x[o + X_STANCE]) === 2) return false;
  if (x[o + X_EXPLORERS] < SPLIT_MIN_EXPLORERS) return false;
  const start = snap.planetRegionStart[planet];
  const n = snap.planetRegionCount[planet];
  let c = 0;
  for (let i = 0; i < n; i++) if (isFrontier(snap.regionFog[start + i])) c++;
  return c >= 2;
}

export const STATUS_LABELS: Record<number, string> = {
  [ExpeditionStatus.None]: 'No expedition',
  [ExpeditionStatus.Active]: 'On the ground',
  [ExpeditionStatus.Stranded]: 'Stranded: the founding failed',
  [ExpeditionStatus.Founded]: 'Colony founded',
  [ExpeditionStatus.Dead]: 'Lost: nobody survived',
  [ExpeditionStatus.Returned]: 'Back aboard the ship',
  [ExpeditionStatus.Event]: 'Waiting on an event card',
};

export interface ExpeditionStatusView {
  entity: number;
  status: number;
  statusLabel: string;
  live: boolean;
  /** On the ground, no round out, no card waiting: ready for orders. */
  idle: boolean;
  explorers: number;
  wounded: number;
  guards: number;
  supplies: number;
  kit: number;
  stanceName: string;
  foodDays: number;
  foodText: string;
  foodCue: FoodCue;
  roundText: string;
  progressPct: number;
  exploredText: string;
  teamText: string;
  depotText: string;
  oddsText: string;
}

/** Status of expedition row `row`, or null for a negative row. Allocates. */
export function buildExpeditionStatus(snap: Snapshot, row: number): ExpeditionStatusView | null {
  if (row < 0) return null;
  const o = row * EXPEDITION_STRIDE;
  const x = snap.expeditions;
  const status = x[o + X_STATUS];
  const explorers = x[o + X_EXPLORERS];
  const wounded = x[o + X_WOUNDED];
  const supplies = x[o + X_SUPPLIES];
  const stance = x[o + X_STANCE];
  const heads = explorers + wounded;
  const foodDays = heads > 0 ? Math.floor(supplies / heads) : 0;
  const cue = foodCue(foodDays, stance);
  const live =
    status === ExpeditionStatus.Active ||
    status === ExpeditionStatus.Stranded ||
    status === ExpeditionStatus.Event;
  const target = x[o + X_TARGET];
  const idle = status === ExpeditionStatus.Active && target < 0;
  const roundDay = x[o + X_ROUND_DAY];
  const roundLen = x[o + X_ROUND_LEN];
  let roundText: string;
  if (status === ExpeditionStatus.Event) {
    roundText = 'The expedition stands still until you answer the event card.';
  } else if (status === ExpeditionStatus.Stranded) {
    roundText = 'Stranded: only re-embarking is possible.';
  } else if (status !== ExpeditionStatus.Active) {
    roundText = STATUS_LABELS[status] ?? '';
  } else if (target >= 0) {
    const delay = x[o + X_DELAY];
    roundText = `Exploring ${regionName(target)}${x[o + X_TARGET2] >= 0 ? ` and ${regionName(x[o + X_TARGET2])}` : ''}: day ${roundDay} of ${roundLen}${delay > 0 ? ` (delayed ${delay} days)` : ''}`;
  } else {
    roundText = 'Waiting for orders.';
  }
  const odds =
    x[o + X_FOUND_LO] === x[o + X_FOUND_HI]
      ? `${x[o + X_FOUND_LO]}%`
      : `${x[o + X_FOUND_LO]} to ${x[o + X_FOUND_HI]}%`;
  return {
    entity: x[o + X_ENTITY],
    status,
    statusLabel: STATUS_LABELS[status] ?? '',
    live,
    idle,
    explorers,
    wounded,
    guards: x[o + X_GUARDS],
    supplies,
    kit: x[o + X_KIT],
    stanceName: STANCE_NAMES[stance] ?? '',
    foodDays,
    foodText: `${foodDays} days of food per head [${cue}]`,
    foodCue: cue,
    roundText,
    progressPct:
      target >= 0 && roundLen > 0 ? Math.min(100, Math.floor((roundDay * 100) / roundLen)) : 0,
    exploredText: `${x[o + X_EXPLORED]} of ${x[o + X_REGION_COUNT]} regions explored, ${x[o + X_ROUND]} rounds done`,
    teamText: `${explorers} explorers${wounded > 0 ? `, ${wounded} wounded` : ''}, ${x[o + X_GUARDS]} escort, ${supplies} supplies, ${x[o + X_KIT]} kits`,
    depotText: `Ship in orbit holds ${x[o + X_DEPOT_COLONISTS]} colonists and ${x[o + X_DEPOT_SUPPLIES]} supplies`,
    oddsText: live ? `Founding odds right now: ${odds}` : '',
  };
}

// ---- Exploration plan ------------------------------------------------------------------------------

export interface TeamPreview {
  label: string;
  region: number;
  terrain: string;
  explorers: number;
  rows: BreakdownRow[];
  chance: number;
  clampText: string;
  hazardText: string;
  ambushText: string;
  /** Shown while no native contact exists: a native home region would change the odds. */
  nativeNote: string;
}

export type ExploreMode = 'none' | 'single' | 'bold' | 'split';

export interface ExplorePlan {
  mode: ExploreMode;
  /** Why Confirm cannot be pressed, or null. */
  problem: string | null;
  command: ExploreRegionCommand | null;
  previews: TeamPreview[];
  summary: string;
  /** Frontier regions the player may name as the second region (never the first one). */
  region2Options: number[];
  /** Balanced and Cautious teams may split when there are explorers and regions for two teams. */
  canSplit: boolean;
  /** Why a split is not offered, or ''. */
  splitProblem: string;
  /** Bold with no second region named. */
  autoNote: string;
  bold: boolean;
}

function emptyPlan(problem: string | null): ExplorePlan {
  return {
    mode: 'none',
    problem,
    command: null,
    previews: [],
    summary: '',
    region2Options: [],
    canSplit: false,
    splitProblem: '',
    autoNote: '',
    bold: false,
  };
}

/** Why a region cannot be explored, or null when it is a frontier region. */
export function exploreTargetProblem(fog: number): string | null {
  if (fog === FOG_EXPLORED) return 'That region is already explored.';
  if (isFrontier(fog)) return null;
  return 'That region is not next to explored land. Pick a region marked Seen.';
}

function previewRegion(
  snap: Snapshot,
  planet: number,
  row: number,
  local: number,
  size: number,
  split: boolean,
  label: string,
): TeamPreview | null {
  const o = row * EXPEDITION_STRIDE;
  const g = snap.planetRegionStart[planet] + local;
  const terrain = snap.regionTerrain[g];
  if (terrain >= TERRAIN_HAZARD_LEVEL.length) return null;
  const stance = snap.expeditions[o + X_STANCE];
  const disp = snap.planetNative[planet];
  const met = disp > 0;
  const home = snap.regionNative[g] === 1;
  const natives = nativesExplorePct(disp, met, home);
  const kitSteps = snap.expeditions[o + X_KIT];
  const b = explorationBreakdown(
    terrainBasePct(terrain),
    teamSizePct(size),
    exploreKitPct(kitSteps),
    stanceSuccessPct(stance),
    natives,
    {
      terrain: terrainName(terrain),
      explorers: size,
      kitSteps,
      stance,
      nativesNote: !met
        ? 'no contact yet'
        : natives > 100
          ? 'guides help'
          : natives < 100
            ? 'hostile ground'
            : 'no effect',
    },
  );
  const level = TERRAIN_HAZARD_LEVEL[terrain];
  let hazardText: string;
  if (level === 0) {
    const a = hazardChancePct(1, stance, split);
    const c = hazardChancePct(3, stance, split);
    hazardText = `Hazard: ${a} to ${c}% (Variable terrain: the level is rolled)${split ? ', split team x1.5' : ''}`;
  } else {
    hazardText = `Hazard: ${hazardChancePct(level, stance, split)}% chance of injury, death or lost supplies${split ? ' (split team x1.5)' : ''}`;
  }
  let ambushText = '';
  if (met && home) {
    const a = ambushChancePct(disp, snap.planetNativeStrength[planet]);
    ambushText =
      a > 0
        ? `Ambush risk: ${a}% (native home region, hostile natives; escort reduces the harm)`
        : disp === Disp.Wary
          ? 'Native home region: the wary natives only watch (no ambush)'
          : 'Native home region: peaceful natives, no ambush';
  }
  return {
    label,
    region: local,
    terrain: terrainName(terrain),
    explorers: size,
    rows: b.rows,
    chance: b.chance,
    clampText: b.clampText,
    hazardText,
    ambushText,
    nativeNote: met ? '' : NATIVE_HOME_NOTE,
  };
}

/**
 * The plan for the next round. `region2` -1 means none (or, for Bold, the sim picks the second
 * region); `split` asks for two teams (ignored for Bold, which already rolls two regions with the
 * whole team). Allocates; call when the selection or the snapshot changes.
 */
export function buildExplorePlan(
  snap: Snapshot,
  planet: number,
  row: number,
  region: number,
  region2: number,
  split: boolean,
): ExplorePlan {
  if (row < 0) return emptyPlan('No expedition is on the ground.');
  const o = row * EXPEDITION_STRIDE;
  const x = snap.expeditions;
  const status = x[o + X_STATUS];
  if (status === ExpeditionStatus.Event) return emptyPlan('Answer the event card first.');
  if (status === ExpeditionStatus.Stranded)
    return emptyPlan('Stranded: re-embark to leave this planet.');
  if (status !== ExpeditionStatus.Active) return emptyPlan('This expedition is over.');
  if (x[o + X_TARGET] >= 0) return emptyPlan('A round is under way. Wait for it to finish.');
  const explorers = x[o + X_EXPLORERS];
  if (explorers < 1) return emptyPlan('No healthy explorers are left to send.');
  const start = snap.planetRegionStart[planet];
  const n = snap.planetRegionCount[planet];
  const stance = x[o + X_STANCE];
  const bold = stanceRegionsPerRound(stance) === 2;
  const frontier: number[] = [];
  for (let i = 0; i < n; i++) if (isFrontier(snap.regionFog[start + i])) frontier.push(i);

  const base = emptyPlan(null);
  base.bold = bold;
  base.region2Options = frontier.filter((i) => i !== region);
  base.canSplit = !bold && explorers >= SPLIT_MIN_EXPLORERS && frontier.length >= 2;
  base.splitProblem = bold
    ? 'Bold already explores two regions a round with the whole team.'
    : explorers < SPLIT_MIN_EXPLORERS
      ? `A split needs at least ${SPLIT_MIN_EXPLORERS} healthy explorers.`
      : frontier.length < 2
        ? 'A split needs two regions next to explored land.'
        : '';

  if (region < 0 || region >= n) {
    base.problem = 'Pick a region next to explored land on the map or in the list.';
    return base;
  }
  const targetProblem = exploreTargetProblem(snap.regionFog[start + region]);
  if (targetProblem !== null) {
    base.problem = targetProblem;
    return base;
  }

  let second = -1;
  if (region2 >= 0) {
    if (region2 === region) {
      base.problem = 'The second region must be a different region.';
      return base;
    }
    const p2 =
      region2 < n
        ? exploreTargetProblem(snap.regionFog[start + region2])
        : 'That region does not exist.';
    if (p2 !== null) {
      base.problem = `Second region: ${p2}`;
      return base;
    }
    second = region2;
  }

  const roundDays = stanceRoundDays(stance);
  if (bold) {
    base.mode = 'bold';
    const p1 = previewRegion(
      snap,
      planet,
      row,
      region,
      explorers,
      false,
      `${regionName(region)} (whole team)`,
    );
    if (p1) base.previews.push(p1);
    if (second >= 0) {
      const p2 = previewRegion(
        snap,
        planet,
        row,
        second,
        explorers,
        false,
        `${regionName(second)} (whole team)`,
      );
      if (p2) base.previews.push(p2);
    } else {
      base.autoNote =
        'No second region named: the simulation picks the lowest other region next to explored land that is not a native home. If every such region is a native home it takes the lowest of them, and if there is none the team explores one region.';
    }
    base.summary = `Bold: ${roundDays} days, two regions rolled with the whole team, double hazard.`;
    base.command = { type: 'ExploreRegion', expedition: x[o + X_ENTITY], region, region2: second };
    return base;
  }

  if (split) {
    if (!base.canSplit) {
      base.problem = base.splitProblem;
      return base;
    }
    if (second < 0) {
      base.problem = 'Pick the second region for the other half of the team.';
      return base;
    }
    base.mode = 'split';
    const sizeA = Math.ceil(explorers / 2);
    const sizeB = explorers - sizeA;
    const pa = previewRegion(
      snap,
      planet,
      row,
      region,
      sizeA,
      true,
      `${regionName(region)} (team of ${sizeA})`,
    );
    const pb = previewRegion(
      snap,
      planet,
      row,
      second,
      sizeB,
      true,
      `${regionName(second)} (team of ${sizeB})`,
    );
    if (pa) base.previews.push(pa);
    if (pb) base.previews.push(pb);
    base.summary = `Split: ${roundDays} days, two teams explore at once. Faster, but hazard is x${PF.splitHazardPct / 100} and each small team has a lower chance.`;
    base.command = { type: 'ExploreRegion', expedition: x[o + X_ENTITY], region, region2: second };
    return base;
  }

  base.mode = 'single';
  const p = previewRegion(snap, planet, row, region, explorers, false, regionName(region));
  if (p) base.previews.push(p);
  base.summary = `${STANCE_NAMES[stance]}: ${roundDays} days, one region.`;
  base.command = { type: 'ExploreRegion', expedition: x[o + X_ENTITY], region, region2: -1 };
  return base;
}

// ---- Re-embark ---------------------------------------------------------------------------------------

export interface ReEmbarkView {
  available: boolean;
  /** Why the button is off, or ''. */
  problem: string;
  /** What comes back aboard. */
  text: string;
  command: ReEmbarkCommand | null;
}

/** The re-embark offer for expedition row `row` and the ship row it lifts off with (-1 if gone). */
export function buildReEmbarkView(snap: Snapshot, row: number, shipRow: number): ReEmbarkView {
  const none: ReEmbarkView = { available: false, problem: '', text: '', command: null };
  if (row < 0) return none;
  const o = row * EXPEDITION_STRIDE;
  const x = snap.expeditions;
  const status = x[o + X_STATUS];
  if (status !== ExpeditionStatus.Active && status !== ExpeditionStatus.Stranded) {
    return none;
  }
  const people = x[o + X_EXPLORERS] + x[o + X_WOUNDED];
  const text = `Re-embark: ${people} people, ${x[o + X_GUARDS]} escort, ${x[o + X_SUPPLIES]} supplies and ${x[o + X_KIT]} kits go back aboard. The ship stays in orbit${shipRow >= 0 ? ` with ${snap.shipFuel[shipRow]} fuel` : ''}; then you can land again or reroute it.`;
  let problem = '';
  if (x[o + X_TARGET] >= 0) problem = 'A round is under way. Wait for it to finish.';
  else if (shipRow < 0) problem = 'The ship was lost, so the survivors cannot re-embark.';
  else if (!isParkedState(snap.shipState[shipRow])) problem = 'The ship is not in orbit.';
  return {
    available: problem === '',
    problem,
    text,
    command: problem === '' ? { type: 'ReEmbark', expedition: x[o + X_ENTITY] } : null,
  };
}
