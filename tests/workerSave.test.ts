// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FromWorker } from '../src/shared/messages';
import type { SaveData } from '../src/shared/save';
import {
  META_DAY,
  META_STATE_HASH,
  META_TECH_CURRENT,
  type Snapshot,
} from '../src/shared/snapshot';
import { createHandler, MIN_SNAPSHOT_INTERVAL_MS } from '../src/worker/handler';

function setup() {
  const out: FromWorker[] = [];
  let now = 1000;
  const handler = createHandler({ postMessage: (m) => void out.push(m) }, () => now);
  const last = <K extends FromWorker['kind']>(kind: K): Extract<FromWorker, { kind: K }> => {
    const all = out.filter((m) => m.kind === kind);
    return all[all.length - 1] as Extract<FromWorker, { kind: K }>;
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += MIN_SNAPSHOT_INTERVAL_MS) {
      now += MIN_SNAPSHOT_INTERVAL_MS;
      handler.pump();
      // Give the buffers back like the page does, so snapshots keep coming.
      for (const m of out)
        if (m.kind === 'snapshot')
          handler.onMessage({ kind: 'returnBuffers', snapshot: m.snapshot });
      out.length = 0;
    }
  };
  return { handler, out, last, run };
}

const meta = (s: Snapshot, i: number) => s.meta[i];

describe('worker save and load messages', () => {
  it('save answers with the data of the running game; load into a fresh game restores it', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 1,
      command: { type: 'ChooseTech', tech: 3 },
    });
    h.run(5000);
    h.handler.onMessage({ kind: 'save', gen: 1, id: 10 });
    const saved = h.out.find((m) => m.kind === 'saved') as Extract<FromWorker, { kind: 'saved' }>;
    expect(saved.id).toBe(10);
    expect(saved.ok).toBe(true);
    const data = (saved as { data: SaveData }).data;
    expect(data.seed).toBe(42);
    expect(data.day).toBeGreaterThanOrEqual(4);
    expect(data.logDay.length).toBe(1);

    // A different game in between, then load the save.
    h.handler.onMessage({ kind: 'init', seed: 999, gen: 1 });
    h.handler.onMessage({ kind: 'load', gen: 1, id: 11, data });
    const res = h.out.find((m) => m.kind === 'loadResult') as Extract<
      FromWorker,
      { kind: 'loadResult' }
    >;
    expect(res).toEqual({ kind: 'loadResult', id: 11, gen: 1, ok: true, error: '' });
    const world = h.handler.getWorld();
    expect(world?.seed).toBe(42);
    expect(world?.stores.run.day[0]).toBe(data.day);
    expect(world?.stores.run.stateHash[0]).toBe(data.stateHash);
    expect(world?.stores.research.current[0]).toBe(3);
  });

  it('the first snapshot after a load shows the loaded game', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 5, gen: 1 });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 1,
      command: { type: 'ChooseTech', tech: 6 },
    });
    h.run(3000);
    h.handler.onMessage({ kind: 'save', gen: 1, id: 1 });
    const data = (h.out.find((m) => m.kind === 'saved') as { data: SaveData }).data;
    h.handler.onMessage({ kind: 'init', seed: 6, gen: 1 });
    h.out.length = 0;
    h.handler.onMessage({ kind: 'load', gen: 1, id: 2, data });
    const snap = (h.out.find((m) => m.kind === 'snapshot') as { snapshot: Snapshot }).snapshot;
    expect(meta(snap, META_DAY)).toBe(data.day);
    expect(meta(snap, META_STATE_HASH)).toBe(data.stateHash);
    expect(meta(snap, META_TECH_CURRENT)).toBe(6);
  });

  it('a damaged save is refused with a message and the running game is untouched', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 8, gen: 1 });
    h.run(2000);
    const before = h.handler.getWorld();
    const hash = before?.stores.run.stateHash[0];
    h.handler.onMessage({ kind: 'save', gen: 1, id: 1 });
    const data = (h.out.find((m) => m.kind === 'saved') as { data: SaveData }).data;
    h.handler.onMessage({
      kind: 'load',
      gen: 1,
      id: 2,
      data: { ...data, stateHash: data.stateHash ^ 1 },
    });
    const res = h.out.find((m) => m.kind === 'loadResult') as Extract<
      FromWorker,
      { kind: 'loadResult' }
    >;
    expect(res.ok).toBe(false);
    expect(res.error).toContain('hash mismatch');
    expect(h.handler.getWorld()).toBe(before);
    expect(h.handler.getWorld()?.stores.run.stateHash[0]).toBe(hash);
  });

  it('save before init answers with an error', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'save', gen: 1, id: 3 });
    expect(h.out[0]).toEqual({
      kind: 'saved',
      id: 3,
      gen: 1,
      ok: false,
      error: 'No game to save.',
    });
  });
});
