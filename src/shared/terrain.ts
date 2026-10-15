import { FIND_KINDS, TERRAINS } from '../data';

/**
 * Terrain and find names for the planet view and its panels, read from src/data/terrain.json so
 * the UI never hard-codes a table (src/ui and src/render may not import src/data directly).
 */

export const TERRAIN_COUNT_SHARED = TERRAINS.length;
export const TERRAIN_NAMES: readonly string[] = TERRAINS.map((t) => t.name);
/** Hazard text of each terrain as written in the data: Low, Medium, High or Variable. */
export const TERRAIN_FLAVOUR: readonly string[] = TERRAINS.map((t) => t.flavour);
export const TERRAIN_HAZARD_TEXT: readonly string[] = TERRAINS.map((t) => t.hazard);

const HAZARD_LEVELS: Record<string, number> = { Low: 1, Medium: 2, High: 3 };
/** Hazard level 1 Low, 2 Medium, 3 High; 0 for Variable (rolled each time, like the sim). */
export const TERRAIN_HAZARD_LEVEL: Int8Array = Int8Array.from(
  TERRAINS,
  (t) => HAZARD_LEVELS[t.hazard] ?? 0,
);

function pretty(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const FIND_COUNT = FIND_KINDS.length;
export const FIND_LABELS: readonly string[] = FIND_KINDS.map(pretty);
/** Index of the 'nothing' find: explored, but no marker is drawn. */
export const FIND_NONE_INDEX = FIND_KINDS.indexOf('nothing');

/** Terrain name, or 'Unknown' for 255 / out of range (hidden regions never name their terrain). */
export function terrainName(terrain: number): string {
  return terrain >= 0 && terrain < TERRAIN_NAMES.length ? TERRAIN_NAMES[terrain] : 'Unknown';
}

/** One line of flavour for a terrain, or '' for 255 / out of range. */
export function terrainFlavour(terrain: number): string {
  return terrain >= 0 && terrain < TERRAIN_FLAVOUR.length ? TERRAIN_FLAVOUR[terrain] : '';
}

/** Find label, or '' for 255 / out of range. */
export function findLabel(find: number): string {
  return find >= 0 && find < FIND_LABELS.length ? FIND_LABELS[find] : '';
}
