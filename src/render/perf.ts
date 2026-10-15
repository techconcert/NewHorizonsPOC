/**
 * Render cost controls (D-127): pure helpers for the resolution scaler, the animation step, the
 * glow quad clamp, the range fill rule and the `?fx=` debug flags. No three.js and no DOM, so they
 * run under Node tests. Nothing here allocates per frame.
 */

/** Render scale steps, best first: full, three quarters, half the device pixels per axis. */
export const SCALE_STEPS: readonly number[] = [1, 0.75, 0.5];
/** Frame cost (EMA, ms) above which the scale steps down, and below which it may step up. */
export const SCALE_DOWN_MS = 36;
export const SCALE_UP_MS = 20;
/** The cost predicted at the next finer step must also stay under this before stepping up. */
export const SCALE_UP_PREDICTED_MS = 30;
/** EMA length in frames, and the quiet frames required after a change before the next one. */
export const SCALE_EMA_FRAMES = 20;
export const SCALE_DOWN_COOLDOWN = 20;
export const SCALE_UP_COOLDOWN = 90;
/** Device pixel ratio cap. */
export const MAX_DPR = 2;

export interface Scaler {
  /** Index into SCALE_STEPS. */
  index: number;
  /** Smoothed frame cost in ms; negative until the first sample after a (re)start. */
  ema: number;
  sinceChange: number;
  /** A pinned scaler never moves (?fx=scale=n). */
  pinned: boolean;
  /** The exact scale of a pinned scaler, 0 otherwise. */
  fixed: number;
}

/** The step index whose scale is closest to `scale`. */
export function scaleIndexFor(scale: number): number {
  let best = 0;
  for (let i = 1; i < SCALE_STEPS.length; i++) {
    if (Math.abs(SCALE_STEPS[i] - scale) < Math.abs(SCALE_STEPS[best] - scale)) best = i;
  }
  return best;
}

export function createScaler(startScale: number, pinned = false): Scaler {
  return {
    index: scaleIndexFor(startScale),
    ema: -1,
    sinceChange: 0,
    pinned,
    fixed: pinned ? startScale : 0,
  };
}

export function scalerScale(s: Scaler): number {
  return s.fixed > 0 ? s.fixed : SCALE_STEPS[s.index];
}

/**
 * Feed one frame cost (ms). Returns true when the step changed. Down needs the EMA over 36 ms for
 * 20 quiet frames; up needs the EMA under 20 ms, a predicted cost (scaled by the pixel ratio) under
 * 30 ms and 90 quiet frames, so the two never chase each other.
 */
export function scalerSample(s: Scaler, costMs: number): boolean {
  if (!(costMs >= 0)) return false;
  const k = 2 / (SCALE_EMA_FRAMES + 1);
  s.ema = s.ema < 0 ? costMs : s.ema + (costMs - s.ema) * k;
  s.sinceChange++;
  if (s.pinned) return false;
  if (
    s.ema > SCALE_DOWN_MS &&
    s.index < SCALE_STEPS.length - 1 &&
    s.sinceChange >= SCALE_DOWN_COOLDOWN
  ) {
    s.index++;
    s.ema = -1;
    s.sinceChange = 0;
    return true;
  }
  if (s.ema < SCALE_UP_MS && s.index > 0 && s.sinceChange >= SCALE_UP_COOLDOWN) {
    const ratio = SCALE_STEPS[s.index - 1] / SCALE_STEPS[s.index];
    if (s.ema * ratio * ratio < SCALE_UP_PREDICTED_MS) {
      s.index--;
      s.ema = -1;
      s.sinceChange = 0;
      return true;
    }
  }
  return false;
}

/** Pixel ratio the renderer uses: device ratio (capped at 2) times the render scale. */
export function effectivePixelRatio(dpr: number, scale: number): number {
  const d = dpr > 0 ? (dpr < MAX_DPR ? dpr : MAX_DPR) : 1;
  return d * scale;
}

