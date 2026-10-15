import { hashUnit } from './background';
import { SHORE_COLOR } from './hexPalette';

/**
 * Pure geometry writer for the hex terrain (no three.js): one indexed mesh for the whole planet
 * (at most 19 hexes, so one chunk). Each hex is 25 vertices and 30 triangles:
 *   0        centre (a peak or a bowl by `lift`)
 *   1..6     inner ring, at the tile top
 *   7..12    outer ring, one bevel lower (shares its colour with the neighbours: the vertex-colour blend)
 *   13..18   skirt top (same place as the outer ring, own vertices so the cliff edge stays crisp)
 *   19..24   skirt bottom, near the water
 * Colours are linear RGB floats. Corner colours average the tile with the two neighbours that
 * meet at the corner; a missing neighbour (coast) counts as a shore tint. Fake ambient occlusion
 * darkens the bevel, the skirt and the foot of the cliff.
 */

export const HEX_VERTS = 25;
export const HEX_TRIS = 30;
export const HEX_INDICES = HEX_TRIS * 3;
export const INNER_RADIUS = 0.82;
export const OUTER_RADIUS = 0.97;
export const BEVEL = 0.07;
export const SKIRT_BOTTOM = -0.3;

/** Axial neighbour offsets, direction d at angle 60 * d degrees (0 = +x, 1 = towards +z). */
export const NEIGHBOUR_DQ: readonly number[] = [1, 0, -1, -1, 0, 1];
export const NEIGHBOUR_DR: readonly number[] = [0, 1, 1, 0, -1, -1];

const COS30 = 0.8660254037844387;
/** Corner k sits at angle 30 + 60 k degrees: unit x and z. */
const CORNER_X: readonly number[] = [COS30, 0, -COS30, -COS30, 0, COS30];
const CORNER_Z: readonly number[] = [0.5, 1, 0.5, -0.5, -1, -0.5];

export interface TerrainBuffers {
  capacity: number;
  positions: Float32Array;
  colors: Float32Array;
  index: Uint16Array;
}

export function createTerrainBuffers(capacity: number): TerrainBuffers {
  const index = new Uint16Array(capacity * HEX_INDICES);
  for (let i = 0; i < capacity; i++) {
    const v = i * HEX_VERTS;
    let o = i * HEX_INDICES;
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      // top fan, counter-clockwise seen from above
      index[o++] = v;
      index[o++] = v + 1 + k1;
      index[o++] = v + 1 + k;
      // bevel from the inner to the outer ring
      index[o++] = v + 1 + k;
      index[o++] = v + 1 + k1;
      index[o++] = v + 7 + k1;
      index[o++] = v + 1 + k;
      index[o++] = v + 7 + k1;
      index[o++] = v + 7 + k;
      // skirt, outward facing
      index[o++] = v + 13 + k;
      index[o++] = v + 13 + k1;
      index[o++] = v + 19 + k1;
      index[o++] = v + 13 + k;
      index[o++] = v + 19 + k1;
      index[o++] = v + 19 + k;
    }
  }
  return {
    capacity,
    positions: new Float32Array(capacity * HEX_VERTS * 3),
    colors: new Float32Array(capacity * HEX_VERTS * 3),
    index,
  };
}

/** Neighbour region index of each region and direction (-1 for none): out[i * 6 + d]. */
export function neighbourTable(
  q: ArrayLike<number>,
  r: ArrayLike<number>,
  count: number,
  out: Int8Array,
): void {
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < 6; d++) {
      const nq = q[i] + NEIGHBOUR_DQ[d];
      const nr = r[i] + NEIGHBOUR_DR[d];
      let found = -1;
      for (let j = 0; j < count; j++) {
        if (q[j] === nq && r[j] === nr) {
          found = j;
          break;
        }
      }
      out[i * 6 + d] = found;
    }
  }
}

/** sRGB byte (0..255) to linear float. */
export function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear RGB of a 0xRRGGBB value written to out[o..o+2]. */
export function hexToLinear(hex: number, out: Float32Array, o: number): void {
  out[o] = srgbToLinear((hex >> 16) & 255);
  out[o + 1] = srgbToLinear((hex >> 8) & 255);
  out[o + 2] = srgbToLinear(hex & 255);
}

const SHORE_LIN = new Float32Array(3);
hexToLinear(SHORE_COLOR, SHORE_LIN, 0);
const SKIRT_FOOT_TINT = [0.28, 0.34, 0.38];

