/**
 * Pure 2D view math for the top-down galaxy view. No three.js, so it runs under Node tests.
 * World space: x right, y up, galaxy 0..1000. Screen space: pixels, y down, origin top-left.
 */

export interface ViewState {
  /** World point at the screen centre. */
  cx: number;
  cy: number;
  /** Pixels per world unit. */
  scale: number;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
}

export const GALAXY_UNITS = 1000;
export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 12;

export function createView(): ViewState {
  return { cx: GALAXY_UNITS / 2, cy: GALAXY_UNITS / 2, scale: 1, width: 1, height: 1 };
}

/** Scale at which the whole galaxy (plus a margin) fits the viewport. */
export function fitScale(width: number, height: number): number {
  return Math.min(width, height) / (GALAXY_UNITS * 1.1);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function screenX(v: ViewState, wx: number): number {
  return (wx - v.cx) * v.scale + v.width * 0.5;
}

export function screenY(v: ViewState, wy: number): number {
  return v.height * 0.5 - (wy - v.cy) * v.scale;
}

export function worldX(v: ViewState, sx: number): number {
  return (sx - v.width * 0.5) / v.scale + v.cx;
}

export function worldY(v: ViewState, sy: number): number {
  return (v.height * 0.5 - sy) / v.scale + v.cy;
}

/** Drag the view by a screen-space delta (the world follows the cursor). */
export function panBy(v: ViewState, dxPx: number, dyPx: number): void {
  v.cx -= dxPx / v.scale;
  v.cy += dyPx / v.scale;
  clampCenter(v);
}

/** Multiply the zoom by `factor` keeping the world point under (sx, sy) fixed; clamped. */
export function zoomAt(v: ViewState, sx: number, sy: number, factor: number): void {
  const fit = fitScale(v.width, v.height);
  const wx = worldX(v, sx);
  const wy = worldY(v, sy);
  v.scale = clamp(v.scale * factor, fit * MIN_ZOOM_FACTOR, fit * MAX_ZOOM_FACTOR);
  v.cx = wx - (sx - v.width * 0.5) / v.scale;
  v.cy = wy - (v.height * 0.5 - sy) / v.scale;
  clampCenter(v);
}

/** Keep the view centre inside the galaxy square. */
export function clampCenter(v: ViewState): void {
  v.cx = clamp(v.cx, 0, GALAXY_UNITS);
  v.cy = clamp(v.cy, 0, GALAXY_UNITS);
}

/** Set the viewport size and re-clamp the zoom to the new fit range. */
export function resizeView(v: ViewState, width: number, height: number): void {
  const fit = fitScale(v.width, v.height);
  const relative = v.scale / fit; // 1 = fitted; preserved across resizes
  v.width = width;
  v.height = height;
  const nf = fitScale(width, height);
  v.scale = clamp(relative * nf, nf * MIN_ZOOM_FACTOR, nf * MAX_ZOOM_FACTOR);
}

/**
 * Index of the system nearest to the screen point (sx, sy) within `maxDistPx`, or -1.
 * `positions` holds x,y world pairs. No allocation.
 */
export function pickNearest(
  positions: ArrayLike<number>,
  count: number,
  v: ViewState,
  sx: number,
  sy: number,
  maxDistPx: number,
): number {
  let best = -1;
  let bestD2 = maxDistPx * maxDistPx;
  for (let i = 0; i < count; i++) {
    const dx = screenX(v, positions[i * 2]) - sx;
    const dy = screenY(v, positions[i * 2 + 1]) - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/** Wheel delta in pixels: deltaMode 1 is lines (x16), 2 is pages (x100), 0 is pixels. */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  return deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
}
