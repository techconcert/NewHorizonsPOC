// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  fillFogTexture,
  FOG_LEVEL_EXPLORED,
  FOG_LEVEL_VISIBLE,
  FOG_TEX_SIZE,
} from '../src/render/fogTexture';
import {
  FOG_EXPLORED,
  FOG_HIDDEN,
  FOG_HIDDEN_COLOR,
  FOG_VISIBLE,
  NATIVE_TINTS,
  SHORE_COLOR,
  TERRAIN_COLORS,
  TERRAIN_RELIEF,
  tileBaseColorHex,
  tileCentreLift,
  tileHeight,
  tileTopY,
} from '../src/render/hexPalette';
import { layoutCentres } from '../src/render/hexLayout';
import {
  IDLE_AZIMUTH_AMPLITUDE,
  IDLE_POLAR_AMPLITUDE,
  idleAzimuth,
  idlePolar,
} from '../src/render/orbitCamera';
import { buildPropGeometry, buildSiteGeometry } from '../src/render/propModels';
import {
  createPropList,
  planRegionProps,
  PROP_KINDS,
  PROP_MAX_RADIUS,
  PROP_REGION_MAX,
  propCountFor,
  PropKind,
  surfaceOffset,
  writeInstanceMatrix,
} from '../src/render/propPlan';
import {
  BUILDING_SCALE,
  colonistDots,
  createSiteList,
  MODEL_COUNT,
  Model,
  planSites,
  type SiteInput,
} from '../src/render/settlementPlan';
import {
  BEVEL,
  buildTerrain,
  createTerrainBuffers,
  HEX_INDICES,
  HEX_VERTS,
  hexToLinear,
  INNER_RADIUS,
  neighbourTable,
  OUTER_RADIUS,
  srgbToLinear,
} from '../src/render/terrainMesh';

// A seven-hex flower: region 0 in the middle, 1..6 around it.
const Q = [0, 1, 0, -1, -1, 0, 1];
const R = [0, 0, 1, 1, 0, -1, -1];

function flower() {
  const centres = new Float32Array(7 * 3);
  layoutCentres(Q, R, 7, 1, 0, centres);
  const nbr = new Int8Array(7 * 6);
  neighbourTable(Q, R, 7, nbr);
  return { centres, nbr };
}