function put(c: Float32Array, v: number, r: number, g: number, b: number): void {
  c[v * 3] = r;
  c[v * 3 + 1] = g;
  c[v * 3 + 2] = b;
}

/**
 * Write `count` hexes. `centres` holds x,y,z triples (y ignored), `tops` the top height of each
 * tile, `lift` its centre lift, `baseHex` the 0xRRGGBB colour of each tile. `seed` varies the
 * brightness of each tile a little (a hash of q, r and the seed, never Math.random).
 * Returns the number of indices to draw. No allocation.
 */
export function buildTerrain(
  count: number,
  q: ArrayLike<number>,
  r: ArrayLike<number>,
  centres: ArrayLike<number>,
  tops: ArrayLike<number>,
  lift: ArrayLike<number>,
  baseHex: ArrayLike<number>,
  nbr: Int8Array,
  size: number,
  seed: number,
  buf: TerrainBuffers,
): number {
  const n = count < buf.capacity ? count : buf.capacity;
  const lin = scratchLin;
  // Linear tile colours with the per-tile brightness variation baked in, so two tiles that share
  // a corner compute the same blended corner colour.
  for (let i = 0; i < n; i++) {
    hexToLinear(baseHex[i], lin, i * 3);
    const shade = 0.96 + 0.08 * hashUnit(q[i], r[i], seed);
    lin[i * 3] *= shade;
    lin[i * 3 + 1] *= shade;
    lin[i * 3 + 2] *= shade;
  }
  const p = buf.positions;
  const c = buf.colors;
  for (let i = 0; i < n; i++) {
    const cx = centres[i * 3];
    const cz = centres[i * 3 + 2];
    const top = tops[i];
    const v0 = i * HEX_VERTS;
    const or = lin[i * 3];
    const og = lin[i * 3 + 1];
    const ob = lin[i * 3 + 2];
    // positions
    p[v0 * 3] = cx;
    p[v0 * 3 + 1] = top + lift[i];
    p[v0 * 3 + 2] = cz;
    for (let k = 0; k < 6; k++) {
      const ix = CORNER_X[k] * size;
      const iz = CORNER_Z[k] * size;
      const vi = v0 + 1 + k;
      p[vi * 3] = cx + ix * INNER_RADIUS;
      p[vi * 3 + 1] = top;
      p[vi * 3 + 2] = cz + iz * INNER_RADIUS;
      for (let s = 0; s < 2; s++) {
        const vo = v0 + 7 + k + s * 6; // outer ring, then the skirt top in the same place
        p[vo * 3] = cx + ix * OUTER_RADIUS;
        p[vo * 3 + 1] = top - BEVEL;
        p[vo * 3 + 2] = cz + iz * OUTER_RADIUS;
      }
      const vb = v0 + 19 + k;
      p[vb * 3] = cx + ix * OUTER_RADIUS;
      p[vb * 3 + 1] = SKIRT_BOTTOM;
      p[vb * 3 + 2] = cz + iz * OUTER_RADIUS;
    }
    // colours
    put(c, v0, or * 1.05, og * 1.05, ob * 1.05);
    for (let k = 0; k < 6; k++) {
      let sr = or;
      let sg = og;
      let sb = ob;
      for (let s = 0; s < 2; s++) {
        const nb = nbr[i * 6 + ((k + s) % 6)];
        if (nb >= 0) {
          sr += lin[nb * 3];
          sg += lin[nb * 3 + 1];
          sb += lin[nb * 3 + 2];
        } else {
          sr += or * 0.5 + SHORE_LIN[0] * 0.5;
          sg += og * 0.5 + SHORE_LIN[1] * 0.5;
          sb += ob * 0.5 + SHORE_LIN[2] * 0.5;
        }
      }
      const cr = sr / 3;
      const cg = sg / 3;
      const cb = sb / 3;
      put(c, v0 + 1 + k, or + (cr - or) * 0.3, og + (cg - og) * 0.3, ob + (cb - ob) * 0.3);
      put(c, v0 + 7 + k, cr * 0.9, cg * 0.9, cb * 0.9);
      put(c, v0 + 13 + k, cr * 0.6, cg * 0.6, cb * 0.6);
      put(
        c,
        v0 + 19 + k,
        cr * SKIRT_FOOT_TINT[0],
        cg * SKIRT_FOOT_TINT[1],
        cb * SKIRT_FOOT_TINT[2],
      );
    }
  }
  return n * HEX_INDICES;
}

const scratchLin = new Float32Array(64 * 3);
