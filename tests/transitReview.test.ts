// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  clampDt,
  clockAdvance,
  clockAlpha,
  clockOnSnapshot,
  createInterpClock,
  MAX_DT_MS,
} from '../src/render/interp';
import {
  createTrailStore,
  trailCount,
  trailSyncShip,
  trailTouch,
  writeTrailSegments,
} from '../src/render/trails';
import { CHOICE_COST_STRIDE } from '../src/shared/events';
import { distanceFpFromDelta, rerouteFuelCost } from '../src/shared/loadout';
import { createSnapshot, SHIP_POS_STRIDE } from '../src/shared/snapshot';
import { createTransitScratch, legOrigin, rerouteOptionsFor } from '../src/shared/transit';
import { G_PLANET } from '../src/sim/components';
import { checkReroute } from '../src/sim/reroute';
import { shipXFp, shipYFp } from '../src/sim/ships';
import { REPLY_TIMEOUT_MS, createCommandTracker } from '../src/ui/commandGate';
import { buildCardView, marginAfterChoice, marginInputOf } from '../src/ui/eventCardModel';
import { createKeyGuard, CARD_KEY_COOLDOWN_MS } from '../src/ui/keyGuard';
import { marginCue } from '../src/ui/missionModel';
import { fillSnapshot } from '../src/worker/fill';
import { addShip, CARD, lineWorld, planetOf, resolveSlot, stage, ticks } from './helpers/transit';

function snapOf(w: ReturnType<typeof lineWorld>) {
  const s = createSnapshot();
  fillSnapshot(w, s, 0);
  return s;
}

describe('event card key guard', () => {
  const press = { repeat: false, targetTag: 'BODY' };

  it('ignores keys while no card is visible', () => {
    let t = 0;
    const g = createKeyGuard(() => t);
    t = 10_000;
    expect(g.accept(press)).toBe(false);
  });

  it('ignores a key within the cooldown after a card appears, accepts after it', () => {
    let t = 1000;
    const g = createKeyGuard(() => t);
    g.cardShown();
    t += CARD_KEY_COOLDOWN_MS - 1;
    expect(g.accept(press)).toBe(false);
    t += 1;
    expect(g.accept(press)).toBe(true);
  });

  it('ignores a held key (auto-repeat) even after the cooldown', () => {
    let t = 0;
    const g = createKeyGuard(() => t);
    g.cardShown();
    t = 1000;
    expect(g.accept({ repeat: true, targetTag: 'BODY' })).toBe(false);
    expect(g.accept(press)).toBe(true); // the first real press still counts
  });

  it('a double tap answers one card only', () => {
    let t = 0;
    const g = createKeyGuard(() => t);
    g.cardShown();
    t = 1000;
    expect(g.accept(press)).toBe(true);
    t = 1050;
    expect(g.accept(press)).toBe(false);
  });

  it('a queued card shown right after an answer has its own cooldown', () => {
    let t = 0;
    const g = createKeyGuard(() => t);
    g.cardShown();
    t = 1000;
    expect(g.accept(press)).toBe(true);
    g.cardShown(); // the next card appears
    t = 1100;
    expect(g.accept(press)).toBe(false); // the tail of the tap that answered the first
    t = 1000 + CARD_KEY_COOLDOWN_MS;
    expect(g.accept(press)).toBe(true);
  });

  it('ignores form fields and closed cards', () => {
    let t = 0;
    const g = createKeyGuard(() => t);
    g.cardShown();
    t = 1000;
    for (const tag of ['INPUT', 'textarea', 'SELECT']) {
      expect(g.accept({ repeat: false, targetTag: tag })).toBe(false);
    }
    g.cardClosed();
    expect(g.accept(press)).toBe(false);
  });
});

