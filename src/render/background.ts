/**
 * Deterministic galaxy backdrop (M6a): a tileable nebula texture and a star field, generated from
 * fixed constants with a local integer hash. Nothing here uses Math.random or the clock, so the
 * same seed always paints the same sky. Pure and three.js free, so it is unit-tested under Node.
 */

/** Fixed seeds for the one backdrop of the game. */
export const NEBULA_SEED = 0x6e65;
export const STAR_FIELD_SEED = 0x7374;

/** Hash two integers and a seed to an unsigned 32-bit value. */
export function hash32(a: number, b: number, seed: number): number {
  let h =
    Math.imul(a | 0, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(seed | 0, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** hash32 scaled to [0, 1). */
export function hashUnit(a: number, b: number, seed: number): number {
  return hash32(a, b, seed) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0, 1) that repeats every `period` lattice cells in x and y. */
export function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = smooth(x - xf);
  const fy = smooth(y - yf);
  const x0 = ((xf % period) + period) % period;
  const y0 = ((yf % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hashUnit(x0, y0, seed);
  const b = hashUnit(x1, y0, seed);
  const c = hashUnit(x0, y1, seed);
  const d = hashUnit(x1, y1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal sum of `octaves` noise layers over a unit square that tiles seamlessly. Result in [0, 1). */
export function tiledFbm(
  u: number,
  v: number,
  basePeriod: number,
  octaves: number,
  seed: number,
): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * period, v * period, period, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Base space colour (the clear colour, 0x05070d) in display bytes. */
export const NEBULA_BASE_RGB: readonly number[] = [5, 7, 13];
/** Brightest add-on of the nebula tints: kept dim so stars and markers stay in front. */
export const NEBULA_MAX_ADD = 46;

/**
 * Fill a size x size RGBA8 texture with the nebula (display-ready bytes, alpha 255). The texture
 * tiles in both directions. Two noise fields give a cool blue-teal cloud and a violet one.
 */
export function fillNebula(out: Uint8Array | Uint8ClampedArray, size: number, seed: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n1 = tiledFbm(u, v, 3, 4, seed);
      const n2 = tiledFbm(u, v, 2, 4, seed + 7919);
      const c1 = Math.max(0, n1 - 0.46) * 1.9;
      const c2 = Math.max(0, n2 - 0.5) * 1.9;
      const a1 = c1 * c1;
      const a2 = c2 * c2;
      const o = (y * size + x) * 4;
      // Half a level of deterministic dither hides the banding of 8-bit dark gradients.
      const dither = hashUnit(x, y, seed + 99) - 0.5;
      out[o] = clampByte(dither + NEBULA_BASE_RGB[0] + NEBULA_MAX_ADD * (0.25 * a1 + 0.9 * a2));
      out[o + 1] = clampByte(dither + NEBULA_BASE_RGB[1] + NEBULA_MAX_ADD * (0.55 * a1 + 0.3 * a2));
      out[o + 2] = clampByte(dither + NEBULA_BASE_RGB[2] + NEBULA_MAX_ADD * (1.0 * a1 + 0.9 * a2));
      out[o + 3] = 255;
    }
  }
}

function clampByte(v: number): number {
  const r = Math.round(v);
  return r < 0
    ? 0
    : r > NEBULA_BASE_RGB[2] + NEBULA_MAX_ADD
      ? NEBULA_BASE_RGB[2] + NEBULA_MAX_ADD
      : r;
}

/** Star field extent (world units): wider than the galaxy so a zoomed-out view is still covered. */
export const STAR_FIELD_MIN = -1700;
export const STAR_FIELD_MAX = 2700;

/**
 * Fill `n` field stars: x, y into `pos` (3 floats each, z = 0) and a brightness-tinted colour into
 * `col` (3 floats each, linear). Mostly faint and warm-white or blue-white, a few brighter.
 */
export function fillStarField(pos: Float32Array, col: Float32Array, n: number, seed: number): void {
  const span = STAR_FIELD_MAX - STAR_FIELD_MIN;
  for (let i = 0; i < n; i++) {
    pos[i * 3] = STAR_FIELD_MIN + hashUnit(i, 1, seed) * span;
    pos[i * 3 + 1] = STAR_FIELD_MIN + hashUnit(i, 2, seed) * span;
    pos[i * 3 + 2] = 0;
    const b = hashUnit(i, 3, seed);
    const bright = 0.012 + b * b * b * 0.5;
    const tint = hashUnit(i, 4, seed);
    col[i * 3] = bright * (0.8 + 0.2 * tint);
    col[i * 3 + 1] = bright * (0.85 + 0.1 * tint);
    col[i * 3 + 2] = bright * (1 - 0.15 * tint);
  }
}