/** Animation redraw step (ms): at least 33, 1.5x the last frame cost, fixed 66 on software GL. */
export const ANIM_STEP_MIN_MS = 33;
export const ANIM_STEP_SOFTWARE_MS = 66;
export function animStepMs(lastFrameCostMs: number, software: boolean): number {
  if (software) return ANIM_STEP_SOFTWARE_MS;
  const adaptive = lastFrameCostMs * 1.5;
  return adaptive > ANIM_STEP_MIN_MS ? adaptive : ANIM_STEP_MIN_MS;
}

/** Largest on-screen radius (CSS pixels) of a glow quad. */
export const GLOW_MAX_PX = 90;
/** Glow quad radius in world units, clamped so it never covers more than GLOW_MAX_PX on screen. */
export function clampGlowRadius(radiusWorld: number, camScale: number): number {
  if (!(camScale > 0)) return radiusWorld;
  const cap = GLOW_MAX_PX / camScale;
  return radiusWorld < cap ? radiusWorld : cap;
}
/** Gain multiplier that gives back part of the light lost to the clamp (square root of the ratio, at most 1.5). */
export function glowGainCompensation(radiusWorld: number, clampedWorld: number): number {
  if (!(clampedWorld > 0) || clampedWorld >= radiusWorld) return 1;
  const g = Math.sqrt(radiusWorld / clampedWorld);
  return g < 1.5 ? g : 1.5;
}
/** Glow quads are drawn at this share of the nominal radius (area down about 44%). */
export const GLOW_QUAD_SCALE = 0.75;

/** The range fill is hidden (the ring stays) when it would cover most of the screen. */
export function rangeFillVisible(
  radiusWorld: number,
  camScale: number,
  viewportPx: number,
): boolean {
  return radiusWorld * camScale <= 0.6 * viewportPx;
}

/** Debug flags from `?fx=nomsaa,scale=0.5,nonebula,noglow,nofield`; absent means defaults. */
export interface Fx {
  noMsaa: boolean;
  /** Pinned render scale in (0, 1], or 0 for automatic. */
  scale: number;
  noNebula: boolean;
  noGlow: boolean;
  noField: boolean;
}

export function parseFx(search: string): Fx {
  const fx: Fx = { noMsaa: false, scale: 0, noNebula: false, noGlow: false, noField: false };
  const m = /[?&]fx=([^&]*)/.exec(search);
  if (!m) return fx;
  for (const raw of decodeURIComponent(m[1]).split(',')) {
    const t = raw.trim().toLowerCase();
    if (t === 'nomsaa') fx.noMsaa = true;
    else if (t === 'nonebula') fx.noNebula = true;
    else if (t === 'noglow') fx.noGlow = true;
    else if (t === 'nofield') fx.noField = true;
    else if (t.startsWith('scale=')) {
      const n = Number(t.slice(6));
      if (n > 0 && n <= 1) fx.scale = n < 0.25 ? 0.25 : n;
    }
  }
  return fx;
}

/** True when a WEBGL_debug_renderer_info string names a software rasteriser. */
export function isSoftwareRendererName(name: string): boolean {
  return /swiftshader|llvmpipe|software/i.test(name);
}

/** Render quality from Settings (M8, D-149): the automatic scaler, or a pinned low / high scale. */
export type RenderQuality = 'auto' | 'low' | 'high';
/** Pinned scale per quality; 0 means automatic. */
export const QUALITY_SCALE: Readonly<Record<RenderQuality, number>> = {
  auto: 0,
  low: 0.5,
  high: 1,
};

/**
 * Apply a quality choice to a scaler. `autoStart` is the scale automatic mode starts from (0.5 on
 * software GL, else 1). A scaler pinned by `?fx=scale=n` is a debug override and is left alone.
 * Returns true when the effective scale changed (the caller then re-applies the pixel ratio).
 */
export function applyQuality(
  s: Scaler,
  quality: RenderQuality,
  autoStart: number,
  fxPinned: boolean,
): boolean {
  if (fxPinned) return false;
  const before = scalerScale(s);
  const pin = QUALITY_SCALE[quality];
  if (pin > 0) {
    s.pinned = true;
    s.fixed = pin;
  } else {
    s.pinned = false;
    s.fixed = 0;
    s.index = scaleIndexFor(autoStart);
    s.ema = -1;
    s.sinceChange = 0;
  }
  return scalerScale(s) !== before;
}
