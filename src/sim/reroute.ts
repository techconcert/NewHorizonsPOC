import type { RerouteRejectReason, RerouteShipCommand } from '../shared/commands';
import { distanceFpFromDelta, REROUTE_PENALTY_FUEL, rerouteRangeProblem } from '../shared/loadout';
import { G_ENTITY, G_PLANET, ShipStateId } from './components';
import { shipHasLiveExpedition } from './planet';
import { shipXFp, shipYFp, spendableFuel } from './ships';
import type { World } from './world';

/**
 * Check a RerouteShip command against current state. Returns null when it can apply, else the
 * first reason, in the order: ship exists, Lost, Drifting, card pending, not flying (an Arrived ship with an expedition out: EXPEDITION_ACTIVE), target
 * exists, same target, inside fuel range (fixed penalty plus the new leg). No allocation. D-052.
 */
export function checkReroute(w: World, cmd: RerouteShipCommand): RerouteRejectReason | null {
  const s = w.stores;
  const e = cmd.ship;
  if (e < 0 || e >= s.counts[G_ENTITY]) return 'NO_SUCH_SHIP';
  const st = s.shipState.state[e];
  if (st === ShipStateId.None) return 'NO_SUCH_SHIP';
  if (st === ShipStateId.Lost) return 'SHIP_LOST';
  if (st === ShipStateId.Drifting) return 'SHIP_DRIFTING';
  if (st === ShipStateId.Event) return 'EVENT_PENDING';
  // A ship in orbit with nobody on the ground (never landed, or re-embarked) may leave like a ship
  // in flight; with an expedition out it must take it aboard first (D-071, D-081).
  if (st === ShipStateId.Arrived) {
    if (shipHasLiveExpedition(s, e)) return 'EXPEDITION_ACTIVE';
  } else if (st !== ShipStateId.InTransit && st !== ShipStateId.InOrbit) {
    return 'SHIP_NOT_IN_TRANSIT';
  }
  const target = cmd.target;
  if (target < 0 || target >= s.counts[G_PLANET]) return 'INVALID_TARGET';
  if (target === s.shipRoute.destPlanet[e]) return 'SAME_TARGET';
  const sys = s.planet.system[target];
  const distance = distanceFpFromDelta(
    s.system.x[sys] - shipXFp(w, e),
    s.system.y[sys] - shipYFp(w, e),
  );
  return rerouteRangeProblem(distance, s.ship.speedSetting[e], spendableFuel(w, e));
}

/**
 * Apply a reroute: the new leg starts where the ship is now, the fixed fuel penalty is paid at
 * once and the new distance is burned as the ship flies it. Re-checks first (state may have
 * changed since submit); a failed re-check drops the effect and the log entry stays (D-041).
 */
export function applyReroute(w: World, cmd: RerouteShipCommand): void {
  if (checkReroute(w, cmd) !== null) return;
  const s = w.stores;
  const e = cmd.ship;
  const x = shipXFp(w, e);
  const y = shipYFp(w, e);
  const sys = s.planet.system[cmd.target];
  const route = s.shipRoute;
  route.originX[e] = x;
  route.originY[e] = y;
  route.destPlanet[e] = cmd.target;
  route.distance[e] = distanceFpFromDelta(s.system.x[sys] - x, s.system.y[sys] - y);
  route.progress[e] = 0;
  s.shipState.state[e] = ShipStateId.InTransit;
  s.shipManifest.fuel[e] = s.shipManifest.fuel[e] - REROUTE_PENALTY_FUEL;
}
