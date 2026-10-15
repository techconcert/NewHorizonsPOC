// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DISTANCE_FP, rerouteFuelCost } from '../src/shared/loadout';
import { createSnapshot, META_SHIP_COUNT } from '../src/shared/snapshot';
import {
  createTransitScratch,
  expectedEventsX100,
  formatExpectedEvents,
  isFlying,
  rangeRadiusWorld,
  reachableSystems,
  rerouteBlocker,
  rerouteOptionsFor,
  shipFlightOf,
  shipKindOf,
  shipRowOf,
  SHIP_STATE,
  uiSpendableFuel,
} from '../src/shared/transit';
import { ShipStateId } from '../src/sim/components';
import { fillSnapshot } from '../src/worker/fill';
import { addShip, CARD, lineWorld, planetOf, stage, ticks } from './helpers/transit';

const U = DISTANCE_FP;

/** Snapshot of a line world with one Scout 5 days out toward system 1 (30 units flown). */
function flown(over: Parameters<typeof addShip>[1] = {}) {
  const w = lineWorld();
  const e = addShip(w, over);
  ticks(w, 5);
  const snap = createSnapshot();
  fillSnapshot(w, snap, 0);
  return { w, e, snap };
}

describe('ship state ids', () => {
  it('match the sim ids', () => {
    for (const [name, id] of Object.entries(SHIP_STATE)) {
      expect(id, name).toBe(ShipStateId[name as keyof typeof ShipStateId]);
    }
  });

  it('map to the five marker kinds', () => {
    expect(shipKindOf(SHIP_STATE.InTransit)).toBe('transit');
    expect(shipKindOf(SHIP_STATE.Cruising)).toBe('transit');
    expect(shipKindOf(SHIP_STATE.Event)).toBe('event');
    expect(shipKindOf(SHIP_STATE.Drifting)).toBe('drifting');
    expect(shipKindOf(SHIP_STATE.Arrived)).toBe('arrived');
    expect(shipKindOf(SHIP_STATE.Lost)).toBe('lost');
    expect(isFlying(SHIP_STATE.InTransit)).toBe(true);
    expect(isFlying(SHIP_STATE.Event)).toBe(false);
  });
});

describe('expected events for a trip (faster means fewer)', () => {
  // Scout, 100 world units, hazard 40: BALANCE.md says 0.22 / 0.11 / 0.04 cards.
  const d = 100 * U;
  it('matches the BALANCE.md worked numbers', () => {
    // Economy: 17 days x 13 permille = 0.221; Cruise: 12 x 9 = 0.108; Hard Burn: 7 x 5 = 0.035.
    expect(expectedEventsX100(d, 0, 0, 40)).toBe(22);
    expect(expectedEventsX100(d, 0, 1, 40)).toBe(11);
    expect(expectedEventsX100(d, 0, 2, 40)).toBe(4);
  });

  it('is zero on a hazard 0 route and grows with the distance', () => {
    expect(expectedEventsX100(d, 0, 0, 0)).toBe(0);
    expect(expectedEventsX100(2 * d, 0, 0, 40)).toBeGreaterThan(expectedEventsX100(d, 0, 0, 40));
  });

  it('formats two decimals', () => {
    expect(formatExpectedEvents(22)).toBe('0.22');
    expect(formatExpectedEvents(5)).toBe('0.05');
    expect(formatExpectedEvents(105)).toBe('1.05');
    expect(formatExpectedEvents(0)).toBe('0.00');
  });
});

