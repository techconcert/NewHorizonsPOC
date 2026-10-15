/**
 * Where the planet map sits on screen. The HUD panels cover a column on the right (wide screens)
 * or the lower part of the screen (narrow screens, where they stack), so the map is centred in the
 * free area instead of the whole canvas. Pure math; planetView turns it into a camera view offset.
 */

/** Width of the right-hand panel column plus its margin (matches .hud-col-right in style.css). */
export const PANEL_COLUMN_PX = 436;
/** Panel column plus margin when the screen is 1100 px wide or less (--col-w is 360 px there). */
export const PANEL_COLUMN_COMPACT_PX = 376;
/** Screens up to this width get the compact column. */
export const COMPACT_WIDTH_PX = 1100;
/** Below this width the panels stack and the map takes the top part of the screen. */
export const NARROW_WIDTH_PX = 800;
/** Share of the height the map gets when the panels are stacked below it. */
export const NARROW_MAP_FRACTION = 0.42;
/** The top bar height the map keeps clear of on narrow screens. */
export const NARROW_TOP_PX = 96;

export interface ViewArea {
  /** Centre of the free area in canvas pixels. */
  cx: number;
  cy: number;
  /** Size of the free area. */
  width: number;
  height: number;
  /** Camera view offset that moves the world origin from the canvas centre to (cx, cy). */
  offsetX: number;
  offsetY: number;
  /** Factor to multiply a distance fitted to the free area by, since the projection spans the full canvas. */
  distanceScale: number;
}

export function createViewArea(): ViewArea {
  return { cx: 0, cy: 0, width: 1, height: 1, offsetX: 0, offsetY: 0, distanceScale: 1 };
}

/** Width the right-hand column takes at screen width `w` (matches the CSS breakpoints). */
export function panelColumnPx(w: number): number {
  return w <= COMPACT_WIDTH_PX ? PANEL_COLUMN_COMPACT_PX : PANEL_COLUMN_PX;
}

/** Fill `out` for a canvas of w by h pixels. No allocation. */
export function computeViewArea(w: number, h: number, out: ViewArea): ViewArea {
  if (w < NARROW_WIDTH_PX) {
    const top = Math.min(NARROW_TOP_PX, h * 0.2);
    out.width = w;
    out.height = Math.max(1, (h - top) * NARROW_MAP_FRACTION);
    out.cx = w / 2;
    out.cy = top + out.height / 2;
  } else {
    out.width = Math.max(1, w - panelColumnPx(w));
    out.height = h;
    out.cx = out.width / 2;
    out.cy = h / 2;
  }
  out.offsetX = w / 2 - out.cx;
  out.offsetY = h / 2 - out.cy;
  out.distanceScale = h / out.height;
  return out;
}

/** Width the Mission Command panel takes on the left (--mc-w 310 px plus its margin). */
export const MISSION_PANEL_PX = 326;

/**
 * The part of the galaxy canvas the system view fills: clear of the right-hand column and, on wide
 * screens, of the Mission Command panel on the left. Narrow screens use the same area as the
 * planet map. Fills `out` (the camera offset fields stay unused). No allocation.
 */
export function computeSystemArea(w: number, h: number, out: ViewArea): ViewArea {
  computeViewArea(w, h, out);
  if (w >= NARROW_WIDTH_PX) {
    const left = MISSION_PANEL_PX;
    const right = panelColumnPx(w);
    const free = w - left - right;
    if (free >= w * 0.3) {
      out.width = free;
      out.cx = left + free / 2;
    }
  }
  return out;
}
