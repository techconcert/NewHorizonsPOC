import type { ChooseTechCommand } from '../shared/commands';
import {
  hasTech,
  knownTechCount,
  TECH_BRANCH,
  TECH_BRANCHES,
  TECH_COST,
  TECH_COUNT,
  TECH_NAMES,
  TECH_PREREQ,
  TECH_TEXT,
  techDaysLeft,
  techProgressPct,
  techRejection,
} from '../shared/research';
import {
  META_RESEARCH_RATE,
  META_TECH_CURRENT,
  META_TECH_MASK,
  META_TECH_PROGRESS,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Pure view model of the tech panel (M5): ten techs in three branches. Each row says whether the
 * tech is known, being researched, open to pick or locked behind another tech. The button text is
 * 'Research <Tech name>' and stays stable (the smoke script clicks it by text).
 */

export type TechState = 'known' | 'current' | 'open' | 'locked';

export interface TechRow {
  tech: number;
  name: string;
  branch: string;
  state: TechState;
  /** Status line: "Known", "Researching: 40%, 12 days left", "Cost 600", "Needs Ion Drive". */
  status: string;
  text: string;
  buttonLabel: string;
  /** True when choosing this tech throws away progress on the current one (a second press confirms). */
  needsConfirm: boolean;
  canChoose: boolean;
  command: ChooseTechCommand | null;
}

export interface TechView {
  summary: string;
  rate: number;
  rows: TechRow[];
}

/** One line for the HUD: what is being researched, how far, how fast. */
export function researchSummary(snap: Snapshot): string {
  const cur = snap.meta[META_TECH_CURRENT];
  const rate = snap.meta[META_RESEARCH_RATE];
  const known = knownTechCount(snap.meta[META_TECH_MASK]);
  const head = `Research: ${known} of ${TECH_COUNT} techs`;
  if (cur < 0 || cur >= TECH_COUNT) return `${head}, no tech chosen (${rate} points a day)`;
  const progress = snap.meta[META_TECH_PROGRESS];
  return `${head}, ${TECH_NAMES[cur]} ${techProgressPct(cur, progress)}% (${rate} points a day)`;
}

export function buildTechView(snap: Snapshot, armed = -1): TechView {
  const mask = snap.meta[META_TECH_MASK];
  const cur = snap.meta[META_TECH_CURRENT];
  const progress = snap.meta[META_TECH_PROGRESS];
  const rate = snap.meta[META_RESEARCH_RATE];
  const rows: TechRow[] = [];
  for (let t = 0; t < TECH_COUNT; t++) {
    let state: TechState;
    let status: string;
    if (hasTech(mask, t)) {
      state = 'known';
      status = 'Known';
    } else if (t === cur) {
      state = 'current';
      const left = techDaysLeft(t, progress, rate);
      status = `Researching: ${techProgressPct(t, progress)}% of ${TECH_COST[t]}${left >= 0 ? `, ${left} days left` : ', no research output'}`;
    } else if (techRejection(mask, t) === 'TECH_LOCKED') {
      state = 'locked';
      status = `Needs ${TECH_NAMES[TECH_PREREQ[t]]} first`;
    } else {
      state = 'open';
      status = `Cost ${TECH_COST[t]} points${progress > 0 && cur >= 0 ? '. Switching restarts the points' : ''}`;
    }
    const canChoose = state === 'open';
    const needsConfirm = canChoose && progress > 0 && cur >= 0 && cur !== t;
    rows.push({
      tech: t,
      name: TECH_NAMES[t],
      branch: TECH_BRANCHES[TECH_BRANCH[t]] ?? '',
      state,
      status,
      text: TECH_TEXT[t],
      buttonLabel:
        needsConfirm && armed === t
          ? `Confirm: switch research to ${TECH_NAMES[t]}`
          : `Research ${TECH_NAMES[t]}`,
      needsConfirm,
      canChoose,
      command: canChoose ? { type: 'ChooseTech', tech: t } : null,
    });
  }
  return { summary: researchSummary(snap), rate, rows };
}
