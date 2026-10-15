import type { ShipKind } from '../shared/transit';

/** Star colours by StarType (0 red dwarf .. 4 blue). Placeholder palette. */
export const STAR_COLORS: readonly number[] = [0xff6a4d, 0xffa94d, 0xffe66d, 0xf0f4ff, 0x6db3ff];
/** The homeworld is drawn in a colour no star type uses. */
export const HOME_COLOR = 0x3dffb0;
export const RING_COLOR = 0xffffff;
export const BACKGROUND_COLOR = 0x05070d;
/** Launched ships are drawn in cyan, apart from every star colour. */
export const SHIP_COLOR = 0x7fe9ff;

/**
 * Ship marker look by state (M3b). Colour plus size so the state does not rest on colour alone
 * (accessibility pass is M8): in transit cyan, event pending amber and larger, drifting red,
 * arrived pale and smaller, lost grey. Lost ships are not in the snapshot (D-059), so 'lost' is
 * only used if the sim ever lists one.
 */
export const SHIP_KIND_COLORS: Record<ShipKind, number> = {
  transit: SHIP_COLOR,
  event: 0xffcf5d,
  drifting: 0xff6b5b,
  arrived: 0xb9c7e6,
  lost: 0x6b6f7a,
};
/** Marker size multiplier by state. */
export const SHIP_KIND_SCALE: Record<ShipKind, number> = {
  transit: 1,
  event: 1.3,
  drifting: 1.1,
  arrived: 0.8,
  lost: 0.8,
};
/** Selected ship: marker scale and highlight ring colour. */
export const SELECTED_SHIP_SCALE = 1.4;
export const SELECTED_SHIP_RING_COLOR = 0xffffff;
/** Route lines: dim for every ship in flight, bright for the selected ship. */
export const ROUTE_COLOR = 0x2c5a7a;
export const ROUTE_SELECTED_COLOR = 0x9fe9ff;
/** The reroute preview line from the selected ship to the clicked target. */
export const PREVIEW_COLOR = 0xffcf5d;
/** Range ring, its faint fill and the halo on reachable systems. */
export const RANGE_COLOR = 0x3dffb0;
export const RANGE_FILL_OPACITY = 0.05;
export const REACH_COLOR = 0x3dffb0;

/** Ring drawn around a system that holds a colony founded by an expedition. */
export const COLONY_RING_COLOR = 0xd98bff;

/** Survey pips under each star, by planet survey level: Unknown hollow-dim .. Explored bright. */
export const PIP_COLORS: readonly number[] = [0x3a4560, 0x8fa8d8, 0x5fd6e8, 0x3dffb0];
/** Selection ring (dashed, turning) around the selected system. */
export const SELECTION_COLOR = 0xffffff;
/** Dashed line from the launch colony to the system picked in Mission Command. */
export const DEST_LINE_COLOR = 0xffcf5d;
/** Range ring of the selected colony (launch range at Cruise from its fuel stock). */
export const COLONY_RANGE_COLOR = 0xd98bff;
/** Pulsing ring on a ship whose supply margin is thin (amber) or short (red). */
export const MARGIN_WARN_COLORS: readonly number[] = [0, 0xffcf5d, 0xff6b5b];
/** Nebula tint reference for the backdrop; the texture itself comes from background.ts. */
export const STAR_FIELD_COUNT = 1800;

/** System view (M6c): orbit rings, the selected planet's orbit, and the colony marker ring. */
export const SYSTEM_ORBIT_COLOR = 0x2f4268;
export const SYSTEM_ORBIT_SELECTED_COLOR = 0x8fb0ff;
export const SYSTEM_COLONY_COLOR = COLONY_RING_COLOR;
export const SYSTEM_SELECT_COLOR = SELECTION_COLOR;