describe('terrain mesh', () => {
  const { centres, nbr } = flower();
  const tops = new Float32Array([0.4, 0.4, 0.26, 0.4, 0.12, 0.4, 0.4]);
  const lift = new Float32Array(7);
  const hex = new Int32Array(7).fill(TERRAIN_COLORS[0]);
  hex[1] = TERRAIN_COLORS[2];
  const buf = createTerrainBuffers(19);
  const n = buildTerrain(7, Q, R, centres, tops, lift, hex, nbr, 1, 5, buf);

  it('draws 90 indices per hex and every index points at a vertex of a drawn hex', () => {
    expect(n).toBe(7 * HEX_INDICES);
    for (let i = 0; i < n; i++) expect(buf.index[i]).toBeLessThan(7 * HEX_VERTS);
  });

  it('faces the top fan and bevel up and the skirt outward', () => {
    const p = buf.positions;
    const tri = (t: number): number[] => {
      const a = buf.index[t * 3] * 3;
      const b = buf.index[t * 3 + 1] * 3;
      const c = buf.index[t * 3 + 2] * 3;
      const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      return [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
    };
    const cx = centres[0];
    const cz = centres[2];
    for (let k = 0; k < 6; k++) {
      const base = (k * 15) / 3; // 5 triangles per k
      // fan (1), bevel (2), skirt (2) in the order the index builder writes them
      expect(tri(base + 0)[1]).toBeGreaterThan(0);
      expect(tri(base + 1)[1]).toBeGreaterThan(0);
      expect(tri(base + 2)[1]).toBeGreaterThan(0);
      for (const t of [base + 3, base + 4]) {
        const nrm = tri(t);
        const a = buf.index[t * 3] * 3;
        // outward = away from the hex centre, horizontal
        const out = nrm[0] * (p[a] - cx) + nrm[2] * (p[a + 2] - cz);
        expect(out).toBeGreaterThan(0);
        expect(Math.abs(nrm[1])).toBeLessThan(1e-4);
      }
    }
  });

  it('stands the tile on its top height with a bevelled rim and a skirt to the water', () => {
    const p = buf.positions;
    for (let k = 0; k < 6; k++) {
      expect(p[(1 + k) * 3 + 1]).toBeCloseTo(0.4);
      expect(p[(7 + k) * 3 + 1]).toBeCloseTo(0.4 - BEVEL);
      expect(p[(19 + k) * 3 + 1]).toBeLessThan(0);
      const dx = p[(1 + k) * 3] - centres[0];
      const dz = p[(1 + k) * 3 + 2] - centres[2];
      expect(Math.hypot(dx, dz)).toBeCloseTo(INNER_RADIUS);
      const ox = p[(7 + k) * 3] - centres[0];
      const oz = p[(7 + k) * 3 + 2] - centres[2];
      expect(Math.hypot(ox, oz)).toBeCloseTo(OUTER_RADIUS);
    }
    expect(p[1]).toBeCloseTo(0.4); // centre, no lift
  });

  it('lifts a peak and sinks a bowl through the centre lift', () => {
    const lf = new Float32Array(7);
    lf[0] = 0.2;
    lf[3] = -0.18;
    const b2 = createTerrainBuffers(19);
    buildTerrain(7, Q, R, centres, tops, lf, hex, nbr, 1, 5, b2);
    expect(b2.positions[1]).toBeCloseTo(0.6);
    expect(b2.positions[3 * HEX_VERTS * 3 + 1]).toBeCloseTo(0.4 - 0.18);
  });

  it('blends colours across tile borders: both hexes agree on a shared corner', () => {
    // Regions 0 and 1 share two corners; the outer ring colour there is the same average.
    const c = buf.colors;
    // direction 0 of region 0 is region 1: corners 0 and 5 of hex 0 are corners 2 and 3 of hex 1.
    expect(nbr[0 * 6 + 0]).toBe(1);
    const match = (a: number, b: number): void => {
      // equal up to the per-tile brightness is not required: both use the same corner average
      for (let ch = 0; ch < 3; ch++) {
        expect(c[(0 * HEX_VERTS + 7 + a) * 3 + ch]).toBeCloseTo(
          c[(1 * HEX_VERTS + 7 + b) * 3 + ch],
          5,
        );
      }
    };
    match(0, 2);
    match(5, 3);
  });

  it('tints the outside of a coast tile towards the shore colour', () => {
    // Region 1 (jungle) has no neighbour in direction 0; its corner 0 sits on the coast.
    expect(nbr[1 * 6 + 0]).toBe(-1);
    const shore = new Float32Array(3);
    hexToLinear(SHORE_COLOR, shore, 0);
    const own = new Float32Array(3);
    hexToLinear(TERRAIN_COLORS[2], own, 0);
    const c = buf.colors;
    const coastRed = c[(1 * HEX_VERTS + 7 + 0) * 3];
    const inlandRed = c[(0 * HEX_VERTS + 7 + 2) * 3];
    expect(coastRed).toBeGreaterThan(own[0] * 0.9 * 0.96); // pulled towards the pale shore
    expect(inlandRed).toBeGreaterThan(0);
  });

  it('darkens the cliff towards the foot (fake occlusion) and is deterministic', () => {
    const c = buf.colors;
    const rim = c[7 * 3 + 1];
    const skirtTop = c[13 * 3 + 1];
    const foot = c[19 * 3 + 1];
    expect(skirtTop).toBeLessThan(rim);
    expect(foot).toBeLessThan(skirtTop);
    const again = createTerrainBuffers(19);
    buildTerrain(7, Q, R, centres, tops, lift, hex, nbr, 1, 5, again);
    expect(Array.from(again.colors.subarray(0, 7 * HEX_VERTS * 3))).toEqual(
      Array.from(buf.colors.subarray(0, 7 * HEX_VERTS * 3)),
    );
  });

  it('neighbour table agrees with adjacency', () => {
    for (let d = 0; d < 6; d++) expect(nbr[d]).toBeGreaterThanOrEqual(1);
    expect(new Set(Array.from(nbr.subarray(0, 6))).size).toBe(6);
  });

  it('converts sRGB to linear', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3);
  });
});

