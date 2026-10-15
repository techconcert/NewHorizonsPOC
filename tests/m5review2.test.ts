// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ECONOMY } from '../src/data';
import { Stance } from '../src/shared/colony';
import type { FromWorker } from '../src/shared/messages';
import { createMemoryStorage, SAVE_VERSION, SIM_VERSION } from '../src/shared/save';
import {
  C_POPULATION,
  COLONY_STRIDE,
  createSnapshot,
  EC_HOUSING,
  ECON_STRIDE,
} from '../src/shared/snapshot';
import { nativeSystem } from '../src/sim/natives';
import { createSave, loadSave, saveProblem } from '../src/sim/save';
import { tickDay } from '../src/sim/tick';
import { createWorld } from '../src/sim/world';
import { buildColonyView } from '../src/ui/colonyPanelModel';
import { createMenuGate, MENU_REPLY_TIMEOUT_MS } from '../src/ui/menuGate';
import { createAutoPause } from '../src/ui/visibility';
import { createHandler } from '../src/worker/handler';
import { fillSnapshot } from '../src/worker/fill';
import { addColony, addNatives } from './helpers/colony';
import { lineWorld } from './helpers/transit';

function handlerSetup() {
  const out: FromWorker[] = [];
  let now = 0;
  const handler = createHandler({ postMessage: (m) => void out.push(m) }, () => now);
  return {
    out,
    handler,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('worker failure (D-107)', () => {
  it('a throwing pump stops the game, posts one error, and refuses commands and saves', () => {
    const h = handlerSetup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    const w = h.handler.getWorld();
    if (w === null) throw new Error('no world');
    // Corrupt the command queue: the next tick throws its invariant error.
    w.queue.count = 1;
    h.advance(1500);
    h.handler.pump();
    const errors = h.out.filter((m) => m.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(w.stores.run.speed[0]).toBe(0);
    h.advance(5000);
    h.handler.pump();
    expect(h.out.filter((m) => m.kind === 'error')).toHaveLength(1);

    h.handler.onMessage({
      kind: 'command',
      id: 5,
      gen: 1,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    const reply = h.out.filter((m) => m.kind === 'commandResult').pop();
    expect(reply).toEqual({
      kind: 'commandResult',
      id: 5,
      gen: 1,
      result: { ok: false, reason: 'WORKER_FAILED' },
    });
    h.handler.onMessage({ kind: 'save', id: 6, gen: 1 });
    const saved = h.out.filter((m) => m.kind === 'saved').pop();
    expect(saved).toMatchObject({ kind: 'saved', id: 6, ok: false });

    // A new game clears the failure.
    h.handler.onMessage({ kind: 'init', seed: 1, gen: 2 });
    h.handler.onMessage({
      kind: 'command',
      id: 7,
      gen: 2,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    expect(h.out.filter((m) => m.kind === 'commandResult').pop()).toMatchObject({
      result: { ok: true },
    });
  });
});

describe('world generation (D-107)', () => {
  it('refuses requests made for another generation and echoes the generation in replies', () => {
    const h = handlerSetup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 3 });
    h.handler.onMessage({
      kind: 'command',
      id: 1,
      gen: 2,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    expect(h.out.filter((m) => m.kind === 'commandResult').pop()).toEqual({
      kind: 'commandResult',
      id: 1,
      gen: 2,
      result: { ok: false, reason: 'STALE_WORLD' },
    });
    expect(h.handler.getWorld()?.stores.run.speed[0]).toBe(1);
    h.handler.onMessage({ kind: 'setSpeed', gen: 2, speed: 4 });
    expect(h.handler.getWorld()?.stores.run.speed[0]).toBe(1);
    h.handler.onMessage({ kind: 'save', id: 2, gen: 2 });
    expect(h.out.filter((m) => m.kind === 'saved').pop()).toMatchObject({ ok: false, gen: 2 });
  });

  it('a good load moves the worker to the load generation; a failed load keeps the old one', () => {
    const h = handlerSetup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    h.handler.onMessage({ kind: 'save', id: 1, gen: 1 });
    const data = (h.out.find((m) => m.kind === 'saved') as { data: ReturnType<typeof createSave> })
      .data;
    h.handler.onMessage({
      kind: 'load',
      id: 2,
      gen: 5,
      data: { ...data, stateHash: data.stateHash ^ 1 },
    });
    expect(h.out.filter((m) => m.kind === 'loadResult').pop()).toMatchObject({ ok: false, gen: 5 });
    h.handler.onMessage({
      kind: 'command',
      id: 3,
      gen: 1,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    expect(h.out.filter((m) => m.kind === 'commandResult').pop()).toMatchObject({
      result: { ok: true },
    });
    h.handler.onMessage({ kind: 'load', id: 4, gen: 6, data });
    expect(h.out.filter((m) => m.kind === 'loadResult').pop()).toMatchObject({ ok: true, gen: 6 });
    h.handler.onMessage({
      kind: 'command',
      id: 5,
      gen: 1,
      command: { type: 'SetGameSpeed', speed: 4 },
    });
    expect(h.out.filter((m) => m.kind === 'commandResult').pop()).toMatchObject({
      result: { ok: false, reason: 'STALE_WORLD' },
    });
  });
});

describe('menu gate (D-107)', () => {
  it('allows one operation at a time and frees it on the reply', () => {
    const g = createMenuGate();
    const a = g.begin(0);
    expect(a).toBeGreaterThan(0);
    expect(g.busy).toBe(true);
    expect(g.begin(10)).toBe(0);
    expect(g.accept(a + 1)).toBe(false);
    expect(g.accept(a)).toBe(true);
    expect(g.busy).toBe(false);
    expect(g.accept(a)).toBe(false);
  });

  it('a reply that never comes frees the menu after the timeout, and a late reply is refused', () => {
    const g = createMenuGate();
    const a = g.begin(1000);
    expect(g.expire(1000 + MENU_REPLY_TIMEOUT_MS - 1)).toBe(false);
    expect(g.busy).toBe(true);
    expect(g.expire(1000 + MENU_REPLY_TIMEOUT_MS)).toBe(true);
    expect(g.busy).toBe(false);
    expect(g.expire(1000 + MENU_REPLY_TIMEOUT_MS + 1)).toBe(false);
    expect(g.accept(a)).toBe(false);
    expect(g.begin(99_999)).toBeGreaterThan(a);
  });
});

describe('auto-pause reset (D-110)', () => {
  it('forgets the pending resume and the remembered speed after a new world', () => {
    const sent: number[] = [];
    const ap = createAutoPause((s) => void sent.push(s));
    ap.userSpeed(4);
    ap.hidden(); // pauses, remembers 4
    ap.reset(2); // new world running at 2
    ap.shown(); // nothing to resume
    expect(sent).toEqual([4, 0]);
    ap.hidden();
    ap.shown();
    expect(sent).toEqual([4, 0, 0, 2]);
  });
});

describe('save header (D-111)', () => {
  it('stores the simulation version and refuses a different one with a clear message', () => {
    expect(SIM_VERSION).toBe(5);
    expect(SAVE_VERSION).toBe(3);
    const w = createWorld(3);
    const d = createSave(w);
    expect(d.simVersion).toBe(SIM_VERSION);
    expect(saveProblem(d)).toBeNull();
    const old = { ...d, simVersion: SIM_VERSION - 1 };
    expect(saveProblem(old)).toBe(
      `The save was made with simulation version ${SIM_VERSION - 1}, but this game runs version ${SIM_VERSION}. The rules changed, so it cannot be replayed. Start a new game.`,
    );
    expect(() => loadSave(old)).toThrow(`simulation version ${SIM_VERSION - 1}`);
    expect(saveProblem({ ...d, simVersion: undefined })).toBe('The save is damaged (header).');
    expect(createMemoryStorage()).toBeDefined();
  });
});

describe('Defend upkeep (D-109)', () => {
  function defendRun(disposition: number, production: number) {
    const w = lineWorld(3);
    const c = addColony(w, { population: 1000, production, stance: Stance.Defend });
    addNatives(w, c, { disposition });
    w.stores.run.day[0] = 1;
    nativeSystem(w);
    return { w, c };
  }
  const upkeep = ECONOMY.natives.defendUpkeepProduction;

  it('is charged against Wary and Hostile natives only', () => {
    for (const disp of [2, 3]) {
      const { w, c } = defendRun(disp, 50);
      expect(w.stores.stockpile.production[c]).toBe(50 - upkeep);
      expect(w.stores.colonyFlow.upkeep[c]).toBe(upkeep);
      expect(w.stores.colonyFlow.defendUnpaid[c]).toBe(0);
    }
    const peaceful = defendRun(1, 50);
    expect(peaceful.w.stores.stockpile.production[peaceful.c]).toBe(50);
    expect(peaceful.w.stores.colonyFlow.upkeep[peaceful.c]).toBe(0);
    expect(peaceful.w.stores.colonyFlow.defendUnpaid[peaceful.c]).toBe(0);
  });

  it('is flagged unpaid when the colony cannot pay it against Wary or Hostile natives', () => {
    const { w, c } = defendRun(3, upkeep - 1);
    expect(w.stores.stockpile.production[c]).toBe(upkeep - 1);
    expect(w.stores.colonyFlow.upkeep[c]).toBe(0);
    expect(w.stores.colonyFlow.defendUnpaid[c]).toBe(1);
    // Peaceful natives never make it unpaid.
    expect(defendRun(1, 0).w.stores.colonyFlow.defendUnpaid[defendRun(1, 0).c]).toBe(0);
  });

  it('shows in the colony panel: the flow line, and "Defend (unpaid)" on the button', () => {
    const paid = defendRun(3, 50);
    paid.w.stores.colonyFlow.production[paid.c] = 8;
    const snap = createSnapshot();
    fillSnapshot(paid.w, snap, 0);
    const v = buildColonyView(snap, 1, -1);
    expect(v?.flow).toContain(`+8 Production (-${upkeep} Defend upkeep)`);
    expect(v?.stances[1].label).toBe('Defend');

    const unpaid = defendRun(3, 0);
    const snap2 = createSnapshot();
    fillSnapshot(unpaid.w, snap2, 0);
    const v2 = buildColonyView(snap2, 1, -1);
    expect(v2?.stances[1].label).toBe('Defend (unpaid)');
    expect(v2?.stances[0].label).toBe('Coexist');
    expect(v2?.flow).toContain('Defend upkeep unpaid');
  });
});

describe('colony panel over-housing warning', () => {
  it('warns when the population is above the housing, and not otherwise', () => {
    const w = lineWorld();
    addColony(w, { population: 900, supplies: 100000 });
    tickDay(w); // the first economy day fills in the housing
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(buildColonyView(snap, 1, -1)?.overHousing).toBe('');
    snap.colonies[COLONY_STRIDE + C_POPULATION] = snap.colonyEcon[ECON_STRIDE + EC_HOUSING] + 1;
    expect(buildColonyView(snap, 1, -1)?.overHousing).toBe(
      'Overcrowded: 1001 people but housing for 1000. The colony cannot grow; build Habitats.',
    );
  });
});
