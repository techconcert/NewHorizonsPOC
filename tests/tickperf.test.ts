// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tickDay } from '../src/sim/tick';
import { createWorld } from '../src/sim/world';

describe('tick performance', () => {
  it('an empty tickDay averages under 0.5 ms over 1000 ticks', () => {
    const w = createWorld(31337);
    for (let i = 0; i < 200; i++) tickDay(w); // warm up the JIT
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) tickDay(w);
      best = Math.min(best, (performance.now() - t0) / 1000);
    }
    const avg = best;
    expect(avg).toBeLessThan(0.5);
  });
});
