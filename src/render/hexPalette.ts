/**
 * Planet view colours and the fog mapping (pure, no three.js). The tile colour of a region is a
 * function of its fog state and terrain id only; hidden regions return one fixed fog colour for
 * every terrain value, so a tile never shows terrain the snapshot withheld.
 */

/** Terrain colours in terrain.json order: plains, highlands, jungle, ice, crater, ruins. */
export const TERRAIN_COLORS: readonly number[] = [
  0x8fbf5a, 0xa58d6b, 0x2f8f4e, 0xcdeaf4, 0x7d7482, 0xcaa24c,
];
/** An unrevealed region: dark, with no terrain information at all. */
export const FOG_HIDDEN_COLOR = 0x121826;
/** Visible-but-unexplored regions fade this far towards the fog colour (percent). */
export const FOG_VISIBLE_FADE_PCT = 62;

import { FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE } from '../shared/fog';

// Re-exported so the render code and its tests keep one import path.
export { FOG_EXPLORED, FOG_HIDDEN, FOG_VISIBLE };

/** Tile heights by fog state: unknown ground is flat, explored ground stands proud. */
export const TILE_HEIGHT_HIDDEN = 0.12;
export const TILE_HEIGHT_VISIBLE = 0.26;
export const TILE_HEIGHT_EXPLORED = 0.4;

export const SELECT_COLOR = 0x3dffb0;
export const SECOND_COLOR = 0xffcf5d;
export const HOVER_COLOR = 0xffffff;

export const LANDING_COLOR = 0xffffff;
export const TEAM_COLOR = 0x7fe9ff;
export const NATIVE_COLOR = 0xff7a45;
export const COLONY_COLOR = 0xd98bff;
/** Find marker colours by find kind id (terrain.json findKinds order). */
export const FIND_COLORS: readonly number[] = [
  0xb5e06b, // farmland
  0x4aa8ff, // water
  0xc9784a, // ore
  0xe8e08a, // defensible
  0x58d68d, // rich food
  0xd9467a, // disease
  0x9fe3ff, // fuel ice
  0xb48cff, // rare minerals
  0xffb347, // tech
  0xff5fd2, // mystery
  0x808080, // nothing (never drawn)
];

function mixHex(a: number, b: number, tPct: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + ((br - ar) * tPct) / 100);
  const g = Math.round(ag + ((bg - ag) * tPct) / 100);
  const bl = Math.round(ab + ((bb - ab) * tPct) / 100);
  return (r << 16) | (g << 8) | bl;
}

/** Colour of a visible-but-unexplored tile of `terrain`. */
export function visibleTerrainColor(terrain: number): number {
  return mixHex(TERRAIN_COLORS[terrain], FOG_HIDDEN_COLOR, FOG_VISIBLE_FADE_PCT);
}

/**
 * Tile colour from the snapshot's fog byte and terrain id. Fog 0 (or any unknown fog value)
 * always gives FOG_HIDDEN_COLOR, whatever the terrain value is; fog 1 gives the faded terrain
 * colour; fog 3 gives the full terrain colour. A terrain id outside the table (255) on a revealed
 * tile also falls back to the fog colour.
 */
export function tileColorHex(fog: number, terrain: number): number {
  if (fog !== FOG_VISIBLE && fog !== FOG_EXPLORED) return FOG_HIDDEN_COLOR;
  if (terrain < 0 || terrain >= TERRAIN_COLORS.length) return FOG_HIDDEN_COLOR;
  return fog === FOG_EXPLORED ? TERRAIN_COLORS[terrain] : visibleTerrainColor(terrain);
}

/** Tile height from the fog byte. */
export function tileHeight(fog: number): number {
  return fog === FOG_EXPLORED
    ? TILE_HEIGHT_EXPLORED
    : fog === FOG_VISIBLE
      ? TILE_HEIGHT_VISIBLE
      : TILE_HEIGHT_HIDDEN;
}

// ---- Relief and art colours (planet view art pass, D-117) -------------------------------------

/** Extra height of a revealed tile by terrain: plains, highlands, jungle, ice, crater, ruins. */
export const TERRAIN_RELIEF: readonly number[] = [0, 0.34, 0.1, 0.04, -0.06, 0.06];
/** How far a tile's centre sits above (+) or below (-) its rim: a peak on highlands, a bowl in a crater. */
export const TERRAIN_CENTRE_LIFT: readonly number[] = [0.02, 0.2, 0.06, 0, -0.18, 0];

function revealed(fog: number, terrain: number): boolean {
  return (
    (fog === FOG_VISIBLE || fog === FOG_EXPLORED) && terrain >= 0 && terrain < TERRAIN_RELIEF.length
  );
}

/** Top height of a tile: fog height plus the terrain relief; a hidden tile shows no relief at all. */
export function tileTopY(fog: number, terrain: number): number {
  return tileHeight(fog) + (revealed(fog, terrain) ? TERRAIN_RELIEF[terrain] : 0);
}

/** Centre lift of a tile (0 while hidden, so relief never leaks). */
export function tileCentreLift(fog: number, terrain: number): number {
  return revealed(fog, terrain) ? TERRAIN_CENTRE_LIFT[terrain] : 0;
}

/**
 * Vertex colour of a tile before the fog texture mutes it: the full terrain colour once the
 * terrain is known (visible and explored), else the one hidden colour for every terrain value.
 */
export function tileBaseColorHex(fog: number, terrain: number): number {
  return revealed(fog, terrain) ? TERRAIN_COLORS[terrain] : FOG_HIDDEN_COLOR;
}

/** Shore tint blended into tile edges that have no neighbour (the coast). */
export const SHORE_COLOR = 0xd9c88f;

/** Native disposition (1 Peaceful, 2 Wary, 3 Hostile) tints for huts and crowd dots. */
export const NATIVE_TINTS: readonly number[] = [0xffffff, 0xa6ffa0, 0xffd45e, 0xff5a4a];
