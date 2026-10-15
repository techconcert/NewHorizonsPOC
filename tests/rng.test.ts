// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRngStore, nextFloat, nextInt, nextU32, seedSlot } from '../src/sim/rng';

function draw(seed: number, slot: number, n: number): number[] {
  const r = createRngStore(16);
  seedSlot(r, slot, seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(nextU32(r, slot));
  return out;
}

describe('sfc32 PRNG', () => {
  // Expected values computed with an independent closure-based implementation of the same spec.
  it('matches known answers', () => {
    expect(draw(0, 0, 5)).toEqual([591558436, 2737234123, 107644106, 1338548054, 2499804003]);
    expect(draw(12345, 0, 5)).toEqual([1078275238, 690397186, 1485646867, 411541311, 663673718]);
    expect(draw(12345, 7, 5)).toEqual([651403784, 2093319383, 965104227, 2008602186, 1503873853]);
    expect(draw(0xdeadbeef, 3, 5)).toEqual([
      2857082079, 1985880248, 2818965238, 516053965, 169959553,
    ]);
  });

  it('a roll depends only on seed and slot, not on other slots', () => {
    const r = createRngStore(16);
    seedSlot(r, 1, 99);
    seedSlot(r, 2, 99);
    const a = [nextU32(r, 1), nextU32(r, 1)];
    for (let i = 0; i < 50; i++) nextU32(r, 2);
    const r2 = createRngStore(16);
    seedSlot(r2, 1, 99);
    expect([nextU32(r2, 1), nextU32(r2, 1)]).toEqual(a);
  });

  it('different slots give different streams', () => {
    expect(draw(5, 1, 3)).not.toEqual(draw(5, 2, 3));
  });

  it('floats are in [0,1) with mean near 0.5 over 100000 draws', () => {
    const r = createRngStore(2);
    seedSlot(r, 0, 2024);
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      const f = nextFloat(r, 0);
      expect(f >= 0 && f < 1).toBe(true);
      sum += f;
    }
    const mean = sum / 100000;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });

  it('nextInt stays inside the inclusive range and hits both ends', () => {
    const r = createRngStore(2);
    seedSlot(r, 0, 7);
    let sawLo = false;
    let sawHi = false;
    for (let i = 0; i < 5000; i++) {
      const v = nextInt(r, 0, 3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      if (v === 3) sawLo = true;
      if (v === 9) sawHi = true;
    }
    expect(sawLo && sawHi).toBe(true);
  });
});