describe('relief and fog colours', () => {
  it('hidden tiles show no terrain relief or colour, whatever the terrain value', () => {
    for (let t = 0; t < 256; t++) {
      expect(tileTopY(FOG_HIDDEN, t)).toBe(tileHeight(FOG_HIDDEN));
      expect(tileCentreLift(FOG_HIDDEN, t)).toBe(0);
      expect(tileBaseColorHex(FOG_HIDDEN, t)).toBe(FOG_HIDDEN_COLOR);
    }
  });

  it('revealed highlands stand higher than plains, craters lower, and colours are full', () => {
    expect(tileTopY(FOG_EXPLORED, 1)).toBeGreaterThan(tileTopY(FOG_EXPLORED, 0));
    expect(tileCentreLift(FOG_EXPLORED, 4)).toBeLessThan(0);
    expect(tileCentreLift(FOG_EXPLORED, 1)).toBeGreaterThan(0);
    expect(TERRAIN_RELIEF.length).toBe(TERRAIN_COLORS.length);
    for (let t = 0; t < TERRAIN_COLORS.length; t++) {
      expect(tileBaseColorHex(FOG_VISIBLE, t)).toBe(TERRAIN_COLORS[t]);
      expect(tileBaseColorHex(FOG_EXPLORED, t)).toBe(TERRAIN_COLORS[t]);
    }
    expect(tileBaseColorHex(FOG_EXPLORED, 255)).toBe(FOG_HIDDEN_COLOR);
  });
});