describe('reroute range and in-range targets from a snapshot', () => {
  it('range radius is what the fuel left after the penalty covers', () => {
    const { snap } = flown();
    // 3850 fuel after 5 days, one unit assumed part-burned: 3849 - 200 penalty = 3649 at 5 per unit.
    expect(snap.shipFuel[0]).toBe(3850);
    expect(rangeRadiusWorld(snap, 0)).toBeCloseTo(729.8, 2);
  });

  it('radius is 0 for a ship that cannot be rerouted', () => {
    const { w, e } = flown();
    stage(w, e, CARD.Illness);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.shipState[0]).toBe(SHIP_STATE.Event);
    expect(rangeRadiusWorld(snap, 0)).toBe(0);
    expect(rerouteOptionsFor(snap, 0, createTransitScratch())).toEqual([]);
    expect(rerouteBlocker(SHIP_STATE.Event)).toBe('EVENT_PENDING');
  });

  it('every option is inside the range, excludes the current target, and its cost is affordable', () => {
    const { w, snap } = flown();
    const scratch = createTransitScratch();
    const options = rerouteOptionsFor(snap, 0, scratch);
    const dest = planetOf(w, 1);
    expect(options.length).toBeGreaterThan(0);
    expect(options.some((o) => o.planet === dest)).toBe(false);
    for (const o of options) {
      expect(o.preview.inRange).toBe(true);
      expect(o.preview.totalFuel).toBe(rerouteFuelCost(o.preview.distanceFp, 0));
      expect(o.preview.totalFuel).toBeLessThanOrEqual(3849);
      const sys = snap.planetSystem[o.planet];
      const dx = snap.positions[sys * 2] - snap.shipPos[2];
      const dy = snap.positions[sys * 2 + 1] - snap.shipPos[3];
      expect(Math.sqrt(dx * dx + dy * dy)).toBeLessThanOrEqual(rangeRadiusWorld(snap, 0) + 0.01);
    }
  });

  it('the worked example: system 3 is 270 units away, 45 days, 1350 + 200 fuel, margin 174%', () => {
    const { w, snap } = flown();
    const o = rerouteOptionsFor(snap, 0, createTransitScratch()).find(
      (x) => x.planet === planetOf(w, 3),
    );
    expect(o).toBeDefined();
    expect(o!.preview.distanceFp).toBe(69120);
    expect(o!.preview.etaDays).toBe(45);
    expect(o!.preview.tripFuel).toBe(1350);
    expect(o!.preview.totalFuel).toBe(1550);
    // 5000 - 5 x 60 = 4700 supplies for 60 colonists over 45 days.
    expect(o!.preview.supplyMarginPct).toBe(174);
  });

  it('a ship with little fuel has a short range and only near targets', () => {
    const { w, snap } = flown({ fuel: 700 });
    // 550 left, 549 spendable, 349 after the penalty: 69.8 units.
    expect(rangeRadiusWorld(snap, 0)).toBeCloseTo(69.8, 2);
    const options = rerouteOptionsFor(snap, 0, createTransitScratch());
    expect(options.some((o) => o.planet === planetOf(w, 3))).toBe(false);
    for (const o of options) expect(o.preview.distanceFp).toBeLessThanOrEqual(69.8 * U);
  });

  it('reachableSystems lights exactly the systems that hold an option', () => {
    const { snap } = flown();
    const options = rerouteOptionsFor(snap, 0, createTransitScratch());
    const flags = new Uint8Array(64);
    flags.fill(1); // stale values must be cleared
    const lit = reachableSystems(options, snap.planetSystem, flags);
    const expected = new Set(options.map((o) => snap.planetSystem[o.planet]));
    expect(lit).toBe(expected.size);
    for (let s = 0; s < 64; s++) expect(flags[s]).toBe(expected.has(s) ? 1 : 0);
  });

  it('shipFlightOf reads grid position, spendable fuel and the destination', () => {
    const { w, snap } = flown();
    const f = shipFlightOf(snap, 0);
    expect(f.xFp).toBe(130 * U);
    expect(f.yFp).toBe(500 * U);
    expect(f.fuel).toBe(3849);
    expect(f.destPlanet).toBe(planetOf(w, 1));
    expect(f.colonists).toBe(60);
  });

  it('finds ship rows by entity id', () => {
    const { e, snap } = flown();
    expect(shipRowOf(snap, e)).toBe(0);
    expect(shipRowOf(snap, e + 99)).toBe(-1);
    expect(snap.meta[META_SHIP_COUNT]).toBe(1);
  });

  it('spendable fuel assumes a part-burned unit only for ships in flight', () => {
    expect(uiSpendableFuel(100, SHIP_STATE.InTransit)).toBe(99);
    expect(uiSpendableFuel(0, SHIP_STATE.InTransit)).toBe(0);
    expect(uiSpendableFuel(100, SHIP_STATE.Event)).toBe(100);
  });
});
