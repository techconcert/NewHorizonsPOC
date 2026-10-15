/**
 * Pure orbit-camera math for the planet view (no three.js). The camera sits on a sphere around a
 * target: `polar` is the angle from straight down (0 looks straight down, larger tilts towards
 * the horizon) and `azimuth` turns around the vertical axis (0 looks from the south edge). All
 * angles and the distance are clamped, so a drag or wheel can never flip or lose the map.
 */

export const ORBIT_MIN_POLAR = 0.2;
export const ORBIT_MAX_POLAR = 1.15;
export const ORBIT_MAX_AZIMUTH = 0.9;
export const ORBIT_RADIANS_PER_PX = 0.005;
export const ORBIT_ZOOM_PER_WHEEL_PX = 1.0015;

export interface OrbitState {
  azimuth: number;
  polar: number;
  distance: number;
  minDistance: number;
  maxDistance: number;
}

export function clampNumber(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A fresh orbit looking steeply down from `distance`, allowed to zoom to `min`..`max`. */
export function createOrbit(distance: number, min: number, max: number): OrbitState {
  return {
    azimuth: 0,
    polar: 0.6,
    distance: clampNumber(distance, min, max),
    minDistance: min,
    maxDistance: max,
  };
}

/** Drag by a pixel delta: left/right turns, up/down tilts. Clamped. */
export function orbitRotate(s: OrbitState, dxPx: number, dyPx: number): void {
  s.azimuth = clampNumber(
    s.azimuth - dxPx * ORBIT_RADIANS_PER_PX,
    -ORBIT_MAX_AZIMUTH,
    ORBIT_MAX_AZIMUTH,
  );
  s.polar = clampNumber(s.polar - dyPx * ORBIT_RADIANS_PER_PX, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
}

/** Wheel delta in pixels (positive zooms out). Clamped to the allowed distance range. */
export function orbitZoom(s: OrbitState, wheelPx: number): void {
  s.distance = clampNumber(
    s.distance * Math.pow(ORBIT_ZOOM_PER_WHEEL_PX, wheelPx),
    s.minDistance,
    s.maxDistance,
  );
}

/** Camera position around the target (tx, ty, tz), written to out[off .. off + 2]. */
export function orbitPosition(
  s: OrbitState,
  tx: number,
  ty: number,
  tz: number,
  out: { [i: number]: number },
  off: number,
): void {
  const sp = Math.sin(s.polar);
  out[off] = tx + s.distance * sp * Math.sin(s.azimuth);
  out[off + 1] = ty + s.distance * Math.cos(s.polar);
  out[off + 2] = tz + s.distance * sp * Math.cos(s.azimuth);
}

/** Distance at which a circle of `radius` fits the smaller field of view, with a little margin. */
export function orbitFitDistance(radius: number, vfovDeg: number, aspect: number): number {
  const half = (vfovDeg * Math.PI) / 360;
  const halfH = Math.atan(Math.tan(half) * (aspect > 0 ? aspect : 1));
  const m = Math.min(half, halfH);
  return (radius * 1.15) / Math.sin(m);
}

// ---- Idle drift ----------------------------------------------------------------------------------

/** Slow sway of the camera while the player has not touched it: radians and milliseconds. */
export const IDLE_AZIMUTH_AMPLITUDE = 0.1;
export const IDLE_POLAR_AMPLITUDE = 0.02;
export const IDLE_PERIOD_MS = 40000;

/** Azimuth offset of the idle drift `tMs` after it started (0 at the start, so nothing jumps). */
export function idleAzimuth(tMs: number): number {
  return IDLE_AZIMUTH_AMPLITUDE * Math.sin((tMs / IDLE_PERIOD_MS) * Math.PI * 2);
}

/** Polar offset of the idle drift, a slower and smaller nod that also starts at 0. */
export function idlePolar(tMs: number): number {
  return IDLE_POLAR_AMPLITUDE * Math.sin((tMs / (IDLE_PERIOD_MS * 1.37)) * Math.PI * 2);
}
