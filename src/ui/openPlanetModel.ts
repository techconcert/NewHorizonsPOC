import {
  META_COLONY_COUNT,
  CD_PLANET,
  COLONY_DETAIL_STRIDE,
  type Snapshot,
} from '../shared/snapshot';
import { rerouteBlockerOfRow } from '../shared/transit';
import { isParkedState } from '../shared/planetSnapshot';
import { canLand } from './planetSession';

/**
 * Pure helpers for "open the planet" entry points (M7c): the ship list, the reroute panel, the
 * Colonies panel and clicks in the system view. No DOM. The planet view itself only opens for a
 * planet with a parked ship, an expedition on the ground or a colony (`canLand`).
 */

/** Text for the badge and the reroute message when a ground expedition holds the ship. */
export const GROUND_BADGE_TEXT = 'Expedition on the ground';
export const GROUND_HELP_TEXT =
  'Open the planet and press "Re-embark the expedition" to bring the party back aboard.';

/** Hint shown in the system panel. */
export const DOUBLE_CLICK_HINT = 'Double-click a planet to open it';

/**
 * Planet to open for the ship in snapshot row `row` when an expedition on the ground blocks it from
 * leaving (the reroute blocker EXPEDITION_ACTIVE), else -1. The ship is parked at its destination.
 */
export function groundBlockedPlanet(snap: Snapshot, row: number): number {
  if (row < 0 || !isParkedState(snap.shipState[row])) return -1;
  if (rerouteBlockerOfRow(snap, row) !== 'EXPEDITION_ACTIVE') return -1;
  const planet = snap.shipDest[row];
  return canLand(snap, planet) ? planet : -1;
}

/** Planet index of colony row `row` (0 is the homeworld), or -1 when the row does not exist. */
export function colonyPlanetOfRow(snap: Snapshot, row: number): number {
  if (row < 0 || row >= snap.meta[META_COLONY_COUNT]) return -1;
  return snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_PLANET];
}

/** Planet to open for colony row `row`, or -1 when the planet view cannot open for it. */
export function openableColonyPlanet(snap: Snapshot, row: number): number {
  const planet = colonyPlanetOfRow(snap, row);
  return planet >= 0 && canLand(snap, planet) ? planet : -1;
}

export type PlanetClickAction = 'open' | 'select' | 'none';

/**
 * What a click on a planet in the system view does. A planet with a colony, a parked ship or an
 * expedition opens the planet view at once; any other planet is only selected as the destination,
 * and a double-click on it has nothing to open (the caller says so).
 */
export function planetClickAction(
  snap: Snapshot,
  planet: number,
  double: boolean,
): PlanetClickAction {
  if (canLand(snap, planet)) return 'open';
  return double ? 'none' : 'select';
}

/** Message for a double-click on a planet with nothing to open. */
export const NOTHING_TO_OPEN_TEXT =
  'Nothing to open there: send a ship to that planet, or pick a planet with a colony or a ship.';
