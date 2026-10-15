// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  clockAdvance,
  clockAlpha,
  clockOnSnapshot,
  createInterpClock,
  lerpShipPositions,
} from '../src/render/interp';
import {
  createTrailStore,
  trailClear,
  trailCount,
  trailPush,
  writeTrailSegments,
} from '../src/render/trails';
import { legOrigin } from '../src/shared/transit';

describe('interpolation clock', () => {
  it('alpha is the real time in the day over the day length, by speed', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 10, 1);
    expect(clockAlpha(c)).toBe(0);
    clockAdvance(c, 500);
    expect(clockAlpha(c)).toBe(0.5);
    const d = createInterpClock();
    clockOnSnapshot(d, 10, 4);
    clockAdvance(d, 100);
    expect(clockAlpha(d)).toBe(0.4);
    const e = createInterpClock();
    clockOnSnapshot(e, 10, 2);
    clockAdvance(e, 250);
    expect(clockAlpha(e)).toBe(0.5);
  });

  it('clamps at 1 when the next snapshot is late and reports no change after that', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 1, 1);
    expect(clockAdvance(c, 1500)).toBe(true);
    expect(clockAlpha(c)).toBe(1);
    expect(clockAdvance(c, 16)).toBe(false);
    expect(clockAlpha(c)).toBe(1);
  });

  it('a new day restarts the fraction, the same day keeps it (a command snapshot does not stutter)', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 5, 1);
    clockAdvance(c, 400);
    clockOnSnapshot(c, 5, 1);
    expect(clockAlpha(c)).toBe(0.4);
    clockOnSnapshot(c, 6, 1);
    expect(clockAlpha(c)).toBe(0);
  });

  it('pause freezes ships where they are and resuming continues from there', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 5, 1);
    clockAdvance(c, 300);
    clockOnSnapshot(c, 5, 0); // paused
    expect(clockAdvance(c, 1000)).toBe(false);
    expect(clockAlpha(c)).toBe(0.3);
    clockOnSnapshot(c, 5, 2); // resumed at 2x
    clockAdvance(c, 100);
    expect(clockAlpha(c)).toBeCloseTo(0.5, 10);
  });

  it('ignores negative or zero steps', () => {
    const c = createInterpClock();
    clockOnSnapshot(c, 1, 1);
    expect(clockAdvance(c, 0)).toBe(false);
    expect(clockAdvance(c, -5)).toBe(false);
    expect(clockAlpha(c)).toBe(0);
  });
});

describe('lerpShipPositions', () => {
  // Snapshot layout: previous x,y then current x,y per ship.
  const pos = new Float32Array([0, 0, 10, 20, 100, 100, 100, 100]);

  it('interpolates prev to curr by alpha, per ship', () => {
    const out = new Float32Array(4);
    lerpShipPositions(pos, 2, 0.25, out);
    expect(Array.from(out)).toEqual([2.5, 5, 100, 100]);
  });

  it('alpha 0 is the previous and alpha 1 the current position', () => {
    const out = new Float32Array(4);
    lerpShipPositions(pos, 2, 0, out);
    expect(Array.from(out.subarray(0, 2))).toEqual([0, 0]);
    lerpShipPositions(pos, 2, 1, out);
    expect(Array.from(out.subarray(0, 2))).toEqual([10, 20]);
  });

  it('only writes the requested ship count', () => {
    const out = new Float32Array([-1, -1, -1, -1]);
    lerpShipPositions(pos, 1, 0.5, out);
    expect(Array.from(out)).toEqual([5, 10, -1, -1]);
  });
});