describe('command tracker: reply timeout', () => {
  it('expires only commands older than the timeout, once', () => {
    const t = createCommandTracker();
    t.track(1, 'reroute', 1000);
    t.track(2, 'event', 5000);
    expect(t.expire(1000 + REPLY_TIMEOUT_MS)).toEqual([]);
    expect(t.expire(1000 + REPLY_TIMEOUT_MS + 1)).toEqual([{ id: 1, kind: 'reroute' }]);
    expect(t.expire(1000 + REPLY_TIMEOUT_MS + 1)).toEqual([]);
    expect(t.take(2)).toBe('event');
  });

  it('a reply cancels the timeout; drain returns everything left', () => {
    const t = createCommandTracker();
    t.track(1, 'launch', 0);
    t.track(2, 'event', 0);
    expect(t.take(1)).toBe('launch');
    expect(t.expire(99_999)).toEqual([{ id: 2, kind: 'event' }]);
    t.track(3, 'reroute', 0);
    expect(t.drain()).toEqual([{ id: 3, kind: 'reroute' }]);
    expect(t.drain()).toEqual([]);
  });
});

describe('interpolation clock edge cases', () => {
  it('a day change while paused restarts the fraction and stays still', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 5, 1);
    clockAdvance(c, 600);
    clockOnSnapshot(c, 6, 0);
    expect(clockAlpha(c)).toBe(0);
    expect(clockAdvance(c, 500)).toBe(false);
    expect(clockAlpha(c)).toBe(0);
  });

  it('a huge step after a tab resume is clamped so ships do not jump more than a few frames', () => {
    expect(clampDt(60_000)).toBe(MAX_DT_MS);
    expect(clampDt(16)).toBe(16);
    expect(clampDt(0)).toBe(0);
    expect(clampDt(-5)).toBe(0);
    expect(clampDt(NaN)).toBe(0);
    const c = createInterpClock();
    clockOnSnapshot(c, 1, 1);
    clockAdvance(c, clampDt(60_000));
    expect(clockAlpha(c)).toBeCloseTo(0.1, 10);
  });

  it('dt = 0 changes nothing', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 1, 4);
    expect(clockAdvance(c, 0)).toBe(false);
    expect(clockAlpha(c)).toBe(0);
  });
});

describe('trail bookkeeping per snapshot', () => {
  it('stores one point per game day, not per snapshot', () => {
    const t = createTrailStore(8, 4);
    expect(trailSyncShip(t, 3, 1, true, 0, 0)).toBe(true);
    expect(trailSyncShip(t, 3, 2, false, 1, 1)).toBe(false); // same day, another snapshot
    expect(trailSyncShip(t, 3, 3, true, 2, 2)).toBe(true); // next day
    expect(trailCount(t, 3)).toBe(2);
  });

  it('drops the old trail when an entity id comes back after a gap (id reuse)', () => {
    const t = createTrailStore(8, 4);
    trailSyncShip(t, 2, 1, true, 5, 5);
    trailSyncShip(t, 2, 2, true, 6, 6);
    expect(trailCount(t, 2)).toBe(2);
    // sync 3 and 4 do not list entity 2; at sync 5 it is a new ship at (90, 90)
    trailSyncShip(t, 2, 5, true, 90, 90);
    expect(trailCount(t, 2)).toBe(1);
    const out = new Float32Array(6);
    const fade = new Float32Array(2);
    writeTrailSegments(t, 2, 91, 91, out, 0, fade, 0);
    expect([out[3], out[4]]).toEqual([90, 90]);
  });

  it('a ship seen in consecutive syncs keeps its trail; first sight clears nothing', () => {
    const t = createTrailStore(8, 4);
    expect(trailTouch(t, 1, 7)).toBe(false);
    trailSyncShip(t, 1, 7, true, 1, 1);
    expect(trailTouch(t, 1, 8)).toBe(false);
    expect(trailCount(t, 1)).toBe(1);
  });
});

describe('leg origin from a real snapshot', () => {
  it('recovers the launch point of a ship five days out', () => {
    const w = lineWorld();
    addShip(w);
    ticks(w, 5);
    const s = snapOf(w);
    const o = 0 * SHIP_POS_STRIDE;
    const sys = s.planetSystem[s.shipDest[0]];
    const out = new Float32Array(2);
    legOrigin(
      s.shipPos[o + 2],
      s.shipPos[o + 3],
      s.positions[sys * 2],
      s.positions[sys * 2 + 1],
      s.shipProgress[0],
      s.shipDistance[0],
      out,
      0,
    );
    expect(out[0]).toBeCloseTo(100, 1);
    expect(out[1]).toBeCloseTo(500, 1);
  });
});

