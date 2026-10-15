import { FP_SCALE, ShipStateId, type LostReason } from './components';
import type { World } from './world';

export type LostReasonId = (typeof LostReason)[keyof typeof LostReason];

/** One coordinate of a point on a straight leg: origin + (target - origin) x progress / distance. */
export function legCoord(
  origin: number,
  target: number,
  progress: number,
  distance: number,
): number {
  if (distance <= 0 || progress >= distance) return target;
  return origin + Math.round(((target - origin) * progress) / distance);
}

/** Grid x of a ship on its current leg. */
export function shipXFp(w: World, e: number): number {
  const s = w.stores;
  const target = s.system.x[s.planet.system[s.shipRoute.destPlanet[e]]];
  return legCoord(s.shipRoute.originX[e], target, s.shipRoute.progress[e], s.shipRoute.distance[e]);
}

/** Grid y of a ship on its current leg. */
export function shipYFp(w: World, e: number): number {
  const s = w.stores;
  const target = s.system.y[s.planet.system[s.shipRoute.destPlanet[e]]];
  return legCoord(s.shipRoute.originY[e], target, s.shipRoute.progress[e], s.shipRoute.distance[e]);
}

/** Write the ship's render position (world units) for the current leg progress. */
export function writeCurrPosition(w: World, e: number): void {
  const s = w.stores;
  s.currPosition[e * 2] = shipXFp(w, e) / FP_SCALE;
  s.currPosition[e * 2 + 1] = shipYFp(w, e) / FP_SCALE;
}

/**
 * Whole fuel units the ship can still burn: the stored amount less a unit that is already
 * partly burned (fuelFrac > 0), so a range check with it can never promise too much.
 */
export function spendableFuel(w: World, e: number): number {
  const s = w.stores;
  return s.shipRoute.fuelFrac[e] > 0 ? s.shipManifest.fuel[e] - 1 : s.shipManifest.fuel[e];
}

/** Mark a ship Lost with a reason and the day (score log). Idempotent. */
export function loseShip(w: World, e: number, reason: LostReasonId): void {
  const s = w.stores;
  if (s.shipState.state[e] === ShipStateId.Lost) return;
  s.shipState.state[e] = ShipStateId.Lost;
  s.shipLog.lostReason[e] = reason;
  s.shipLog.lostDay[e] = s.run.day[0];
  s.run.shipsLost[0] = s.run.shipsLost[0] + 1;
}