describe('trail ring buffer', () => {
  it('stores points per entity, newest first when written out', () => {
    const t = createTrailStore(16, 4);
    trailPush(t, 3, 1, 1);
    trailPush(t, 3, 2, 2);
    trailPush(t, 3, 3, 3);
    expect(trailCount(t, 3)).toBe(3);
    expect(trailCount(t, 4)).toBe(0);
    const out = new Float32Array(4 * 6);
    const fade = new Float32Array(4 * 2);
    const segs = writeTrailSegments(t, 3, 4, 4, out, 0, fade, 0);
    expect(segs).toBe(3);
    // head (4,4) to newest (3,3), then (3,3) to (2,2), then (2,2) to (1,1)
    expect(Array.from(out.subarray(0, 18))).toEqual([
      4, 4, 0, 3, 3, 0, 3, 3, 0, 2, 2, 0, 2, 2, 0, 1, 1, 0,
    ]);
  });

  it('overwrites the oldest point when full and keeps the count at capacity', () => {
    const t = createTrailStore(8, 3);
    for (let i = 1; i <= 5; i++) trailPush(t, 0, i, i * 10);
    expect(trailCount(t, 0)).toBe(3);
    const out = new Float32Array(3 * 6);
    const fade = new Float32Array(3 * 2);
    writeTrailSegments(t, 0, 6, 60, out, 0, fade, 0);
    // newest first: 5, 4, 3 (1 and 2 were overwritten)
    expect([out[3], out[9], out[15]]).toEqual([5, 4, 3]);
    expect([out[4], out[10], out[16]]).toEqual([50, 40, 30]);
  });

  it('skips a point equal to the newest (a ship standing still)', () => {
    const t = createTrailStore(4, 4);
    expect(trailPush(t, 1, 5, 5)).toBe(true);
    expect(trailPush(t, 1, 5, 5)).toBe(false);
    expect(trailCount(t, 1)).toBe(1);
    expect(trailPush(t, 1, 6, 5)).toBe(true);
    expect(trailCount(t, 1)).toBe(2);
  });

  it('fades from the head to the tail and writes at the given offsets', () => {
    const t = createTrailStore(4, 4);
    trailPush(t, 0, 1, 0);
    trailPush(t, 0, 2, 0);
    const out = new Float32Array(12 + 12);
    const fade = new Float32Array(4 + 4);
    const segs = writeTrailSegments(t, 0, 3, 0, out, 12, fade, 4);
    expect(segs).toBe(2);
    expect(Array.from(out.subarray(12, 15))).toEqual([3, 0, 0]);
    expect(fade[4]).toBeCloseTo(1, 6);
    expect(fade[4]).toBeGreaterThan(fade[5]);
    expect(fade[5]).toBeGreaterThan(fade[7]);
    expect(fade[7]).toBeGreaterThan(0);
  });

  it('clears an entity and ignores ids beyond the capacity', () => {
    const t = createTrailStore(4, 4);
    trailPush(t, 2, 1, 1);
    trailClear(t, 2);
    expect(trailCount(t, 2)).toBe(0);
    expect(trailPush(t, 99, 1, 1)).toBe(false);
    expect(trailPush(t, -1, 1, 1)).toBe(false);
    expect(trailCount(t, 99)).toBe(0);
  });

  it('entities do not share points', () => {
    const t = createTrailStore(4, 3);
    trailPush(t, 0, 1, 1);
    trailPush(t, 1, 9, 9);
    expect(trailCount(t, 0)).toBe(1);
    const out = new Float32Array(6);
    const fade = new Float32Array(2);
    writeTrailSegments(t, 1, 0, 0, out, 0, fade, 0);
    expect([out[3], out[4]]).toEqual([9, 9]);
  });
});

describe('legOrigin', () => {
  it('recovers the start of the leg from the position, the target and the progress', () => {
    const out = new Float32Array(2);
    // origin (0,0), target (100,0), a quarter of the way: position (25,0)
    legOrigin(25, 0, 100, 0, 25, 100, out, 0);
    expect(out[0]).toBeCloseTo(0, 4);
    expect(out[1]).toBeCloseTo(0, 4);
    // origin (10,20), target (110,220), 40% of the way: position (50,100)
    legOrigin(50, 100, 110, 220, 40, 100, out, 0);
    expect(out[0]).toBeCloseTo(10, 4);
    expect(out[1]).toBeCloseTo(20, 4);
  });

  it('falls back to the ship position at progress 0 and at the end of the leg', () => {
    const out = new Float32Array(2);
    legOrigin(7, 8, 100, 100, 0, 500, out, 0);
    expect(Array.from(out)).toEqual([7, 8]);
    legOrigin(100, 100, 100, 100, 500, 500, out, 0);
    expect(Array.from(out)).toEqual([100, 100]);
    legOrigin(3, 4, 9, 9, 10, 0, out, 0);
    expect(Array.from(out)).toEqual([3, 4]);
  });
});
