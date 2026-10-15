// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createView,
  fitScale,
  panBy,
  pickNearest,
  resizeView,
  screenX,
  screenY,
  worldX,
  worldY,
  zoomAt,
  MAX_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  normalizeWheelDelta,
} from '../src/render/pick';
import { MAX_SYSTEMS } from '../src/sim/components';
import { SNAPSHOT_MAX_SYSTEMS } from '../src/shared/snapshot';

function view() {
  const v = createView();
  v.width = 800;
  v.height = 600;
  v.scale = fitScale(800, 600);
  return v;
}

describe('view math', () => {
  it('snapshot capacity matches the sim', () => {
    expect(SNAPSHOT_MAX_SYSTEMS).toBe(MAX_SYSTEMS);
  });

  it('world/screen conversion round-trips and centre maps to the middle', () => {
    const v = view();
    expect(screenX(v, v.cx)).toBeCloseTo(400);
    expect(screenY(v, v.cy)).toBeCloseTo(300);
    expect(worldX(v, screenX(v, 123))).toBeCloseTo(123);
    expect(worldY(v, screenY(v, 777))).toBeCloseTo(777);
  });

  it('screen y is flipped (world up is screen up)', () => {
    const v = view();
    expect(screenY(v, v.cy + 10)).toBeLessThan(screenY(v, v.cy));
  });

  it('pan moves the world with the cursor', () => {
    const v = view();
    const before = screenX(v, 500);
    panBy(v, 30, 0);
    expect(screenX(v, 500)).toBeCloseTo(before + 30);
  });

  it('zoom keeps the point under the cursor fixed and clamps', () => {
    const v = view();
    const wx = worldX(v, 200);
    const wy = worldY(v, 100);
    zoomAt(v, 200, 100, 2);
    expect(worldX(v, 200)).toBeCloseTo(wx);
    expect(worldY(v, 100)).toBeCloseTo(wy);
    const fit = fitScale(800, 600);
    for (let i = 0; i < 50; i++) zoomAt(v, 400, 300, 2);
    expect(v.scale).toBeCloseTo(fit * MAX_ZOOM_FACTOR);
    for (let i = 0; i < 100; i++) zoomAt(v, 400, 300, 0.5);
    expect(v.scale).toBeCloseTo(fit * MIN_ZOOM_FACTOR);
  });

  it('resize keeps the relative zoom', () => {
    const v = view();
    zoomAt(v, 400, 300, 2);
    const rel = v.scale / fitScale(800, 600);
    resizeView(v, 1600, 900);
    expect(v.scale / fitScale(1600, 900)).toBeCloseTo(rel);
  });
});

describe('pickNearest', () => {
  const pos = new Float32Array([500, 500, 600, 500, 500, 700]);

  it('picks the nearest system within the radius', () => {
    const v = view();
    const sx = screenX(v, 600) + 3;
    const sy = screenY(v, 500) - 2;
    expect(pickNearest(pos, 3, v, sx, sy, 20)).toBe(1);
  });

  it('returns -1 when nothing is within the radius', () => {
    const v = view();
    expect(pickNearest(pos, 3, v, screenX(v, 100), screenY(v, 100), 20)).toBe(-1);
  });

  it('ignores entries beyond count and picks the closer of two', () => {
    const v = view();
    expect(pickNearest(pos, 1, v, screenX(v, 600), screenY(v, 500), 20)).toBe(-1);
    const mid = screenX(v, 540);
    expect(pickNearest(pos, 3, v, mid, screenY(v, 500), 1000)).toBe(0);
  });
});

describe('normalizeWheelDelta', () => {
  it('scales lines by 16 and pages by 100', () => {
    expect(normalizeWheelDelta(3, 0)).toBe(3);
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(-2, 2)).toBe(-200);
  });
});
