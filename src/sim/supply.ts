import { TRANSIT } from '../data';
import { ceilDiv } from '../shared/loadout';
import { G_ENTITY, LostReason, ShipStateId } from './components';
import { loseShip } from './ships';
import type { World } from './world';

/**
 * SupplySystem (step 4): every colonist eats 1 supply per day. When the supplies cannot feed
 * everyone, the unfed lose `starvationPctPerDay` percent of their number per day (rounded up, so
 * the last colonists do not linger), colonists never go below 0, and a ship with nobody left is
 * Lost (AllDead). Covers ships flying, drifting and every ship in orbit at a planet (Arrived), parked or
 * serving as an expedition's depot, so the colonists left aboard eat and starve like any others. D-050, D-080.
 */
export function supplySystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const state = s.shipState.state;
  const man = s.shipManifest;
  const pct = TRANSIT.starvationPctPerDay;
  for (let e = 0; e < n; e++) {
    const st = state[e];
    if (
      st !== ShipStateId.InTransit &&
      st !== ShipStateId.Drifting &&
      st !== ShipStateId.InOrbit &&
      st !== ShipStateId.Arrived
    )
      continue;
    const colonists = man.colonists[e];
    if (colonists <= 0) continue;
    const supplies = man.supplies[e];
    if (supplies >= colonists) {
      man.supplies[e] = supplies - colonists;
      continue;
    }
    const unfed = colonists - supplies;
    man.supplies[e] = 0;
    let left = colonists - ceilDiv(unfed * pct, 100);
    if (left < 0) left = 0;
    man.colonists[e] = left;
    if (left === 0) loseShip(w, e, LostReason.AllDead);
  }
}
