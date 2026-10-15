import { TRANSIT } from '../data';
import { burnRateX10000, FUEL_FRAC_UNIT, speedFpPerDay } from '../shared/loadout';
import { TE, techBonus } from '../shared/research';
import { G_ENTITY, LostReason, ShipStateId } from './components';
import { loseShip, writeCurrPosition } from './ships';
import type { World } from './world';

/**
 * TravelSystem (ARCHITECTURE section 7, step 3). Ships in state InTransit move along their leg in
 * fixed-point grid units: hull base speed x speed multiplier per day (LoadoutMath.speedFpPerDay),
 * burning fuel per distance (burnRateX10000, an exact integer accumulator in fuelFrac). A ship
 * that cannot pay for the day's move flies as far as its fuel allows and then Drifts; a drifting
 * ship is Lost after `driftDaysToLost` days. Ascending entity ids, no allocation. D-049.
 */
export function travelSystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const state = s.shipState.state;
  const route = s.shipRoute;
  const day = s.run.day[0];
  const prev = s.prevPosition;
  const curr = s.currPosition;
  for (let e = 0; e < n; e++) {
    const st = state[e];
    if (st === ShipStateId.None) continue;
    // Interpolation start: where the ship was at the end of the previous day.
    prev[e * 2] = curr[e * 2];
    prev[e * 2 + 1] = curr[e * 2 + 1];
    if (st === ShipStateId.InTransit) {
      if (route.delay[e] > 0) {
        route.delay[e] = route.delay[e] - 1;
        continue;
      }
      moveShip(w, e, day);
    } else if (st === ShipStateId.Drifting) {
      const d = route.drift[e] + 1;
      route.drift[e] = d;
      if (d >= TRANSIT.driftDaysToLost) loseShip(w, e, LostReason.OutOfFuel);
    }
  }
}

function moveShip(w: World, e: number, day: number): void {
  const s = w.stores;
  const route = s.shipRoute;
  const man = s.shipManifest;
  const speed = s.ship.speedSetting[e];
  const distance = route.distance[e];
  let step = speedFpPerDay(s.ship.hull[e], speed);
  const remaining = distance - route.progress[e];
  if (step > remaining) step = remaining;

  // Ion Drive and kin: a percent cut of the fuel burn (the UI's range and reroute previews ignore it, so they never over-promise).
  let burn = burnRateX10000(speed);
  const cut = techBonus(s.research.mask[0], TE.BurnCut);
  if (cut > 0) {
    burn = Math.floor((burn * (100 - cut)) / 100);
    if (burn < 1) burn = 1;
  }
  const frac = route.fuelFrac[e];
  let budget = man.fuel[e] * FUEL_FRAC_UNIT - frac;
  if (budget < 0) budget = 0;
  let dry = false;
  if (step * burn > budget) {
    step = Math.floor(budget / burn);
    dry = true;
  }
  const num = frac + step * burn;
  const units = Math.floor(num / FUEL_FRAC_UNIT);
  route.progress[e] = route.progress[e] + step;

  if (dry) {
    // The tank is empty: what is left is less than one grid unit of travel.
    man.fuel[e] = 0;
    route.fuelFrac[e] = 0;
    route.drift[e] = 0;
    s.shipState.state[e] = ShipStateId.Drifting;
    writeCurrPosition(w, e);
    return;
  }
  man.fuel[e] = man.fuel[e] - units;
  route.fuelFrac[e] = num - units * FUEL_FRAC_UNIT;
  writeCurrPosition(w, e);
  if (route.progress[e] >= distance) arrive(w, e, day);
}

/**
 * The ship reached its target system. It becomes Arrived (planetfall is M4). When an own colony
 * holds the planet, colonists, supplies and fuel move to that colony's stockpile (D-053).
 */
function arrive(w: World, e: number, day: number): void {
  const s = w.stores;
  s.shipState.state[e] = ShipStateId.Arrived;
  s.shipLog.arrivedDay[e] = day;
  const colony = s.planet.owner[s.shipRoute.destPlanet[e]];
  if (colony < 0) return;
  const man = s.shipManifest;
  s.colony.population[colony] += man.colonists[e];
  s.stockpile.supplies[colony] += man.supplies[e];
  s.stockpile.fuel[colony] += man.fuel[e];
  man.colonists[e] = 0;
  man.supplies[e] = 0;
  man.fuel[e] = 0;
  s.shipRoute.fuelFrac[e] = 0;
}
