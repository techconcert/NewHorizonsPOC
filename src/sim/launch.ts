import type { LaunchRejectReason, LaunchShipCommand } from '../shared/commands';
import {
  distanceFpFromDelta,
  etaDays,
  fuelAmount,
  firstLaunchProblem,
  kitAmount,
  passengerAmount,
  productionCost,
  securityAmount,
  supplyAmount,
} from '../shared/loadout';
import { SNAPSHOT_MAX_SHIPS } from '../shared/snapshot';
import { FP_SCALE, G_ENTITY, G_PLANET, MAX_ENTITIES, ShipStateId, type Stores } from './components';
import { spawnEntity } from './entities';
import type { World } from './world';

/** Starting hull integrity of a new ship (percent). PLACEHOLDER. */
export const LAUNCH_INTEGRITY = 100;

/**
 * Ships that count against the 256 cap: every ship except Lost ones, which only keep their id for
 * the score log (D-059). Scans entity ids; for validation, not the tick.
 */
export function countShips(s: Stores): number {
  const n = s.counts[G_ENTITY];
  let ships = 0;
  for (let e = 0; e < n; e++) {
    const st = s.shipState.state[e];
    if (st !== ShipStateId.None && st !== ShipStateId.Lost) ships++;
  }
  return ships;
}

/** True when entity `e` is a colony: it owns the planet it claims. */
export function isColony(s: Stores, e: number): boolean {
  if (e < 0 || e >= s.counts[G_ENTITY]) return false;
  return s.planet.owner[s.colony.planet[e]] === e;
}

/** Distance in grid units between the systems holding two planets. */
export function planetDistanceFp(s: Stores, fromPlanet: number, toPlanet: number): number {
  const a = s.planet.system[fromPlanet];
  const b = s.planet.system[toPlanet];
  return distanceFpFromDelta(s.system.x[a] - s.system.x[b], s.system.y[a] - s.system.y[b]);
}

/**
 * Check a LaunchShip command against current state. Returns null when it can launch, else the
 * first reason, in the order: colony, spaceport, destination, loadout (hull, speed, dials, cap,
 * passengers), range, stockpile (passengers, supplies, fuel, production), ship limits.
 * No allocation.
 */
export function checkLaunch(w: World, cmd: LaunchShipCommand): LaunchRejectReason | null {
  const s = w.stores;
  const col = cmd.colony;
  if (!isColony(s, col)) return 'NO_SUCH_COLONY';
  if (s.colony.spaceport[col] === 0) return 'NO_SPACEPORT';
  const target = cmd.target;
  if (target < 0 || target >= s.counts[G_PLANET] || s.planet.owner[target] >= 0) {
    return 'INVALID_TARGET';
  }
  const distance = planetDistanceFp(s, s.colony.planet[col], target);
  const problem = firstLaunchProblem(
    cmd,
    distance,
    s.colony.population[col],
    s.stockpile.supplies[col],
    s.stockpile.fuel[col],
    s.stockpile.production[col],
  );
  if (problem) return problem;
  if (s.counts[G_ENTITY] >= MAX_ENTITIES) return 'ENTITY_LIMIT';
  if (countShips(s) >= SNAPSHOT_MAX_SHIPS) return 'SHIP_LIMIT';
  return null;
}

/**
 * Apply a LaunchShip at the start of a tick: re-check (state may have changed since submit),
 * deduct passengers, supplies, fuel and Production from the colony stockpile, and spawn the ship
 * with its loadout. The ship sits at its origin system in state InTransit; TravelSystem (M3)
 * moves it. If the re-check fails the command is dropped (it stays in the log, deterministically).
 */
export function applyLaunch(w: World, cmd: LaunchShipCommand): void {
  if (checkLaunch(w, cmd) !== null) return;
  const s = w.stores;
  const col = cmd.colony;

  s.colony.population[col] -= passengerAmount(cmd);
  s.stockpile.supplies[col] -= supplyAmount(cmd);
  s.stockpile.fuel[col] -= fuelAmount(cmd);
  s.stockpile.production[col] -= productionCost(cmd);

  const originPlanet = s.colony.planet[col];
  spawnShip(w, {
    hull: cmd.hull,
    speed: cmd.speed,
    colonists: passengerAmount(cmd),
    supplies: supplyAmount(cmd),
    fuel: fuelAmount(cmd),
    kit: kitAmount(cmd),
    security: securityAmount(cmd),
    destPlanet: cmd.target,
    originSystem: s.planet.system[originPlanet],
  });
}

/** Everything a new ship starts with. */
export interface ShipSpawn {
  hull: number;
  speed: number;
  colonists: number;
  supplies: number;
  fuel: number;
  kit: number;
  security: number;
  destPlanet: number;
  originSystem: number;
}

/**
 * Create a ship entity InTransit at `originSystem` bound for `destPlanet` with full integrity.
 * Used by LaunchShip and by tests that set a fleet up directly (no stockpile is touched).
 * Returns the entity id.
 */
export function spawnShip(w: World, p: ShipSpawn): number {
  const s = w.stores;
  const eid = spawnEntity(w);
  const destSystem = s.planet.system[p.destPlanet];
  s.ship.hull[eid] = p.hull;
  s.ship.integrity[eid] = LAUNCH_INTEGRITY;
  s.ship.speedSetting[eid] = p.speed;
  s.shipManifest.colonists[eid] = p.colonists;
  s.shipManifest.supplies[eid] = p.supplies;
  s.shipManifest.fuel[eid] = p.fuel;
  s.shipManifest.kit[eid] = p.kit;
  s.shipManifest.security[eid] = p.security;
  s.shipRoute.destPlanet[eid] = p.destPlanet;
  s.shipRoute.originSystem[eid] = p.originSystem;
  s.shipRoute.originX[eid] = s.system.x[p.originSystem];
  s.shipRoute.originY[eid] = s.system.y[p.originSystem];
  s.shipRoute.distance[eid] = distanceFpFromDelta(
    s.system.x[destSystem] - s.system.x[p.originSystem],
    s.system.y[destSystem] - s.system.y[p.originSystem],
  );
  s.shipRoute.progress[eid] = 0;
  s.shipState.state[eid] = ShipStateId.InTransit;

  const x = s.system.x[p.originSystem] / FP_SCALE;
  const y = s.system.y[p.originSystem] / FP_SCALE;
  s.prevPosition[eid * 2] = x;
  s.prevPosition[eid * 2 + 1] = y;
  s.currPosition[eid * 2] = x;
  s.currPosition[eid * 2 + 1] = y;
  return eid;
}

/** ETA in days for a launched ship (from its stored route); used by tests and M3. */
export function shipEtaDays(s: Stores, eid: number): number {
  return etaDays(s.shipRoute.distance[eid], s.ship.hull[eid], s.ship.speedSetting[eid]);
}
