// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryStorage, SAVE_SLOT, SAVE_VERSION, type SaveData } from '../src/shared/save';
import { COMMAND_MAX_ARGS, G_LOG, G_PLANET } from '../src/sim/components';
import { planetDistanceFp } from '../src/sim/launch';
import { createSave, loadSave, saveProblem } from '../src/sim/save';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { createWorld, submit, type World } from '../src/sim/world';

/** A short real game: a Scout launched on day 10, a tech chosen, a speed change and a stance. */
function play(w: World, days: number): void {
  const s = w.stores;
  while (s.run.day[0] < days) {
    const d = s.run.day[0];
    if (d === 3) {
      expect(submit(w, { type: 'ChooseTech', tech: 3 })).toEqual({ ok: true });
      applyCommandsNow(w);
    }
    if (d === 10) {
      const r = submit(w, {
        type: 'LaunchShip',
        colony: w.homeColony,
        target: firstOtherPlanet(w),
        hull: 0,
        passengers: 3,
        supplies: 10,
        fuel: 40,
        speed: 0,
        kit: 2,
        security: 2,
      });
      expect(r).toEqual({ ok: true });
      applyCommandsNow(w);
    }
    if (d === 20) {
      submit(w, { type: 'SetColonyStance', colony: w.homeColony, stance: 1 });
      applyCommandsNow(w);
    }
    if (d === 30) {
      submit(w, { type: 'SetGameSpeed', speed: 2 });
      applyCommandsNow(w);
    }
    tickDay(w);
  }
}

/** The nearest planet nobody owns (ties to the lowest index): a short trip a Scout can make. */
function firstOtherPlanet(w: World): number {
  const s = w.stores;
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < s.counts[G_PLANET]; p++) {
    if (s.planet.owner[p] >= 0) continue;
    const d = planetDistanceFp(s, w.homePlanet, p);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

describe('save and load', () => {
  it('a loaded game has the same day and hash, and 500 more days stay identical to the original', async () => {
    const a = createWorld(42);
    play(a, 200);
    const storage = createMemoryStorage();
    await storage.put(SAVE_SLOT, createSave(a));
    const data = await storage.get(SAVE_SLOT);
    expect(data).not.toBeNull();
    const b = loadSave(data as SaveData);
    expect(b.stores.run.day[0]).toBe(200);
    expect(b.stores.run.stateHash[0]).toBe(a.stores.run.stateHash[0]);
    expect(b.stores.counts[G_LOG]).toBe(a.stores.counts[G_LOG]);
    for (let d = 0; d < 500; d++) {
      tickDay(a);
      tickDay(b);
      if (d % 100 === 99) expect(b.stores.run.stateHash[0]).toBe(a.stores.run.stateHash[0]);
    }
    expect(b.stores.run.day[0]).toBe(700);
    expect(b.stores.run.stateHash[0]).toBe(a.stores.run.stateHash[0]);
  });

  it('a second save and load of the loaded game still matches (log carried over)', () => {
    const a = createWorld(7);
    play(a, 60);
    const b = loadSave(createSave(a));
    tickDay(b);
    tickDay(a);
    const c = loadSave(createSave(b));
    expect(c.stores.run.stateHash[0]).toBe(a.stores.run.stateHash[0]);
    expect(c.stores.counts[G_LOG]).toBe(a.stores.counts[G_LOG]);
  });

  it('the save holds the seed, the day and one log entry per applied command', () => {
    const w = createWorld(5);
    play(w, 40);
    const d = createSave(w);
    expect(d.version).toBe(SAVE_VERSION);
    expect(d.seed).toBe(5);
    expect(d.day).toBe(40);
    // ChooseTech, LaunchShip, SetColonyStance, SetGameSpeed
    expect(d.logDay.length).toBe(4);
    expect(Array.from(d.logDay)).toEqual([3, 10, 20, 30]);
    expect(d.logArgs.length).toBe(4 * COMMAND_MAX_ARGS);
    expect(saveProblem(d)).toBeNull();
  });

  it('creating a save applies commands still waiting in the queue', () => {
    const w = createWorld(9);
    play(w, 5);
    expect(submit(w, { type: 'SetGameSpeed', speed: 4 })).toEqual({ ok: true });
    expect(w.queue.count).toBe(1);
    const d = createSave(w);
    expect(w.queue.count).toBe(0);
    expect(d.logDay.length).toBe(2);
    const b = loadSave(d);
    expect(b.stores.run.speed[0]).toBe(4);
    expect(b.stores.run.stateHash[0]).toBe(w.stores.run.stateHash[0]);
  });

  it('refuses damaged saves with a readable message and never changes anything else', () => {
    const w = createWorld(3);
    play(w, 30);
    const good = createSave(w);
    const bad = (over: Partial<SaveData>): SaveData => ({ ...structuredClone(good), ...over });
    expect(() => loadSave(bad({ version: 99 }))).toThrow('different version');
    expect(() => loadSave(bad({ stateHash: good.stateHash ^ 1 }))).toThrow('hash mismatch');
    expect(() => loadSave(bad({ logType: good.logType.slice(1) }))).toThrow('log size');
    expect(() => loadSave(bad({ logArgs: good.logArgs.slice(1) }))).toThrow('log size');
    const type = good.logType.slice();
    type[0] = 200;
    expect(() => loadSave(bad({ logType: type }))).toThrow('command type');
    const days = good.logDay.slice();
    days[0] = 29;
    days[1] = 5;
    expect(() => loadSave(bad({ logDay: days }))).toThrow('log order');
    expect(() => loadSave(bad({ day: 5 }))).toThrow('log order');
    expect(() => loadSave(bad({ seed: 1.5 }))).toThrow('header');
    // A corrupt day far beyond the homeworld clock must be refused before any replay starts.
    expect(() => loadSave(bad({ day: 2_000_000_000 }))).toThrow('damaged (day)');
    expect(saveProblem(bad({ day: 8030 }))).not.toBe('The save is damaged (day).');
    expect(saveProblem(bad({ day: 8031 }))).toBe('The save is damaged (day).');
    expect(() => loadSave(null as unknown as SaveData)).toThrow('not readable');
    expect(() => loadSave({ ...good, logDay: [1] as unknown as Int32Array })).toThrow('log');
  });

  it('a save made with different game data is refused with a clear message', () => {
    const w = createWorld(3);
    play(w, 30);
    const good = createSave(w);
    expect(Number.isInteger(good.contentHash)).toBe(true);
    const other: SaveData = { ...structuredClone(good), contentHash: good.contentHash ^ 1 };
    expect(() => loadSave(other)).toThrow('saved with different game data');
    expect(saveProblem(other)).toContain('different game data');
    expect(() => loadSave({ ...structuredClone(good), contentHash: 1.5 })).toThrow('header');
  });

  it('a save of a day-0 game with no commands loads', () => {
    const w = createWorld(11);
    const b = loadSave(createSave(w));
    expect(b.stores.run.day[0]).toBe(0);
    expect(b.stores.run.stateHash[0]).toBe(w.stores.run.stateHash[0]);
  });

  it('the memory storage hands out independent copies and an empty slot is null', async () => {
    const st = createMemoryStorage();
    expect(await st.get('x')).toBeNull();
    const w = createWorld(2);
    const d = createSave(w);
    await st.put('x', d);
    const got = (await st.get('x')) as SaveData;
    got.logDay = new Int32Array(0);
    got.seed = 99;
    expect(((await st.get('x')) as SaveData).seed).toBe(2);
  });
});
