// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { countShips } from '../src/sim/launch';
import { G_ENTITY, ShipStateId } from '../src/sim/components';
import { pendingCount } from '../src/sim/events';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { submit, type World } from '../src/sim/world';
import { addShip, lineWorld } from './helpers/transit';

const SHIPS = 200;
const DAYS = 1000;

/** 200 ships of all hulls and speeds, bound for far-away targets, with fuel and food for the whole
 *  run so none arrives, starves or drifts: every day ticks the worst case (all ships flying). */
function fleetWorld(): World {
  const w = lineWorld(2026, 40); // hazard 40: events keep coming
  const s = w.stores;
  for (let i = 0; i < SHIPS; i++) {
    const e = addShip(w, {
      dest: 1 + (i % 5),
      hull: i % 3,
      speed: (i >> 1) % 3,
      colonists: 1000,
      supplies: 1_000_000_000,
      fuel: 1_000_000_000,
      kit: i % 4,
    });
    s.shipRoute.distance[e] = 500_000_000; // a leg longer than the whole run
  }
  return w;
}

/** Answer waiting cards and mend hulls, outside the timed region. */
function housekeeping(w: World): void {
  const s = w.stores;
  // One resolve per waiting card (each takes slot 0, the oldest), applied together.
  const waiting = pendingCount(w);
  for (let i = 0; i < waiting; i++) {
    // The oldest card's ship, read before any of these resolves is applied.
    submit(w, {
      type: 'ResolveEventChoice',
      card: 0,
      choice: s.run.day[0] % 2,
      ship: s.pendingEventCard.subject[i],
    });
  }
  if (waiting > 0) applyCommandsNow(w);
  const n = s.counts[G_ENTITY];
  for (let e = 0; e < n; e++) {
    if (s.shipState.state[e] !== ShipStateId.None) {
      s.ship.integrity[e] = 100;
      s.shipManifest.colonists[e] = 1000;
      s.shipManifest.fuel[e] = 1_000_000_000;
    }
  }
}

describe('performance with 200 ships', () => {
  it('the day tick averages under 2 ms over 1000 days (best of 5 runs)', () => {
    let best = Infinity;
    let eventsSeen = 0;
    for (let run = 0; run < 5; run++) {
      const w = fleetWorld();
      expect(countShips(w.stores)).toBe(SHIPS);
      for (let i = 0; i < 100; i++) {
        tickDay(w); // warm up the JIT
        housekeeping(w);
      }
      let total = 0;
      for (let d = 0; d < DAYS; d++) {
        const t0 = performance.now();
        tickDay(w);
        total += performance.now() - t0;
        housekeeping(w);
      }
      best = Math.min(best, total / DAYS);
      eventsSeen = w.stores.run.lastEvent[0];
      // Everything is still flying: the measurement ran the worst case.
      expect(countShips(w.stores)).toBe(SHIPS);
      expect(w.stores.run.shipsLost[0]).toBe(0);
    }
    expect(eventsSeen).toBeGreaterThan(500); // cards were drawn and answered throughout
    expect(best).toBeLessThan(2);
  }, 120_000);
});
