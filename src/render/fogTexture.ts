import { FOG_EXPLORED, FOG_VISIBLE } from '../shared/fog';

/**
 * The planet's fog as one small texture (pure fill, no three.js). The texture covers the square
 * [-extent, extent] on the map plane, one byte per texel: 0 hidden, 128 visible, 255 explored.
 * Each texel takes the fog of the nearest hex centre (a hex-shaped Voronoi cell), then a 3x3
 * blur softens the borders; the GPU's bilinear filtering adds the rest, so fog edges fade over
 * about half a hex instead of stepping at the tile outline.
 */

export const FOG_TEX_SIZE = 64;
export const FOG_LEVEL_HIDDEN = 0;
export const FOG_LEVEL_VISIBLE = 128;
export const FOG_LEVEL_EXPLORED = 255;

export function fogLevel(fog: number): number {
  return fog === FOG_EXPLORED
    ? FOG_LEVEL_EXPLORED
    : fog === FOG_VISIBLE
      ? FOG_LEVEL_VISIBLE
      : FOG_LEVEL_HIDDEN;
}

/**
 * Fill `out` (size x size bytes) from the hex centres (x,y,z triples) and fog bytes. `scratch`
 * must be as large as `out`. No allocation.
 */
export function fillFogTexture(
  out: Uint8Array,
  scratch: Uint8Array,
  size: number,
  extent: number,
  centres: ArrayLike<number>,
  fog: ArrayLike<number>,
  count: number,
): void {
  const step = (2 * extent) / size;
  for (let j = 0; j < size; j++) {
    const z = -extent + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const x = -extent + (i + 0.5) * step;
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < count; k++) {
        const dx = centres[k * 3] - x;
        const dz = centres[k * 3 + 2] - z;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      scratch[j * size + i] = best < 0 ? FOG_LEVEL_HIDDEN : fogLevel(fog[best]);
    }
  }
  const last = size - 1;
  for (let j = 0; j < size; j++) {
    const j0 = j > 0 ? j - 1 : 0;
    const j1 = j < last ? j + 1 : last;
    for (let i = 0; i < size; i++) {
      const i0 = i > 0 ? i - 1 : 0;
      const i1 = i < last ? i + 1 : last;
      const sum =
        scratch[j0 * size + i0] +
        2 * scratch[j0 * size + i] +
        scratch[j0 * size + i1] +
        2 * scratch[j * size + i0] +
        4 * scratch[j * size + i] +
        2 * scratch[j * size + i1] +
        scratch[j1 * size + i0] +
        2 * scratch[j1 * size + i] +
        scratch[j1 * size + i1];
      out[j * size + i] = (sum + 8) >> 4;
    }
  }
}
