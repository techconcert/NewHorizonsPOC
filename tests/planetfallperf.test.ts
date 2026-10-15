// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ExpeditionStatus } from '../src/shared/planetfall';
import { SNAPSHOT_MAX_EXPEDITIONS } from '../src/shared/snapshot';
import { G_ENTITY, MAX_LIVE_EXPEDITIONS, ShipStateId } from '../src/sim/components';
import { pendingCount } from '../src/sim/events';
import { countShips } from '../src/sim/launch';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { submit } from '../src/sim/world';
import { addShip } from './helpers/transit';
import { answerCards, arrivedShip, explore, form, type Landing } from './helpers/planetfall';

const SHIPS = 200;
const EXPEDITIONS = MAX_LIVE_EXPEDITIONS; // 32 landed ships
const FLYING = SHIPS - EXPEDITIONS; // 168 more in flight
const DAYS = 600;
const RUNS = 5; // measured on the dev VM: about 0.25 ms per tick, 8 times under the budget

/**
 * 200 ships: 168 in flight (a quarter on short legs, so arrivals and surveys keep firing; transit
 * hazard 40 so event cards keep coming) and 32 landed, each with an expedition exploring in turn.
 */
function busyWorld(): { L: Landing; exps: number[]; landers: number[]; flyers: number[] } {
  const L = arrivedShip(7, { kit: 8, colonists: 5000, supplies: 1_000_000_000 });
  const s = L.w.stores;
  for (let i = 0; i < s.counts[G_ENTITY]; i++) if (i <= 5) s.system.hazard[i] = 40;
  const landers = [L.ship];
  for (let i = 1; i < EXPEDITIONS; i++) {
    landers.push(
      addShip(L.w, { dest: 1, colonists: 400, supplies: 1_000_000_000, kit: 8, security: 0 }),
    );
  }
  const flyers: number[] = [];
  for (let i = 0; i < FLYING; i++) {
    const e = addShip(L.w, {
      dest: 1 + (i % 5),
      hull: i % 3,
      speed: (i >> 1) % 3,
      colonists: 1000,
      supplies: 1_000_000_000,
      fuel: 1_000_000_000,
      kit: i % 4,
    });
    s.shipRoute.distance[e] = i % 4 === 0 ? 40_000 + 777 * i : 500_000_000;
    flyers.push(e);
  }
  // Fly until every lander is in orbit, answering the cards the hazard draws on the way.
  for (
    let d = 0;
    d < 300 && landers.some((x) => s.shipState.state[x] !== ShipStateId.Arrived);
    d++
  ) {
    tickDay(L.w);
    answerCards(L.w, 0);
  }
  const exps: number[] = [];
  for (let i = 0; i < EXPEDITIONS; i++) {
    const one: Landing = { ...L, ship: landers[i] };
    exps.push(form(one, { explorers: 20, supplies: 40_000_000, kit: 8, stance: i % 3 }));
  }
  return { L, exps, landers, flyers };
}

/** Outside the timed region: answer cards, mend ships, keep teams fed and exploring, re-launch. */
function housekeeping(L: Landing, exps: number[], flyers: number[]): void {
  const w = L.w;
  const s = w.stores;
  // Ship cards first (oldest first, applied together), then expedition cards.
  const waiting = pendingCount(w);
  for (let i = 0; i < waiting; i++) {
    submit(w, {
      type: 'ResolveEventChoice',
      card: 0,
      choice: s.run.day[0] % 2,
      ship: s.pendingEventCard.subject[i],
    });
  }
  if (waiting > 0) applyCommandsNow(w);
  answerCards(w, 0);
  for (const e of flyers) {
    s.ship.integrity[e] = 100;
    s.shipManifest.colonists[e] = 1000;
    s.shipManifest.fuel[e] = 1_000_000_000;
    if (s.shipState.state[e] === ShipStateId.Arrived) {
      // Fly on to a fresh short leg so arrivals keep happening.
      s.shipRoute.originX[e] = s.system.x[s.planet.system[s.shipRoute.destPlanet[e]]];
      s.shipRoute.originY[e] = s.system.y[s.planet.system[s.shipRoute.destPlanet[e]]];
      s.shipRoute.progress[e] = 0;
      s.shipRoute.distance[e] = 40_000 + 777 * e;
      s.shipState.state[e] = ShipStateId.InTransit;
    }
  }
  const n = s.planet.regionCount[L.planet];
  for (const e of exps) {
    if (s.expedition.status[e] !== ExpeditionStatus.Active || s.expedition.target[e] >= 0) continue;
    s.expeditionTeam.explorers[e] = 20; // keep the teams alive
    s.expeditionTeam.wounded[e] = 0;
    for (let i = 0; i < n; i++) {
      if (s.region.fog[L.base + i] === 1) {
        explore(w, e, i);
        break;
      }
    }
  }
  // Keep a frontier: re-hide explored regions so rounds never run out.
  for (let i = 0; i < n; i++)
    if (s.region.fog[L.base + i] === 3 && i !== L.lz) s.region.fog[L.base + i] = 1;
}

describe('performance with 200 ships and 32 expeditions', () => {
  it('the day tick averages under 2 ms over 600 days (best of 5 runs)', () => {
    expect(EXPEDITIONS).toBeLessThanOrEqual(SNAPSHOT_MAX_EXPEDITIONS);
    const avgs: number[] = [];
    let cards = 0;
    for (let run = 0; run < RUNS; run++) {
      const { L, exps, flyers } = busyWorld();
      expect(countShips(L.w.stores)).toBe(SHIPS);
      for (let i = 0; i < 60; i++) {
        tickDay(L.w); // warm up the JIT
        housekeeping(L, exps, flyers);
      }
      let total = 0;
      for (let d = 0; d < DAYS; d++) {
        const t0 = performance.now();
        tickDay(L.w);
        total += performance.now() - t0;
        housekeeping(L, exps, flyers);
      }
      avgs.push(total / DAYS);
      let rounds = 0;
      for (const e of exps) rounds += L.w.stores.expedition.round[e];
      expect(rounds).toBeGreaterThan(300); // expeditions kept rolling
      cards = L.w.stores.run.lastEvent[0];
      expect(L.w.stores.shipState.state[L.ship]).toBe(ShipStateId.Arrived);
    }
    // Event cards (ships and expeditions) were drawn and answered throughout, and ships kept
    // arriving: the run measured the busy case, not an idle one.
    expect(cards).toBeGreaterThan(300);
    // The design budget is 2 ms per tick. The best of five runs is compared with it (the same
    // method as transitperf), so a slow CI neighbour in some runs does not fail the build.
    const best = Math.min(...avgs);
    expect(best).toBeLessThan(2);
  }, 240_000);
});
