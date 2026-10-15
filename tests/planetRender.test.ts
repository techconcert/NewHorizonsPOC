// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  axialAdjacent,
  axialDistance,
  axialToWorld,
  hexX,
  hexZ,
  layoutCentres,
  pickHex,
  projectPoint,
  worldToAxial,
} from '../src/render/hexLayout';
import {
  FOG_EXPLORED,
  FOG_HIDDEN,
  FOG_HIDDEN_COLOR,
  FOG_VISIBLE,
  FIND_COLORS,
  TERRAIN_COLORS,
  tileColorHex,
  tileHeight,
} from '../src/render/hexPalette';
import { createMarkerLists, planMarkers } from '../src/render/planetMarkers';
import {
  ORBIT_MAX_AZIMUTH,
  ORBIT_MAX_POLAR,
  ORBIT_MIN_POLAR,
  createOrbit,
  orbitRotate,
  orbitZoom,
} from '../src/render/orbitCamera';
import { FIND_COUNT, TERRAIN_NAMES } from '../src/shared/terrain';

/** Column-major top-down orthographic-like view-projection: x,z map to screen, scale 0.1. */
function topDown(scale: number): Float64Array {
  const m = new Float64Array(16);
  m[0] = scale; // x -> ndc x
  m[9] = -scale; // z -> ndc y
  m[15] = 1;
  return m;
}

describe('hex layout', () => {
  it('axial to world is pointy-top with the right spacing', () => {
    const size = 2;
    expect(hexX(0, 0, size)).toBeCloseTo(0);
    expect(hexX(1, 0, size)).toBeCloseTo(size * Math.sqrt(3));
    expect(hexZ(1, size)).toBeCloseTo(size * 1.5);
    const out = new Float64Array(3);
    axialToWorld(1, 1, size, out, 1);
    expect(out[1]).toBeCloseTo(hexX(1, 1, size));
    expect(out[2]).toBeCloseTo(hexZ(1, size));
  });

  it('worldToAxial inverts axialToWorld for every hex of a patch', () => {
    const size = 1.3;
    const w = new Float64Array(3);
    const back: number[] = [0, 0];
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        axialToWorld(q, r, size, w, 0);
        worldToAxial(w[0], w[1], size, back);
        expect([back[0] + 0, back[1] + 0]).toEqual([q, r]);
      }
    }
  });

  it('distance and adjacency agree', () => {
    expect(axialDistance(0, 0, 2, -1)).toBe(2);
    expect(axialAdjacent(0, 0, 1, 0)).toBe(true);
    expect(axialAdjacent(0, 0, 2, 0)).toBe(false);
    expect(axialAdjacent(0, 0, 0, 0)).toBe(false);
  });

  it('layoutCentres centres the patch and returns a covering radius', () => {
    const q = [0, 1, 0, 1, -1, -1, 0];
    const r = [0, 0, 1, -1, 1, 0, -1];
    const out = new Float32Array(q.length * 3);
    const radius = layoutCentres(q, r, q.length, 1, 0.3, out);
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < q.length; i++) {
      sx += out[i * 3];
      sz += out[i * 3 + 2];
      expect(out[i * 3 + 1]).toBeCloseTo(0.3);
      expect(Math.hypot(out[i * 3], out[i * 3 + 2])).toBeLessThanOrEqual(radius);
    }
    expect(Math.abs(sx)).toBeLessThan(1e-4);
    expect(Math.abs(sz)).toBeLessThan(1e-4);
  });

  it('projectPoint maps the origin to the screen centre and rejects points behind the camera', () => {
    const out = new Float64Array(3);
    expect(projectPoint(topDown(0.1), 0, 0, 0, 800, 600, out)).toBe(true);
    expect(out[0]).toBeCloseTo(400);
    expect(out[1]).toBeCloseTo(300);
    const behind = new Float64Array(16);
    behind[15] = -1;
    expect(projectPoint(behind, 0, 0, 0, 800, 600, out)).toBe(false);
  });

  it('pickHex returns the nearest hex under the pointer and -1 in empty space', () => {
    const q = [0, 1, 0, 1];
    const r = [0, 0, 1, -1];
    const size = 1;
    const centres = new Float32Array(q.length * 3);
    layoutCentres(q, r, q.length, size, 0, centres);
    const vp = topDown(0.1);
    const out = new Float64Array(3);
    for (let i = 0; i < q.length; i++) {
      projectPoint(vp, centres[i * 3], 0, centres[i * 3 + 2], 800, 600, out);
      expect(pickHex(centres, q.length, vp, 800, 600, out[0], out[1], size)).toBe(i);
      // A small offset stays on the same hex.
      expect(pickHex(centres, q.length, vp, 800, 600, out[0] + 3, out[1] - 3, size)).toBe(i);
    }
    expect(pickHex(centres, q.length, vp, 800, 600, 5, 5, size)).toBe(-1);
  });
});

