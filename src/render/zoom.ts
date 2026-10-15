import { FOG_HIDDEN } from '../shared/fog';
import { hashUnit } from './background';

/**
 * Pure math of the zoom pipeline (M6c): galaxy -> system -> orbit -> colony. Easing, time-driven
 * slides (every transition is a function of elapsed real time, never of frame count), the camera
 * interpolation of the system zoom, the orbit layout of a system, planet look by habitability band
 * and survey level, the planet-view framing and its level-of-detail thresholds. No three.js and no
 * DOM, so it runs under Node tests. Nothing here allocates once the caller owns the output objects.
 */

/** The four zoom levels of docs/ARCHITECTURE.md section 9. */
export const ZoomLevel = { Galaxy: 0, System: 1, Orbit: 2, Colony: 3 } as const;
export type ZoomLevelId = (typeof ZoomLevel)[keyof typeof ZoomLevel];

/** Transition lengths in milliseconds (zero with prefers-reduced-motion). */
export const SYSTEM_ZOOM_MS = 800;
export const PLANET_ENTER_MS = 700;
export const PLANET_EXIT_MS = 450;

// ---- Easing ------------------------------------------------------------------------------------

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0 at 0, 1 at 1, slow at both ends. Input is clamped. */
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Fast start, slow end. Input is clamped. */
export function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

