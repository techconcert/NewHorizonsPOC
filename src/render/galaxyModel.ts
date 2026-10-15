import {
  DISTANCE_FP,
  rangeFp,
  SUPPLY_MARGIN_COMFORT_PCT,
  SUPPLY_MARGIN_WARN_PCT,
} from '../shared/loadout';
import {
  C_FUEL,
  C_SPACEPORT,
  C_SYSTEM,
  COLONY_STRIDE,
  META_COLONY_COUNT,
  META_SYSTEM_COUNT,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Pure helpers behind the galaxy view art (M6a): glow texture, survey brightness, pip layout,
 * dashed route lines, colony range, margin warnings. No three.js and no DOM, so they run under
 * Node tests. No allocation in the functions called per frame.
 */

/** Core dot radius and glow sprite radius (world units) by star type (red dwarf .. blue). */
export const STAR_CORE_RADIUS: readonly number[] = [6, 7, 8, 9, 10];
export const STAR_GLOW_RADIUS: readonly number[] = [20, 25, 30, 36, 46];
/** Glow strength by star type: small cool stars are fainter, hot blue stars are brighter. */
export const STAR_GLOW_GAIN: readonly number[] = [0.55, 0.65, 0.75, 0.85, 1];

/** Brightness multiplier by survey level: 0 Unknown dim, 1 Scanned, 2 Surveyed, 3 Explored. */
export const SURVEY_BRIGHTNESS: readonly number[] = [0.32, 0.6, 0.82, 1];

export function surveyBrightness(level: number): number {
  const i =
    level < 0 ? 0 : level >= SURVEY_BRIGHTNESS.length ? SURVEY_BRIGHTNESS.length - 1 : level;
  return SURVEY_BRIGHTNESS[i];
}

export function starCoreRadius(starType: number): number {
  return STAR_CORE_RADIUS[starType < 0 ? 0 : Math.min(starType, STAR_CORE_RADIUS.length - 1)];
}

export function starGlowRadius(starType: number): number {
  return STAR_GLOW_RADIUS[starType < 0 ? 0 : Math.min(starType, STAR_GLOW_RADIUS.length - 1)];
}

export function starGlowGain(starType: number): number {
  return STAR_GLOW_GAIN[starType < 0 ? 0 : Math.min(starType, STAR_GLOW_GAIN.length - 1)];
}

/** Glow falloff (retuned for the 0.75 quad scale, D-127): 1 at the centre, 0 from radius 1 outwards, smooth and strictly decreasing. */
export function glowAlpha(r: number): number {
  if (r <= 0) return 1;
  if (r >= 1) return 0;
  const k = 1 - r;
  return k * k * (0.2 + 0.8 * k);
}

/** Fill a size x size RGBA8 texture: white, alpha = glow falloff of the distance from the centre. */
export function fillGlowTexture(out: Uint8Array | Uint8ClampedArray, size: number): void {
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / (half + 0.5);
      const dy = (y - half) / (half + 0.5);
      const a = glowAlpha(Math.sqrt(dx * dx + dy * dy));
      const o = (y * size + x) * 4;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = Math.round(a * 255);
    }
  }
}

/** Highest survey level among the planets of `system` (0 when it has none). */
export function systemSurveyLevel(snap: Snapshot, system: number): number {
  const start = snap.systemPlanetStart[system];
  const n = snap.planetCount[system];
  let best = 0;
  for (let k = 0; k < n; k++) {
    const s = snap.planetSurvey[start + k];
    if (s > best) best = s;
  }
  return best;
}

/** `out[system]` = survey level for every live system; returns the system count. */
export function fillSystemSurvey(snap: Snapshot, out: Uint8Array): number {
  const n = Math.min(snap.meta[META_SYSTEM_COUNT], out.length);
  for (let i = 0; i < n; i++) out[i] = systemSurveyLevel(snap, i);
  return n;
}

/** x offset (world units) of pip `index` of `count` in a row centred on the star. */
export function pipOffsetX(index: number, count: number, spacing: number): number {
  return (index - (count - 1) / 2) * spacing;
}

/**
 * Write a dashed line from (x0, y0) to (x1, y1) as line segments: six floats per dash (two x, y, z
 * vertices, z = 0) into `out` from float offset `off`. A line that would need more than
 * `maxDashes` gets longer dashes and gaps instead, so the buffer never overflows. Returns the
 * number of dashes written.
 */