describe('fog and terrain colour', () => {
  it('hidden fog gives one colour whatever the terrain value (no leak)', () => {
    for (let t = 0; t < 256; t++) expect(tileColorHex(FOG_HIDDEN, t)).toBe(FOG_HIDDEN_COLOR);
    expect(tileColorHex(2, 3)).toBe(FOG_HIDDEN_COLOR);
  });

  it('revealed tiles use the terrain palette and visible is dimmer than explored', () => {
    expect(TERRAIN_COLORS.length).toBe(TERRAIN_NAMES.length);
    const seen = new Set<number>();
    for (let t = 0; t < TERRAIN_COLORS.length; t++) {
      expect(tileColorHex(FOG_EXPLORED, t)).toBe(TERRAIN_COLORS[t]);
      expect(tileColorHex(FOG_VISIBLE, t)).not.toBe(TERRAIN_COLORS[t]);
      expect(tileColorHex(FOG_VISIBLE, t)).not.toBe(FOG_HIDDEN_COLOR);
      seen.add(TERRAIN_COLORS[t]);
    }
    expect(seen.size).toBe(TERRAIN_COLORS.length);
    expect(tileColorHex(FOG_EXPLORED, 255)).toBe(FOG_HIDDEN_COLOR);
  });

  it('tile height grows as land is revealed', () => {
    expect(tileHeight(FOG_HIDDEN)).toBeLessThan(tileHeight(FOG_VISIBLE));
    expect(tileHeight(FOG_VISIBLE)).toBeLessThan(tileHeight(FOG_EXPLORED));
  });

  it('every find kind has a marker colour', () => {
    expect(FIND_COLORS.length).toBeGreaterThanOrEqual(FIND_COUNT);
  });
});

describe('marker planning', () => {
  const base = {
    count: 5,
    fog: [3, 3, 1, 0, 3],
    find: [1, 255, 2, 3, 0],
    landing: [1, 0, 0, 0, 0],
    native: [0, 1, 0, 1, 1],
    nativeMet: false,
    noneFind: 0,
    colonyRegion: -1,
    teams: [0, -1],
    teamCount: 2,
  };

  it('shows finds only on explored regions (and not "nothing"); natives only after contact', () => {
    const out = createMarkerLists();
    planMarkers(base, out);
    expect(Array.from(out.finds.subarray(0, out.findCount))).toEqual([0]);
    expect(out.nativeCount).toBe(0);
    expect(out.landingCount).toBe(1);
    expect(out.teamCount).toBe(1);
    planMarkers({ ...base, nativeMet: true }, out);
    expect(out.nativeCount).toBeGreaterThan(0);
    // Contact is what reveals the home regions (the snapshot only flags them after contact).
    expect(Array.from(out.natives.subarray(0, out.nativeCount))).toEqual([1, 3, 4]);
  });

  it('marks the colony region', () => {
    const out = createMarkerLists();
    planMarkers({ ...base, colonyRegion: 4 }, out);
    expect(out.colonyCount).toBe(1);
    expect(out.colony[0]).toBe(4);
  });
});

describe('orbit camera', () => {
  it('rotation and zoom stay inside their limits', () => {
    const o = createOrbit(10, 4, 20);
    orbitRotate(o, 1e6, 1e6);
    expect(Math.abs(o.azimuth)).toBeLessThanOrEqual(ORBIT_MAX_AZIMUTH + 1e-9);
    expect(o.polar).toBeGreaterThanOrEqual(ORBIT_MIN_POLAR - 1e-9);
    expect(o.polar).toBeLessThanOrEqual(ORBIT_MAX_POLAR + 1e-9);
    orbitRotate(o, -1e6, -1e6);
    expect(Math.abs(o.azimuth)).toBeLessThanOrEqual(ORBIT_MAX_AZIMUTH + 1e-9);
    expect(o.polar).toBeGreaterThanOrEqual(ORBIT_MIN_POLAR - 1e-9);
    orbitZoom(o, 1e6);
    expect(o.distance).toBe(20);
    orbitZoom(o, -1e6);
    expect(o.distance).toBe(4);
  });
});
