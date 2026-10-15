/**
 * Pure hex-map math for the planet view (no three.js, so it runs under Node tests). Regions use
 * axial coordinates (q, r) with pointy-top hexes laid out on the x/z plane: x grows to the right,
 * z grows towards the viewer (increasing r goes down the screen at the default camera).
 */

export const SQRT3 = 1.7320508075688772;

/** World x of a hex centre of circumradius `size`. */
export function hexX(q: number, r: number, size: number): number {
  return size * SQRT3 * (q + r * 0.5);
}

/** World z of a hex centre. */
export function hexZ(r: number, size: number): number {
  return size * 1.5 * r;
}

/** Axial to world: writes x at out[off] and z at out[off + 1]. */
export function axialToWorld(
  q: number,
  r: number,
  size: number,
  out: { [i: number]: number },
  off: number,
): void {
  out[off] = hexX(q, r, size);
  out[off + 1] = hexZ(r, size);
}

/** Hex distance in steps between two axial coordinates. */
export function axialDistance(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** True when two axial coordinates share an edge (same rule as the sim's adjacency). */
export function axialAdjacent(aq: number, ar: number, bq: number, br: number): boolean {
  return axialDistance(aq, ar, bq, br) === 1;
}

/**
 * World point back to the axial coordinate of the hex that contains it (cube rounding). Writes
 * q at out[0] and r at out[1].
 */
export function worldToAxial(
  x: number,
  z: number,
  size: number,
  out: { [i: number]: number },
): void {
  const fq = ((SQRT3 / 3) * x - z / 3) / size;
  const fr = ((2 / 3) * z) / size;
  const fs = -fq - fr;
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);
  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  out[0] = rq;
  out[1] = rr;
}

/**
 * Lay `count` regions out as x,y,z triples in `out` (y is `y`), centred on their average so the
 * camera can look at the origin. Returns the radius of the circle around the origin that holds
 * every hex (centre distance plus one hex size). No allocation.
 */
export function layoutCentres(
  q: ArrayLike<number>,
  r: ArrayLike<number>,
  count: number,
  size: number,
  y: number,
  out: Float32Array,
): number {
  if (count <= 0) return size;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < count; i++) {
    cx += hexX(q[i], r[i], size);
    cz += hexZ(r[i], size);
  }
  cx /= count;
  cz /= count;
  let maxD2 = 0;
  for (let i = 0; i < count; i++) {
    const x = hexX(q[i], r[i], size) - cx;
    const z = hexZ(r[i], size) - cz;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
    const d2 = x * x + z * z;
    if (d2 > maxD2) maxD2 = d2;
  }
  return Math.sqrt(maxD2) + size;
}

// ---- Screen-space picking ----------------------------------------------------------------------

const pa = new Float64Array(3);
const pb = new Float64Array(3);
const pc = new Float64Array(3);

/**
 * Project the world point (x, y, z) with a column-major 4x4 view-projection matrix (the elements
 * of a three.js Matrix4) to pixels: sx at out[0], sy at out[1] (y down, origin top left), NDC
 * depth at out[2]. Returns false when the point is behind the camera. No allocation.
 */
export function projectPoint(
  vp: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  out: Float64Array,
): boolean {
  const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (w <= 1e-9) return false;
  const nx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w;
  const ny = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
  out[0] = (nx * 0.5 + 0.5) * width;
  out[1] = (0.5 - ny * 0.5) * height;
  out[2] = (vp[2] * x + vp[6] * y + vp[10] * z + vp[14]) / w;
  return true;
}

/**
 * Index of the hex whose centre is nearest to the pointer (sx, sy) in screen space, provided the
 * pointer is within the hex's own on-screen size; else -1. `centres` holds x,y,z triples (the
 * layout above). The on-screen size is the larger of the projected inscribed radius along x and
 * along z, so tilting the camera never shrinks the target to nothing. Uses module-level scratch
 * vectors: no allocation per call.
 */
export function pickHex(
  centres: ArrayLike<number>,
  count: number,
  vp: ArrayLike<number>,
  width: number,
  height: number,
  sx: number,
  sy: number,
  size: number,
): number {
  const inner = size * (SQRT3 / 2);
  let best = -1;
  let bestD2 = Infinity;
  for (let i = 0; i < count; i++) {
    const x = centres[i * 3];
    const y = centres[i * 3 + 1];
    const z = centres[i * 3 + 2];
    if (!projectPoint(vp, x, y, z, width, height, pa)) continue;
    const dx = pa[0] - sx;
    const dy = pa[1] - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    let r2 = 0;
    if (projectPoint(vp, x + inner, y, z, width, height, pb)) {
      r2 = (pb[0] - pa[0]) * (pb[0] - pa[0]) + (pb[1] - pa[1]) * (pb[1] - pa[1]);
    }
    if (projectPoint(vp, x, y, z + inner, width, height, pc)) {
      const q2 = (pc[0] - pa[0]) * (pc[0] - pa[0]) + (pc[1] - pa[1]) * (pc[1] - pa[1]);
      if (q2 > r2) r2 = q2;
    }
    if (d2 <= r2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}