describe('props', () => {
  it('are a pure function of planet seed, region and terrain', () => {
    const a = createPropList(64);
    const b = createPropList(64);
    planRegionProps(7, 3, 2, 100, 0, a);
    planRegionProps(7, 3, 2, 100, 0, b);
    expect(a.count).toBeGreaterThan(0);
    expect(Array.from(a.x.subarray(0, a.count))).toEqual(Array.from(b.x.subarray(0, b.count)));
    expect(Array.from(a.kind.subarray(0, a.count))).toEqual(
      Array.from(b.kind.subarray(0, b.count)),
    );
    const c = createPropList(64);
    planRegionProps(8, 3, 2, 100, 0, c);
    expect(Array.from(c.x.subarray(0, c.count))).not.toEqual(Array.from(a.x.subarray(0, a.count)));
  });

  it('never change when another region is planned first', () => {
    const solo = createPropList(128);
    planRegionProps(4, 5, 1, 100, 0, solo);
    const both = createPropList(128);
    planRegionProps(4, 2, 0, 100, 0, both);
    const before = both.count;
    planRegionProps(4, 5, 1, 100, 0, both);
    expect(both.count - before).toBe(solo.count);
    for (let i = 0; i < solo.count; i++) {
      expect(both.x[before + i]).toBe(solo.x[i]);
      expect(both.z[before + i]).toBe(solo.z[i]);
      expect(both.rot[before + i]).toBe(solo.rot[i]);
    }
  });

  it('stay inside the hex, outside a cleared disc, and under the per-region cap', () => {
    for (let terrain = 0; terrain < 6; terrain++) {
      for (let region = 0; region < 19; region++) {
        const list = createPropList(64);
        planRegionProps(11, region, terrain, 100, 0.55, list);
        expect(list.count).toBeLessThanOrEqual(PROP_REGION_MAX);
        expect(list.count).toBe(Math.min(list.count, propCountFor(11, region, terrain)));
        for (let i = 0; i < list.count; i++) {
          const rad = Math.hypot(list.x[i], list.z[i]);
          expect(rad).toBeGreaterThanOrEqual(0.55 - 1e-6);
          expect(rad).toBeLessThanOrEqual(PROP_MAX_RADIUS + 1e-6);
          expect(list.scale[i]).toBeGreaterThan(0.5);
          expect(list.shade[i]).toBeGreaterThanOrEqual(0.85);
          expect(list.shade[i]).toBeLessThanOrEqual(1.15);
        }
      }
    }
  });

  it('thin out on visible ground but keep the same first props', () => {
    const full = createPropList(64);
    const thin = createPropList(64);
    planRegionProps(3, 1, 2, 100, 0, full);
    planRegionProps(3, 1, 2, 55, 0, thin);
    expect(thin.count).toBeLessThan(full.count);
    expect(thin.count).toBeGreaterThan(0);
    expect(thin.x[0]).toBe(full.x[0]);
  });

  it('add nothing for a hidden region (terrain 255) or an over-large cleared disc', () => {
    const list = createPropList(64);
    planRegionProps(3, 1, 255, 100, 0, list);
    planRegionProps(3, 1, 0, 100, 0.9, list);
    expect(list.count).toBe(0);
  });

  it('fit each terrain: jungle is trees, ice is crystals, ruins are masonry, plains are grass', () => {
    const kinds = (terrain: number): Set<number> => {
      const s = new Set<number>();
      for (let region = 0; region < 19; region++) {
        const list = createPropList(64);
        planRegionProps(1, region, terrain, 100, 0, list);
        for (let i = 0; i < list.count; i++) s.add(list.kind[i]);
      }
      return s;
    };
    expect(kinds(2)).toEqual(new Set([PropKind.Round, PropKind.Tuft]));
    expect(kinds(3).has(PropKind.Crystal)).toBe(true);
    expect(kinds(5).has(PropKind.Pillar)).toBe(true);
    expect(kinds(5).has(PropKind.Slab)).toBe(true);
    expect(kinds(0).has(PropKind.Tuft)).toBe(true);
    expect(kinds(1).has(PropKind.Pine)).toBe(true);
  });

  it('a whole 19-region planet stays far under the 5,000 prop budget', () => {
    const list = createPropList(19 * PROP_REGION_MAX);
    for (let region = 0; region < 19; region++)
      planRegionProps(2, region, region % 6, 100, 0, list);
    expect(list.count).toBeLessThan(19 * PROP_REGION_MAX + 1);
    expect(list.count).toBeLessThan(5000);
  });

  it('surface height follows the lift and the bevel', () => {
    expect(surfaceOffset(0, 0.2)).toBeCloseTo(0.2);
    expect(surfaceOffset(INNER_RADIUS, 0.2)).toBeCloseTo(0);
    expect(surfaceOffset(INNER_RADIUS / 2, -0.18)).toBeCloseTo(-0.09);
    expect(surfaceOffset(OUTER_RADIUS, 0.2)).toBeCloseTo(-BEVEL);
  });

  it('write a column-major matrix with scale, turn and move', () => {
    const arr = new Float32Array(32);
    writeInstanceMatrix(arr, 1, 1, 2, 3, 2, Math.PI / 2);
    const m = Array.from(arr.subarray(16));
    expect(m[0]).toBeCloseTo(0);
    expect(m[2]).toBeCloseTo(-2);
    expect(m[5]).toBe(2);
    expect(m[8]).toBeCloseTo(2);
    expect(m[10]).toBeCloseTo(0);
    expect(m.slice(12)).toEqual([1, 2, 3, 1]);
    expect(Array.from(arr.subarray(0, 16)).every((v) => v === 0)).toBe(true);
  });
});

function siteInput(over: Partial<SiteInput> = {}): SiteInput {
  return {
    count: 7,
    fog: new Uint8Array(7).fill(FOG_EXPLORED),
    native: new Uint8Array(7),
    nativeKind: 0,
    district: new Uint8Array(7),
    districtLeft: new Uint8Array(7),
    colonyRegion: -1,
    colonyDots: 0,
    ...over,
  };
}

