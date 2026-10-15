import { applyQueuedCommands } from './commands';
import { hashState } from './hash';
import {
  cleanupSystem,
  clockSystem,
  colonyEconomySystem,
  commandSystem,
  eventRollSystem,
  expeditionSystem,
  nativeSystem,
  researchSystem,
  supplySystem,
  surveySystem,
  travelSystem,
  winLoseSystem,
} from './systems';
import type { World } from './world';

/** Run one game day. Allocation-free by construction. */
export function tickDay(w: World): void {
  commandSystem(w);
  clockSystem(w);
  travelSystem(w);
  supplySystem(w);
  eventRollSystem(w);
  surveySystem(w);
  expeditionSystem(w);
  nativeSystem(w);
  colonyEconomySystem(w);
  researchSystem(w);
  winLoseSystem(w);
  cleanupSystem(w);
  hashState(w.stores);
}

/**
 * Drain the command queue at the current day without advancing the clock, then refresh the
 * hash. Needed while paused (speed 0), when no tick runs. Log entries keep the current day.
 */
export function applyCommandsNow(w: World): void {
  applyQueuedCommands(w);
  hashState(w.stores);
}

/** Real milliseconds per game day at 1x. */
export const MS_PER_DAY_AT_1X = 1000;
/** Cap on days run per advanceReal call, so a long stall cannot trigger a spiral of death. */
export const MAX_DAYS_PER_ADVANCE = 8;

/** Fixed-step accumulator. The caller supplies elapsed time; sim code never reads a clock. */
export interface StepAccumulator {
  ms: number;
}

export function createAccumulator(): StepAccumulator {
  return { ms: 0 };
}

/**
 * Convert real milliseconds into whole game days at the world's current speed (0, 1x, 2x, 4x)
 * and tick them. Returns the number of days run.
 */
export function advanceReal(w: World, acc: StepAccumulator, dtMs: number): number {
  const speed = w.stores.run.speed[0];
  if (speed === 0) {
    if (w.queue.count > 0) applyCommandsNow(w);
    return 0;
  }
  if (!(dtMs > 0)) return 0;
  acc.ms += dtMs * speed;
  let days = Math.floor(acc.ms / MS_PER_DAY_AT_1X);
  acc.ms -= days * MS_PER_DAY_AT_1X;
  if (days > MAX_DAYS_PER_ADVANCE) {
    days = MAX_DAYS_PER_ADVANCE;
    acc.ms = 0;
  }
  let ran = 0;
  for (let i = 0; i < days; i++) {
    tickDay(w);
    ran++;
    if (w.stores.run.speed[0] === 0) {
      // An event card paused the game (D-055): the rest of the elapsed time is not played.
      acc.ms = 0;
      break;
    }
  }
  return ran;
}
