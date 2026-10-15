/**
 * WCAG 2.x contrast helpers (M8, D-140). Pure: parse a CSS colour, flatten alpha over a background,
 * compute relative luminance and the contrast ratio. Used by a test that checks the text tokens of
 * both themes; nothing here runs in the game.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 to 1. */
  a: number;
}

/** "#rgb", "#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)"; null when not understood. */
export function parseColour(text: string): Rgba | null {
  const t = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1,
    };
  }
  m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(t);
  if (m) {
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4]),
    };
  }
  return null;
}

/** `top` drawn over an opaque `bottom`. */
export function flatten(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1 to 21. Translucent colours are first flattened over `backdrop`. */
export function contrastRatio(
  fg: Rgba,
  bg: Rgba,
  backdrop: Rgba = { r: 0, g: 0, b: 0, a: 1 },
): number {
  const b = flatten(bg, backdrop);
  const f = flatten(fg, b);
  const l1 = luminance(f);
  const l2 = luminance(b);
  const hi = l1 > l2 ? l1 : l2;
  const lo = l1 > l2 ? l2 : l1;
  return (hi + 0.05) / (lo + 0.05);
}

/** Minimum ratio for normal text (WCAG AA). */
export const AA_TEXT_RATIO = 4.5;
