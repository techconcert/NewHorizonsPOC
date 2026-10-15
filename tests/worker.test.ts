// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FromWorker } from '../src/shared/messages';
import {
  META_DAY,
  META_HOME_DAYS,
  META_SPEED,
  META_STATE_HASH,
  META_SYSTEM_COUNT,
  snapshotBuffers,
  type Snapshot,
} from '../src/shared/snapshot';
import { createHandler, MIN_SNAPSHOT_INTERVAL_MS } from '../src/worker/handler';

function setup() {
  const out: FromWorker[] = [];
  let now = 1000;
  const handler = createHandler({ postMessage: (m) => void out.push(m) }, () => now);
  const snaps = () =>
    out.filter((m) => m.kind === 'snapshot').map((m) => (m as { snapshot: Snapshot }).snapshot);
  const results = () => out.filter((m) => m.kind === 'commandResult');
  /** Advance fake time in 50 ms steps, pumping the handler. */
  const run = (ms: number, step = MIN_SNAPSHOT_INTERVAL_MS) => {
    for (let t = 0; t < ms; t += step) {
      now += step;
      handler.pump();
    }
  };
  return { handler, out, snaps, results, run };
}

describe('worker handler', () => {
  it('Init creates a world and posts a snapshot', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 42, gen: 1 });
    const s = h.snaps();
    expect(s).toHaveLength(1);
    expect(s[0].meta[META_SYSTEM_COUNT]).toBeGreaterThanOrEqual(30);
    expect(s[0].meta[META_DAY]).toBe(0);
    expect(s[0].meta[META_HOME_DAYS]).toBe(8000);
  });

  it('rejects commands before Init', () => {
    const h = setup();
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 1,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    expect(h.results()[0]).toMatchObject({
      id: 1,
      gen: 1,
      result: { ok: false, reason: 'NOT_INITIALIZED' },
    });
  });

  it('replies accept or reject with a reason code', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 1, gen: 1 });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 7,
      command: { type: 'SetGameSpeed', speed: 2 },
    });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 8,
      command: { type: 'ChooseTech', tech: 99 },
    });
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 9,
      command: { type: 'SetGameSpeed', speed: 3 as never },
    });
    const r = h.results();
    expect(r[0]).toMatchObject({ id: 7, result: { ok: true } });
    expect(r[1]).toMatchObject({ id: 8, result: { ok: false, reason: 'INVALID_TECH' } });
    expect(r[2]).toMatchObject({ id: 9, result: { ok: false, reason: 'INVALID_SPEED' } });
  });

  it('SetSpeed 0 pauses at once and later commands apply while paused', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 5, gen: 1 });
    h.handler.onMessage({ kind: 'setSpeed', gen: 1, speed: 0 });
    h.run(2000);
    const day0 = h.snaps().at(-1)?.meta[META_DAY];
    expect(day0).toBe(0);
    expect(h.snaps().at(-1)?.meta[META_SPEED]).toBe(0);
    // A command while paused is applied without any tick.
    h.handler.onMessage({
      kind: 'command',
      gen: 1,
      id: 2,
      command: { type: 'SetGameSpeed', speed: 4 },
    });
    for (const sn of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: sn });
    h.run(MIN_SNAPSHOT_INTERVAL_MS * 2);
    expect(h.snaps().at(-1)?.meta[META_SPEED]).toBe(4);
    expect(h.snaps().at(-1)?.meta[META_DAY]).toBe(0);
  });

  it('reuses snapshot buffers once main returns them', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 3, gen: 1 });
    h.run(1500); // speed 1x: days change, snapshots due, but the pool is limited
    const first = h.snaps()[0];
    // Pool holds two snapshots; exhaust it without returning anything.
    h.run(4000);
    const unreturned = h.snaps().length;
    expect(unreturned).toBeLessThanOrEqual(2);
    h.handler.onMessage({ kind: 'returnBuffers', snapshot: first });
    h.run(2000);
    const all = h.snaps();
    expect(all.length).toBeGreaterThan(unreturned);
    expect(all.some((s, i) => i > 0 && s.positions.buffer === first.positions.buffer)).toBe(true);
    expect(new Set(all.map((s) => s.positions)).size).toBeLessThanOrEqual(2);
  });

  it('days increase at 1x given elapsed ms, and faster at 4x', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 9, gen: 1 });
    const give = () => {
      for (const s of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
    };
    const day = () => h.snaps().at(-1)?.meta[META_DAY] as number;
    for (let i = 0; i < 100; i++) {
      h.run(50);
      give();
    }
    expect(day()).toBe(5); // 5000 ms at 1x
    h.handler.onMessage({ kind: 'setSpeed', gen: 1, speed: 4 });
    for (let i = 0; i < 100; i++) {
      h.run(50);
      give();
    }
    expect(day()).toBe(25);
  });

  it('same seed gives the same hash in two handlers after the same elapsed time', () => {
    const hashAfter = (seed: number) => {
      const h = setup();
      h.handler.onMessage({ kind: 'init', seed, gen: 1 });
      h.handler.onMessage({ kind: 'setSpeed', gen: 1, speed: 2 });
      for (let i = 0; i < 200; i++) {
        h.run(50);
        for (const s of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
      }
      const last = h.snaps().at(-1) as Snapshot;
      return [last.meta[META_STATE_HASH], last.meta[META_DAY]];
    };
    const a = hashAfter(77);
    expect(hashAfter(77)).toEqual(a);
    expect(a[1]).toBeGreaterThan(0);
    expect(hashAfter(78)[0]).not.toBe(a[0]);
  });

  it('ignores unknown message kinds without posting', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 1, gen: 1 });
    const n = h.out.length;
    h.handler.onMessage({ kind: 'bogus' } as never);
    expect(h.out.length).toBe(n);
  });

  it('caps a huge dt at 8 days and ignores a negative dt', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 2, gen: 1 });
    h.run(60000, 60000);
    expect(h.snaps().at(-1)?.meta[META_DAY]).toBe(8);
    for (const s of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
    const before = h.out.length;
    h.run(-5000, -5000);
    expect(h.out.length).toBe(before);
  });

  it('repeated init resets the day and keeps the pool bounded', () => {
    const h = setup();
    for (let k = 0; k < 5; k++) {
      h.handler.onMessage({ kind: 'init', seed: 3, gen: 1 });
      h.run(3000);
      for (const s of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
    }
    h.handler.onMessage({ kind: 'init', seed: 3, gen: 1 });
    for (const s of h.snaps()) h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
    h.run(100);
    expect(h.snaps().at(-1)?.meta[META_DAY]).toBe(0);
    expect(new Set(h.snaps().map((s) => s.positions.buffer)).size).toBeLessThanOrEqual(2);
  });

  it('detached buffers returned shrink the pool, then it recovers', () => {
    const h = setup();
    h.handler.onMessage({ kind: 'init', seed: 4, gen: 1 });
    h.run(1500);
    const first = h.snaps();
    expect(first.length).toBeGreaterThanOrEqual(1);
    // Simulate main having transferred the buffers away: detach and return them.
    for (const s of first) {
      structuredClone(s, { transfer: snapshotBuffers(s) });
      h.handler.onMessage({ kind: 'returnBuffers', snapshot: s });
    }
    const posted = h.snaps().length;
    h.run(3000);
    expect(h.snaps().length).toBeGreaterThan(posted);
    const fresh = h.snaps().at(-1) as Snapshot;
    expect(fresh.positions.length).toBeGreaterThan(0);
  });
});
