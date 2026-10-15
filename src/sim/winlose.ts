import {
  colonySustains,
  MIN_LAUNCH_PASSENGERS,
  WIN_COLONIES,
  WIN_HOLD_DAYS,
} from '../shared/colony';
import { ExpeditionStatus } from '../shared/planetfall';
import { G_ENTITY, RunOutcome, ShipStateId, type Stores } from './components';
import { isColony } from './launch';
import type { World } from './world';

/**
 * A ship parked in orbit of the homeworld (Arrived or InOrbit with the homeworld as its target):
 * whoever is aboard is at home, not off-world (D-104).
 */
export function shipParkedAtHome(s: Stores, e: number): boolean {
  const st = s.shipState.state[e];
  if (st !== ShipStateId.Arrived && st !== ShipStateId.InOrbit) return false;
  return s.planet.owner[s.shipRoute.destPlanet[e]] === s.run.homeColony[0];
}

/**
 * People aboard ships parked at the homeworld (armed crew that did not unload). They can still
 * go out again, so they count when judging whether the homeworld can send a party (D-104).
 */
export function homeParkedPeople(s: Stores): number {
  const n = s.counts[G_ENTITY];
  let total = 0;
  for (let e = 0; e < n; e++) {
    if (shipParkedAtHome(s, e)) total += s.shipManifest.colonists[e] + s.shipManifest.security[e];
  }
  return total;
}

/**
 * Colonists alive off-world: people in colonies other than the homeworld, aboard ships that still
 * fly or orbit (not Lost, not parked at home; depot ships at a colony keep their remaining crew),
 * and on expeditions (explorers, wounded and guards). The score (D-096, D-104).
 */
export function offworldColonists(s: Stores): number {
  const n = s.counts[G_ENTITY];
  const home = s.run.homeColony[0];
  let total = 0;
  for (let e = 0; e < n; e++) {
    if (e !== home && isColony(s, e)) total += s.colony.population[e];
    const st = s.shipState.state[e];
    if (st !== ShipStateId.None && st !== ShipStateId.Lost && !shipParkedAtHome(s, e)) {
      total += s.shipManifest.colonists[e] + s.shipManifest.security[e];
    }
    const x = s.expedition.status[e];
    if (
      x === ExpeditionStatus.Active ||
      x === ExpeditionStatus.Stranded ||
      x === ExpeditionStatus.Event
    ) {
      total +=
        s.expeditionTeam.explorers[e] + s.expeditionTeam.wounded[e] + s.expeditionTeam.guards[e];
    }
  }
  return total;
}

/**
 * WinLoseSystem (step 11, D-096). Win: at least `win.colonies` off-world colonies with
 * `win.population` people and no Struggling penalty, for `win.holdDays` days in a row (checked first).
 * Lose: the homeworld clock is out (collapse), or no colonist is left off-world and the homeworld
 * cannot send even the smallest party. The first of these ends the run: the outcome and the final
 * score are fixed, the game stops (speed 0) and commands are refused.
 */
export function winLoseSystem(w: World): void {
  const s = w.stores;
  const run = s.run;
  if (run.outcome[0] !== RunOutcome.Running) return;
  const off = offworldColonists(s);
  run.score[0] = off;

  const n = s.counts[G_ENTITY];
  const home = run.homeColony[0];
  let sustaining = 0;
  for (let e = 0; e < n; e++) {
    if (
      e !== home &&
      isColony(s, e) &&
      colonySustains(s.colony.population[e], s.colony.penaltyDays[e])
    )
      sustaining++;
  }
  run.winStreak[0] = sustaining >= WIN_COLONIES ? run.winStreak[0] + 1 : 0;

  let outcome: number = RunOutcome.Running;
  if (run.winStreak[0] >= WIN_HOLD_DAYS) outcome = RunOutcome.Won;
  else if (run.homeDays[0] <= 0) outcome = RunOutcome.LostHomeworld;
  else if (off === 0 && s.colony.population[home] + homeParkedPeople(s) < MIN_LAUNCH_PASSENGERS)
    outcome = RunOutcome.LostAllDead;
  if (outcome === RunOutcome.Running) return;
  run.outcome[0] = outcome;
  run.endDay[0] = run.day[0];
  run.speed[0] = 0;
  run.resumeSpeed[0] = 0;
}