/** Smooth step between `lo` and `hi` (0 at or below lo, 1 at or above hi). */
export function smoothstep(lo: number, hi: number, v: number): number {
  if (hi <= lo) return v >= hi ? 1 : 0;
  const x = clamp01((v - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Geometric interpolation of a positive scale: equal ratios per unit of t, so a zoom feels even. */
export function lerpScale(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

// ---- Slides: a position that moves linearly with real time ----------------------------------

export interface Slide {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
}

export function createSlide(at = 0): Slide {
  return { from: at, to: at, startMs: 0, durationMs: 0 };
}

/**
 * Start moving towards `to` (0 or 1) from the current linear position `current`. The duration is
 * `fullMs` scaled by the distance left, so reversing half way takes half as long and never jumps.
 * With reduced motion the move is instant.
 */
export function slideStart(
  s: Slide,
  nowMs: number,
  to: number,
  fullMs: number,
  reducedMotion: boolean,
  current: number,
): void {
  s.from = current;
  s.to = to;
  s.startMs = nowMs;
  s.durationMs = reducedMotion ? 0 : fullMs * Math.abs(to - current);
}

/** Linear position (0..1) of the slide at `nowMs`. */
export function slidePos(s: Slide, nowMs: number): number {
  if (s.durationMs <= 0) return s.to;
  const u = clamp01((nowMs - s.startMs) / s.durationMs);
  return s.from + (s.to - s.from) * u;
}

export function slideDone(s: Slide, nowMs: number): boolean {
  return s.durationMs <= 0 || nowMs - s.startMs >= s.durationMs;
}

// ---- System zoom camera ---------------------------------------------------------------------

/** An orthographic camera as the galaxy view keeps it: world point at the centre, pixels per unit. */
export interface ViewTransform {
  cx: number;
  cy: number;
  scale: number;
}

/**
 * Blend from `from` (e = 0) to a view that shows world point (px, py) at the screen offset
 * (ox, oy) from the canvas centre (y down, pixels) at `toScale` (e = 1). The scale changes
 * geometrically and the point glides along a straight screen line, so the star you zoom into never
 * swings sideways. Writes `out`.
 */
export function focusView(
  from: ViewTransform,
  px: number,
  py: number,
  ox: number,
  oy: number,
  toScale: number,
  e: number,
  out: ViewTransform,
): ViewTransform {
  const s = lerpScale(from.scale, toScale, e);
  const ox0 = (px - from.cx) * from.scale;
  const oy0 = -(py - from.cy) * from.scale;
  const sx = lerp(ox0, ox, e);
  const sy = lerp(oy0, oy, e);
  out.cx = px - sx / s;
  out.cy = py + sy / s;
  out.scale = s;
  return out;
}

/** Fade of the galaxy layers while the camera flies in: 1 at e = 0, gone by e = 0.55. */
export function galaxyFade(e: number): number {
  return 1 - smoothstep(0.05, 0.55, e);
}

/** Fade of the system layer: nothing until e = 0.3, full at e = 0.85. */
export function systemFade(e: number): number {
  return smoothstep(0.3, 0.85, e);
}

/**
 * A wheel step over the selected star enters its system when the galaxy is already zoomed in
 * (`scaleRatio` = scale / fitted scale) and the player keeps rolling in (`accumulatedIn` pixels).
 */
export const ENTER_SCALE_RATIO = 3;
export const ENTER_WHEEL_PX = 100;
export const EXIT_WHEEL_PX = 80;
export function wheelEntersSystem(
  overSelected: boolean,
  scaleRatio: number,
  accumulatedIn: number,
): boolean {
  return overSelected && scaleRatio >= ENTER_SCALE_RATIO && accumulatedIn >= ENTER_WHEEL_PX;
}

// ---- Orbit layout of a system ----------------------------------------------------------------

/** World units: the first orbit, the gap between orbits, and the margin outside the last one. */
export const ORBIT_FIRST = 34;
export const ORBIT_STEP = 17;
export const ORBIT_MARGIN = 14;
/** The system fills this share of the free area's smaller half-side. */
export const SYSTEM_FILL = 0.86;

export function orbitRadius(slot: number): number {
  return ORBIT_FIRST + slot * ORBIT_STEP;
}

/** Radius that holds every orbit of a system with `count` planets (at least one orbit's worth). */
export function systemExtent(count: number): number {
  return orbitRadius((count < 1 ? 1 : count) - 1) + ORBIT_MARGIN;
}

/** Angle of planet `slot` on its orbit, a fixed function of the system and slot (radians). */
export function planetAngle(system: number, slot: number): number {
  return hashUnit(system, slot, 0x5b17) * Math.PI * 2;
}

/** Writes the planet's offset from its star (world units) to out[at], out[at + 1]. */
export function planetOffset(
  system: number,
  slot: number,
  out: { [i: number]: number },
  at: number,
): void {
  const a = planetAngle(system, slot);
  const r = orbitRadius(slot);
  out[at] = Math.cos(a) * r;
  out[at + 1] = Math.sin(a) * r;
}

/** Pixels per world unit that fit a system of `count` planets into a free area. */
export function systemFitScale(count: number, areaWidth: number, areaHeight: number): number {
  const half = Math.min(areaWidth, areaHeight) * 0.5 * SYSTEM_FILL;
  return half / systemExtent(count);
}

// ---- Planet look -----------------------------------------------------------------------------

/** Planet body radius in world units, and the spread decoration gives it (no data behind it). */
export const PLANET_RADIUS = 5.2;
export const PLANET_SIZE_SPREAD = 0.12;

/** Size factor 1 +- PLANET_SIZE_SPREAD from the planet index. Decoration only: snapshots carry no planet size. */
export function planetSizeJitter(planet: number): number {
  return 1 + (hashUnit(planet, 3, 0x51ee) * 2 - 1) * PLANET_SIZE_SPREAD;
}

/** Habitability bands of the known range midpoint: hostile, marginal, fair, good. */
export const HAB_BAND_NAMES: readonly string[] = ['Hostile', 'Marginal', 'Fair', 'Good'];
/** Body colours by band (sRGB hex): rust, ochre, olive green, blue-green. */
export const HAB_BAND_COLORS: readonly number[] = [0xb0644a, 0xcfa24e, 0x82b45a, 0x4fb8d8];

export function habBand(lo: number, hi: number): number {
  const mid = (lo + hi) / 2;
  return mid < 25 ? 0 : mid < 50 ? 1 : mid < 75 ? 2 : 3;
}

/** Ring pattern ids shared with the system layer shader. */
export const RING_DASHED = 0;
export const RING_THIN = 1;
export const RING_DOUBLE = 2;
export const RING_HALO = 3;

export interface SurveyLook {
  name: string;
  /** Colour kept (0 = grey, 1 = full band colour) and brightness. */
  sat: number;
  light: number;
  /** Size factor of the body and the ring pattern drawn round it. */
  size: number;
  ring: number;
}

/** Unknown, Scanned, Surveyed, Explored: distinct by colour, size and ring shape (not colour alone). */
export const SURVEY_LOOKS: readonly SurveyLook[] = [
  { name: 'Unknown', sat: 0, light: 0.42, size: 0.78, ring: RING_DASHED },
  { name: 'Scanned', sat: 0.45, light: 0.7, size: 0.9, ring: RING_THIN },
  { name: 'Surveyed', sat: 0.85, light: 0.92, size: 1, ring: RING_DOUBLE },
  { name: 'Explored', sat: 1, light: 1.05, size: 1.1, ring: RING_HALO },
];

export function surveyLook(level: number): SurveyLook {
  return SURVEY_LOOKS[
    level < 0 ? 0 : level >= SURVEY_LOOKS.length ? SURVEY_LOOKS.length - 1 : level
  ];
}

// ---- Planet view: framing, colony zoom and level of detail -----------------------------------

export interface Fit {
  /** Centre on the x/z plane and the radius that holds every known hex. */
  cx: number;
  cz: number;
  radius: number;
}

export function createFit(): Fit {
  return { cx: 0, cz: 0, radius: 1 };
}

/** The smallest radius the framing uses, so a single known hex is not zoomed to the nose. */
export const MIN_FIT_RADIUS = 2.2;

/**
 * Frame the known part of the map: centre of the bounding box of the hexes that are not hidden,
 * radius = farthest hex centre plus one hex. `centres` has x, y, z per region (stride 3). With no
 * known hex the whole map is framed. Writes `out`.
 */
export function knownBounds(
  centres: ArrayLike<number>,
  fog: ArrayLike<number>,
  count: number,
  hexSize: number,
  out: Fit,
): Fit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let known = 0;
  for (let pass = 0; pass < 2 && known === 0; pass++) {
    for (let i = 0; i < count; i++) {
      if (pass === 0 && fog[i] === FOG_HIDDEN) continue;
      const x = centres[i * 3];
      const z = centres[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      known++;
    }
  }
  if (known === 0) {
    out.cx = 0;
    out.cz = 0;
    out.radius = MIN_FIT_RADIUS;
    return out;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  let far2 = 0;
  for (let i = 0; i < count; i++) {
    const hidden = fog[i] === FOG_HIDDEN;
    if (hidden && known < count) continue;
    const dx = centres[i * 3] - cx;
    const dz = centres[i * 3 + 2] - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > far2) far2 = d2;
  }
  out.cx = cx;
  out.cz = cz;
  const r = Math.sqrt(far2) + hexSize;
  out.radius = r < MIN_FIT_RADIUS ? MIN_FIT_RADIUS : r;
  return out;
}

/** Closest the camera may come, in hex units, and the distances where the colony close-up fades in. */
export const COLONY_MIN_DISTANCE = 2.4;
export const COLONY_ZOOM_FAR = 7;
export const COLONY_ZOOM_NEAR = 4.5;

/** 0 beyond COLONY_ZOOM_FAR, 1 at COLONY_ZOOM_NEAR and closer: how much the colony close-up applies. */
export function colonyZoomBlend(distance: number): number {
  return 1 - smoothstep(COLONY_ZOOM_NEAR, COLONY_ZOOM_FAR, distance);
}

/** Vignette opacity for a colony blend (0 .. 0.9). The base view has none. */
export const VIGNETTE_MAX = 0.9;
export function vignetteStrength(blend: number): number {
  return VIGNETTE_MAX * clamp01(blend);
}

/** Distances (camera to map, hex units) where detail drops out. */
export const LOD_CROWD_MAX = 9;
export const LOD_SMALL_PROPS_MAX = 12;
export const LOD_SIMPLE_DISTRICTS_MIN = 13;

export interface Lod {
  /** Crowd dots (colonists and natives) are drawn. */
  crowd: boolean;
  /** Small props (grass tufts, rocks, slabs) are drawn. */
  smallProps: boolean;
  /** District models are the simple silhouettes. */
  simpleDistricts: boolean;
}

export function createLod(): Lod {
  return { crowd: true, smallProps: true, simpleDistricts: false };
}

/** Fill `out` for a camera `distance`. Returns true when anything changed. */
export function lodFor(distance: number, out: Lod): boolean {
  const crowd = distance <= LOD_CROWD_MAX;
  const smallProps = distance <= LOD_SMALL_PROPS_MAX;
  const simple = distance >= LOD_SIMPLE_DISTRICTS_MIN;
  const changed =
    crowd !== out.crowd || smallProps !== out.smallProps || simple !== out.simpleDistricts;
  out.crowd = crowd;
  out.smallProps = smallProps;
  out.simpleDistricts = simple;
  return changed;
}

/** Camera distance multiplier while the planet view dollies in (e < 1) or out. */
export const DOLLY_FACTOR = 0.9;
export function dollyFactor(e: number): number {
  return 1 + DOLLY_FACTOR * (1 - clamp01(e));
}