export function writeDashes(
  out: Float32Array,
  off: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  dash: number,
  gap: number,
  maxDashes: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-6) || maxDashes <= 0 || !(dash > 0)) return 0;
  let d = dash;
  let period = dash + (gap > 0 ? gap : 0);
  const minPeriod = len / maxDashes;
  if (minPeriod > period) {
    d = dash * (minPeriod / period);
    period = minPeriod;
  }
  const ux = dx / len;
  const uy = dy / len;
  let n = 0;
  let t = 0;
  while (t < len && n < maxDashes) {
    const e = t + d < len ? t + d : len;
    const o = off + n * 6;
    out[o] = x0 + ux * t;
    out[o + 1] = y0 + uy * t;
    out[o + 2] = 0;
    out[o + 3] = x0 + ux * e;
    out[o + 4] = y0 + uy * e;
    out[o + 5] = 0;
    n++;
    t += period;
  }
  return n;
}

/** Cruise: the speed the colony range ring is drawn for (speed index 1 in the loadout tables). */
export const RANGE_RING_SPEED = 1;

/**
 * Radius (world units) of the launch range of the colony in `system`: what the fuel in its stock
 * covers at Cruise. 0 when the system holds no colony with a spaceport (ships cannot launch from it).
 */
export function colonyRangeWorld(snap: Snapshot, system: number): number {
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 0; i < n; i++) {
    const o = i * COLONY_STRIDE;
    if (snap.colonies[o + C_SYSTEM] !== system || snap.colonies[o + C_SPACEPORT] === 0) continue;
    const fuel = snap.colonies[o + C_FUEL];
    return fuel > 0 ? rangeFp(fuel, RANGE_RING_SPEED) / DISTANCE_FP : 0;
  }
  return 0;
}

/**
 * Launch range radius for every system: `out[system]` = colonyRangeWorld, 0 where no colony with a
 * spaceport stands. One pass over the colonies, no allocation.
 */
export function fillColonyRanges(snap: Snapshot, out: Float32Array): void {
  out.fill(0);
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 0; i < n; i++) {
    const o = i * COLONY_STRIDE;
    const sys = snap.colonies[o + C_SYSTEM];
    if (sys < 0 || sys >= out.length || snap.colonies[o + C_SPACEPORT] === 0) continue;
    const fuel = snap.colonies[o + C_FUEL];
    if (fuel > 0 && out[sys] === 0) out[sys] = rangeFp(fuel, RANGE_RING_SPEED) / DISTANCE_FP;
  }
}

/** System of the first colony with a spaceport (where Mission Command launches from), or -1. */
export function launchOriginSystem(snap: Snapshot): number {
  const n = snap.meta[META_COLONY_COUNT];
  for (let i = 0; i < n; i++) {
    if (snap.colonies[i * COLONY_STRIDE + C_SPACEPORT] !== 0) {
      return snap.colonies[i * COLONY_STRIDE + C_SYSTEM];
    }
  }
  return -1;
}

/**
 * Supply warning of a ship marker: 0 none, 1 thin margin (under the comfort mark), 2 short (under
 * 100%). Only ships in flight with colonists aboard get one, like the ship list.
 */
export function shipMarginWarning(margin: number, colonists: number, flying: boolean): 0 | 1 | 2 {
  if (!flying || colonists <= 0) return 0;
  if (margin < SUPPLY_MARGIN_WARN_PCT) return 2;
  return margin < SUPPLY_MARGIN_COMFORT_PCT ? 1 : 0;
}

/** Two clicks on the same target this close in time (ms) make a double-click (M7c). */
export const DOUBLE_CLICK_MS = 350;

/**
 * True when a click on `key` at `nowMs` is the second half of a double-click: the previous click was
 * on the same target (`lastKey`, -1 for none) no more than `windowMs` earlier. Pure; the caller
 * keeps the previous time and key.
 */
export function isDoubleClick(
  lastMs: number,
  lastKey: number,
  nowMs: number,
  key: number,
  windowMs: number = DOUBLE_CLICK_MS,
): boolean {
  if (key < 0 || key !== lastKey) return false;
  const dt = nowMs - lastMs;
  return dt >= 0 && dt <= windowMs;
}