describe('settlements', () => {
  it('place one model per district kind, smaller and greyed while it is being built', () => {
    const district = new Uint8Array(7);
    const left = new Uint8Array(7);
    for (let k = 1; k <= 6; k++) district[k] = k;
    left[3] = 4;
    const out = createSiteList(64);
    planSites(9, siteInput({ district, districtLeft: left }), out);
    expect(out.count).toBe(6);
    for (let i = 0; i < out.count; i++) {
      expect(out.model[i]).toBe(out.region[i] - 1);
      expect(out.region[i]).toBe(i + 1);
    }
    expect(out.model[2]).toBe(Model.Refinery);
    expect(out.scale[2]).toBeCloseTo(BUILDING_SCALE, 5);
    expect(out.tint[2]).not.toBe(0xffffff);
    expect(out.scale[0]).toBe(1);
    expect(out.x[0]).toBe(0);
  });

  it('put the core at the landing site, beside a district if one stands there', () => {
    const out = createSiteList(64);
    planSites(9, siteInput({ colonyRegion: 0, colonyDots: 5 }), out);
    expect(out.model[0]).toBe(Model.Core);
    expect(out.x[0]).toBe(0);
    let dots = 0;
    for (let i = 0; i < out.count; i++) if (out.model[i] === Model.Dot) dots++;
    expect(dots).toBe(5);
    const district = new Uint8Array(7);
    district[0] = 6;
    const both = createSiteList(64);
    planSites(9, siteInput({ colonyRegion: 0, district, colonyDots: 0 }), both);
    expect(both.count).toBe(2);
    const models = [both.model[0], both.model[1]].sort();
    expect(models).toEqual([Model.Spaceport, Model.Core]);
    expect(both.x[0]).not.toBe(both.x[1]);
  });

  it('raise 3 to 5 huts and a few dots on native ground, tinted by disposition', () => {
    const native = new Uint8Array(7);
    native[2] = 1;
    for (let kind = 1; kind <= 3; kind++) {
      const out = createSiteList(64);
      planSites(9, siteInput({ native, nativeKind: kind }), out);
      let huts = 0;
      let dots = 0;
      for (let i = 0; i < out.count; i++) {
        expect(out.region[i]).toBe(2);
        expect(out.tint[i]).toBe(NATIVE_TINTS[kind]);
        if (out.model[i] === Model.Hut) huts++;
        else if (out.model[i] === Model.Dot) dots++;
        expect(Math.hypot(out.x[i], out.z[i])).toBeLessThan(0.75);
      }
      expect(huts).toBeGreaterThanOrEqual(3);
      expect(huts).toBeLessThanOrEqual(5);
      expect(dots).toBeGreaterThanOrEqual(2);
      expect(dots).toBeLessThanOrEqual(4);
    }
    expect(new Set([NATIVE_TINTS[1], NATIVE_TINTS[2], NATIVE_TINTS[3]]).size).toBe(3);
  });

  it('draw nothing before contact and nothing in hidden regions', () => {
    const native = new Uint8Array(7).fill(1);
    const out = createSiteList(64);
    planSites(9, siteInput({ native, nativeKind: 0 }), out);
    expect(out.count).toBe(0);
    const fog = new Uint8Array(7).fill(FOG_HIDDEN);
    const district = new Uint8Array(7).fill(1);
    planSites(9, siteInput({ fog, native, nativeKind: 2, district, colonyRegion: 1 }), out);
    expect(out.count).toBe(0);
  });

  it('are deterministic and counts crowd dots from population', () => {
    const native = new Uint8Array(7);
    native[4] = 1;
    const a = createSiteList(64);
    const b = createSiteList(64);
    planSites(5, siteInput({ native, nativeKind: 1 }), a);
    planSites(5, siteInput({ native, nativeKind: 1 }), b);
    expect(Array.from(a.x.subarray(0, a.count))).toEqual(Array.from(b.x.subarray(0, b.count)));
    expect(colonistDots(0)).toBe(0);
    expect(colonistDots(1)).toBe(2);
    expect(colonistDots(130)).toBe(4);
    expect(colonistDots(100000)).toBe(12);
  });
});