describe('UI reroute options never promise more than the sim accepts', () => {
  function uiAndSim(w: ReturnType<typeof lineWorld>, e: number) {
    const snap = snapOf(w);
    const ui = new Set(rerouteOptionsFor(snap, 0, createTransitScratch()).map((o) => o.planet));
    const sim = new Set<number>();
    for (let p = 0; p < w.stores.counts[G_PLANET]; p++) {
      if (checkReroute(w, { type: 'RerouteShip', ship: e, target: p }) === null) sim.add(p);
    }
    return { ui, sim };
  }

  it('with a part-burned fuel unit, every UI option is accepted by the sim', () => {
    const w = lineWorld();
    const e = addShip(w, { speed: 1 });
    ticks(w, 3);
    expect(w.stores.shipRoute.fuelFrac[e]).toBeGreaterThan(0);
    const { ui, sim } = uiAndSim(w, e);
    expect(ui.size).toBeGreaterThan(0);
    for (const p of ui) expect(sim.has(p), `planet ${p}`).toBe(true);
  });

  /** Put the fuel exactly `delta` units above the cost of rerouting to system 3. */
  function atEdge(speed: number, delta: number) {
    const w = lineWorld();
    const e = addShip(w, { speed });
    ticks(w, 3);
    const s = w.stores;
    const target = planetOf(w, 3);
    const sys = s.planet.system[target];
    const d = distanceFpFromDelta(s.system.x[sys] - shipXFp(w, e), s.system.y[sys] - shipYFp(w, e));
    s.shipManifest.fuel[e] = rerouteFuelCost(d, speed) + delta;
    return { w, e, target, partBurned: s.shipRoute.fuelFrac[e] > 0 };
  }

  it('fuel-limit edge with a part-burned unit: the UI and the sim agree on both sides', () => {
    const on = atEdge(1, 1); // spendable fuel == cost
    expect(on.partBurned).toBe(true);
    let r = uiAndSim(on.w, on.e);
    expect(r.sim.has(on.target)).toBe(true);
    expect(r.ui.has(on.target)).toBe(true);
    const off = atEdge(1, 0); // one unit short
    r = uiAndSim(off.w, off.e);
    expect(r.sim.has(off.target)).toBe(false);
    expect(r.ui.has(off.target)).toBe(false);
  });

  it('without a part-burned unit the UI is one unit more careful than the sim, never less', () => {
    const w = atEdge(0, 0);
    expect(w.partBurned).toBe(false);
    const r = uiAndSim(w.w, w.e);
    expect(r.sim.has(w.target)).toBe(true); // exactly affordable
    expect(r.ui.has(w.target)).toBe(false); // the UI assumes a started unit
    for (const p of r.ui) expect(r.sim.has(p)).toBe(true);
  });
});

describe('margin after a choice matches the sim once the choice is applied', () => {
  function check(card: number, choice: number, speed: number) {
    const w = lineWorld();
    const e = addShip(w, { speed });
    ticks(w, 3);
    stage(w, e, card);
    const before = snapOf(w);
    expect(buildCardView(before)).not.toBeNull();
    const predicted = marginAfterChoice(
      marginInputOf(before, 0),
      before.eventCosts,
      choice * CHOICE_COST_STRIDE,
      false,
    );
    expect(resolveSlot(w, choice).ok).toBe(true);
    const after = snapOf(w);
    expect(after.shipMargin[0]).toBe(predicted);
  }

  it('delay outcomes (Engine fault, Repair: 5 days)', () => check(CARD.EngineFault, 0, 0));
  it('delay and speed drop together (Engine fault, Limp on, at Cruise)', () =>
    check(CARD.EngineFault, 1, 1));
  it('supply and colonist losses (Illness, both choices)', () => {
    check(CARD.Illness, 0, 0);
    check(CARD.Illness, 1, 2);
  });
  it('a detour delays the ship (Micrometeor, Detour)', () => check(CARD.Micrometeor, 1, 1));
});

describe('margin cue text', () => {
  it('always gives a word as well as a colour', () => {
    expect(marginCue(99)).toBe('LOW');
    expect(marginCue(100)).toBe('OK');
    expect(marginCue(129)).toBe('OK');
    expect(marginCue(130)).toBe('SAFE');
  });
});
