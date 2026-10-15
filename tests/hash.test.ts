// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { hashGalaxy, hashState } from '../src/sim/hash';
import { tickDay } from '../src/sim/tick';
import { createWorld, spawnEntity, submit } from '../src/sim/world';

describe('state hash coverage', () => {
  it('mutating one element of every hashed dynamic store changes the hash', () => {
    const w = createWorld(123);
    const s = w.stores;
    spawnEntity(w); // a second entity, so entity-indexed prefixes have two rows
    submit(w, { type: 'SetGameSpeed', speed: 2 }); // makes the command log non-empty
    tickDay(w);
    let tested = 0;
    for (const tg of s.dynamicTargets) {
      // The counts array defines the live prefixes themselves; corrupting it changes loop bounds.
      if (tg.bytes.buffer === s.counts.buffer) continue;
      const live = tg.unitBytes * (s.counts[tg.group] as number);
      expect(live).toBeGreaterThan(0);
      const before = hashState(s);
      // Flip the last live byte so every store is exercised at the end of its prefix.
      const idx = live - 1;
      const old = tg.bytes[idx] as number;
      tg.bytes[idx] = old ^ 0x5a;
      expect(hashState(s)).not.toBe(before);
      tg.bytes[idx] = old;
      expect(hashState(s)).toBe(before);
      tested++;
    }
    expect(tested).toBe(s.dynamicTargets.length - 1);
    expect(tested).toBeGreaterThan(40);
  });

  it('mutating one element of every static galaxy store changes the galaxy hash', () => {
    const s = createWorld(123).stores;
    for (const tg of s.staticTargets) {
      const live = tg.unitBytes * (s.counts[tg.group] as number);
      expect(live).toBeGreaterThan(0);
      const before = hashGalaxy(s);
      const old = tg.bytes[live - 1] as number;
      tg.bytes[live - 1] = old ^ 0x5a;
      expect(hashGalaxy(s)).not.toBe(before);
      tg.bytes[live - 1] = old;
    }
  });

  it('per-entity RNG state is part of the hash', () => {
    const w = createWorld(7);
    const before = hashState(w.stores);
    w.stores.rng.a[3] = (w.stores.rng.a[3] as number) ^ 1;
    expect(hashState(w.stores)).not.toBe(before);
  });
});
