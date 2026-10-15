import { applyQueuedCommands } from './commands';
import { colonyEconomySystem } from './colony';
import { eventRollSystem } from './events';
import { explorationSystem } from './expedition';
import { nativeSystem } from './natives';
import { researchSystem } from './research';
import { supplySystem } from './supply';
import { surveySystem } from './survey';
import { travelSystem } from './travel';
import { winLoseSystem } from './winlose';
import type { World } from './world';

/** System order per tick: docs/ARCHITECTURE.md section 7. Stubs fill in from M4 on. */
export {
  colonyEconomySystem,
  eventRollSystem,
  explorationSystem,
  nativeSystem,
  researchSystem,
  supplySystem,
  surveySystem,
  travelSystem,
  winLoseSystem,
};

export function commandSystem(w: World): void {
  applyQueuedCommands(w);
}

export function clockSystem(w: World): void {
  const run = w.stores.run;
  run.day[0] = run.day[0] + 1;
  const left = run.homeDays[0];
  if (left > 0) run.homeDays[0] = left - 1;
}

/** ExpeditionSystem (step 7): rounds of exploration, supplies on the ground (D-069). */
export function expeditionSystem(w: World): void {
  explorationSystem(w);
}
export function cleanupSystem(w: World): void {
  void w;
}
