import { SHIP_POS_STRIDE } from '../shared/snapshot';

/**
 * Ship interpolation (ARCHITECTURE section 9): position = prev + (curr - prev) x alpha, where alpha
 * is the real time elapsed in the current game day divided by the day length (1000 ms / speed).
 * Pure and allocation free, so it is unit-tested without three.js.
 */

/** Length of one game day in real milliseconds at 1x (ARCHITECTURE section 3). */
export const DAY_MS_AT_1X = 1000;

export interface InterpClock {
  /** Game day of the snapshot being shown, or -1 before the first. */
  day: number;
  /** Fraction of that day shown so far, 0..1 (alpha). Frozen while paused. */
  frac: number;
  /** Current game speed (0 pause, 1, 2, 4). */
  speed: number;
}

/** Longest real-time step fed to the clock (a stalled or resumed tab must not jump ships). */
export const MAX_DT_MS = 100;

/** Clamp a frame step to [0, MAX_DT_MS]; non-finite steps count as 0. */
export function clampDt(dtMs: number): number {
  return dtMs > 0 ? (dtMs > MAX_DT_MS ? MAX_DT_MS : dtMs) : 0;
}

export function createInterpClock(): InterpClock {
  return { day: -1, frac: 0, speed: 0 };
}

/**
 * A snapshot arrived. A new day restarts the day fraction; the same day (a command was applied)
 * keeps it, so ships do not stutter. The speed is remembered for `clockAdvance`.
 */
export function clockOnSnapshot(c: InterpClock, day: number, speed: number): void {
  if (day !== c.day) {
    c.day = day;
    c.frac = 0;
  }
  c.speed = speed;
}

/**
 * Advance by `dtMs` of real time: a day lasts DAY_MS_AT_1X / speed ms. Paused (speed 0) freezes
 * the fraction, so ships stop where they are and carry on from there. Clamped at 1: a late
 * snapshot holds the ship at its current position. Returns true when alpha changed.
 */
export function clockAdvance(c: InterpClock, dtMs: number): boolean {
  if (c.speed <= 0 || dtMs <= 0 || c.frac >= 1) return false;
  const f = c.frac + (dtMs * c.speed) / DAY_MS_AT_1X;
  c.frac = f > 1 ? 1 : f;
  return true;
}

/** Fraction of the day shown, in [0, 1]. */
export function clockAlpha(c: InterpClock): number {
  return c.frac;
}

/**
 * Write interpolated x,y pairs of `count` ships into `out` (out[2i], out[2i+1]). `shipPos` holds
 * the snapshot layout: previous x,y then current x,y per ship. One pass, no allocation.
 */
export function lerpShipPositions(
  shipPos: ArrayLike<number>,
  count: number,
  alpha: number,
  out: Float32Array,
): void {
  for (let i = 0; i < count; i++) {
    const o = i * SHIP_POS_STRIDE;
    const px = shipPos[o];
    const py = shipPos[o + 1];
    out[i * 2] = px + (shipPos[o + 2] - px) * alpha;
    out[i * 2 + 1] = py + (shipPos[o + 3] - py) * alpha;
  }
}
