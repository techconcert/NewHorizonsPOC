import type { ChooseTechCommand } from '../shared/commands';
import { TECH_COST, techRejection, type TechReject } from '../shared/research';
import { G_ENTITY } from './components';
import { isColony } from './launch';
import type { World } from './world';

/**
 * Research (M5, D-092). Research districts make points (ColonyEconomySystem writes them to
 * `colonyFlow.research`); this system adds the sum to the tech being learned. A tech finishes when
 * its points reach its cost; then nothing is being researched until the player chooses again.
 */

export function checkChooseTech(w: World, cmd: ChooseTechCommand): TechReject | null {
  return techRejection(w.stores.research.mask[0], cmd.tech);
}

/** Choosing the tech already under way changes nothing; a different one restarts at 0 points. */
export function applyChooseTech(w: World, cmd: ChooseTechCommand): void {
  if (checkChooseTech(w, cmd) !== null) return;
  const r = w.stores.research;
  if (r.current[0] === cmd.tech) return;
  r.current[0] = cmd.tech;
  r.progress[0] = 0;
}

/** Research points all colonies made on the last economy day. */
export function researchRate(w: World): number {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  let total = 0;
  for (let e = 0; e < n; e++) {
    if (isColony(s, e)) total += s.colonyFlow.research[e];
  }
  return total;
}

export function researchSystem(w: World): void {
  const r = w.stores.research;
  const cur = r.current[0];
  if (cur < 0) return;
  const progress = r.progress[0] + researchRate(w);
  if (progress >= TECH_COST[cur]) {
    r.mask[0] = (r.mask[0] | (1 << cur)) >>> 0;
    r.current[0] = -1;
    r.progress[0] = 0;
  } else r.progress[0] = progress;
}
