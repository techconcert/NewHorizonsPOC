import { WIN_COLONIES, WIN_HOLD_DAYS } from '../shared/colony';
import {
  META_HOME_DAYS,
  META_TECH_CURRENT,
  META_TECH_PROGRESS,
  META_WIN_STREAK,
  type Snapshot,
} from '../shared/snapshot';
import { TECH_COUNT, TECH_NAMES, techProgressPct } from '../shared/research';
import { colonySummary } from './colonyModel';

/**
 * Short HUD labels for screens under SHORT_LABEL_WIDTH_PX (pure). The full sentence stays the
 * tooltip and the wide-screen text; these keep the top bar from cutting anything important.
 */

/** Below this viewport width the top bar shows the short labels (CSS media query uses the same number). */
export const SHORT_LABEL_WIDTH_PX = 1500;

export function clockShort(snap: Snapshot): string {
  return `Home: ${snap.meta[META_HOME_DAYS]}d`;
}

export function colonyShort(snap: Snapshot): string {
  return `Colonies ${colonySummary(snap).count}/${WIN_COLONIES}`;
}

export function researchShort(snap: Snapshot): string {
  const cur = snap.meta[META_TECH_CURRENT];
  if (cur < 0 || cur >= TECH_COUNT) return 'Tech: none';
  return `Tech: ${TECH_NAMES[cur]} ${techProgressPct(cur, snap.meta[META_TECH_PROGRESS])}%`;
}

export function goalShort(snap: Snapshot): string {
  const streak = snap.meta[META_WIN_STREAK];
  return streak > 0 ? `Goal ${streak}/${WIN_HOLD_DAYS}d` : `Goal: hold ${WIN_COLONIES}`;
}