describe('fog texture', () => {
  const { centres } = flower();
  const size = FOG_TEX_SIZE;
  const out = new Uint8Array(size * size);
  const scratch = new Uint8Array(size * size);
  const fog = new Uint8Array(7).fill(FOG_HIDDEN);
  fog[0] = FOG_EXPLORED;
  fog[1] = FOG_VISIBLE;
  fillFogTexture(out, scratch, size, 3.6, centres, fog, 7);
  const at = (x: number, z: number): number => {
    const i = Math.min(size - 1, Math.floor(((x + 3.6) / 7.2) * size));
    const j = Math.min(size - 1, Math.floor(((z + 3.6) / 7.2) * size));
    return out[j * size + i];
  };

  it('is full on explored ground, half on visible ground and empty on hidden ground', () => {
    expect(at(centres[0], centres[2])).toBe(FOG_LEVEL_EXPLORED);
    expect(Math.abs(at(centres[3], centres[5]) - FOG_LEVEL_VISIBLE)).toBeLessThanOrEqual(2);
    expect(at(centres[9], centres[11])).toBe(0);
  });

  it('fades smoothly over a border instead of stepping', () => {
    // Walk from the explored centre towards the hidden hex on the left (region 4).
    let prev = 255;
    let maxStep = 0;
    for (let x = centres[0]; x > centres[12]; x -= 0.1) {
      const v = at(x, centres[2]);
      maxStep = Math.max(maxStep, Math.abs(prev - v));
      prev = v;
    }
    expect(maxStep).toBeLessThan(140);
    expect(at(centres[12], centres[14])).toBeLessThan(40);
  });
});

describe('idle drift', () => {
  it('starts at zero and stays small', () => {
    expect(idleAzimuth(0)).toBe(0);
    expect(idlePolar(0)).toBe(0);
    for (let t = 0; t < 200000; t += 1000) {
      expect(Math.abs(idleAzimuth(t))).toBeLessThanOrEqual(IDLE_AZIMUTH_AMPLITUDE + 1e-9);
      expect(Math.abs(idlePolar(t))).toBeLessThanOrEqual(IDLE_POLAR_AMPLITUDE + 1e-9);
    }
    expect(idleAzimuth(10000)).toBeGreaterThan(0.05);
  });
});

describe('low-poly models', () => {
  it('every prop and site model builds with colours, normals and sane bounds', () => {
    for (let k = 0; k < PROP_KINDS; k++) {
      const g = buildPropGeometry(k);
      const pos = g.getAttribute('position');
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count).toBeLessThan(400);
      expect(g.getAttribute('color').count).toBe(pos.count);
      expect(g.getAttribute('normal').count).toBe(pos.count);
      g.computeBoundingBox();
      const box = g.boundingBox as { min: { y: number }; max: { x: number; y: number; z: number } };
      expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
      expect(box.max.y).toBeLessThan(0.8);
      expect(Math.max(box.max.x, box.max.z)).toBeLessThan(0.5);
      g.dispose();
    }
    for (let m = 0; m < MODEL_COUNT; m++) {
      const g = buildSiteGeometry(m);
      const pos = g.getAttribute('position');
      expect(pos.count).toBeGreaterThan(0);
      expect(pos.count).toBeLessThan(1500);
      g.computeBoundingBox();
      const box = g.boundingBox as { min: { y: number }; max: { x: number; y: number; z: number } };
      expect(box.min.y).toBeGreaterThanOrEqual(-0.05);
      expect(box.max.y).toBeLessThan(0.8);
      expect(Math.max(box.max.x, box.max.z)).toBeLessThan(0.9);
      g.dispose();
    }
  });

  it('districts differ in silhouette: no two share a vertex count and height', () => {
    const seen = new Set<string>();
    for (let m = Model.Farm; m <= Model.Spaceport; m++) {
      const g = buildSiteGeometry(m);
      g.computeBoundingBox();
      const box = g.boundingBox as { max: { y: number } };
      seen.add(`${g.getAttribute('position').count}:${box.max.y.toFixed(2)}`);
      g.dispose();
    }
    expect(seen.size).toBe(6);
  });
});

describe('render code stays deterministic', () => {
  it('uses no Math.random anywhere under src/render', () => {
    const dir = new URL('../src/render/', import.meta.url);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const text = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/Math\.random|Date\.now/);
    }
  });
});
