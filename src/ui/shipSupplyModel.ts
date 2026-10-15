import { PF, supplyFactorPct } from '../shared/planetfall';
import {
  EXPEDITION_STRIDE,
  X_LANDED,
  X_LANDED_SUPPLIES,
  X_STATUS,
  type Snapshot,
} from '../shared/snapshot';
import { isLiveStatus } from '../shared/planetfall';

/**
 * The ship in orbit keeps feeding all its colonists every day while the expedition explores, and
 * the founding supplies factor is measured against what is left at founding. This view says how
 * long the ship's food lasts and what that does to the factor, so the cost of waiting is visible.
 */
export interface ShipSupplyView {
  supplies: number;
  colonists: number;
  /** Whole days of food left for the colonists aboard. */
  days: number;
  /** The founding supplies factor with what is left now. */
  factorPct: number;
  text: string;
  /** Plain warning when the food left is under the reserve days founding needs, else ''. */
  warning: string;
}

/** Null when the ship is gone or the expedition is not live. */
export function buildShipSupplyView(
  snap: Snapshot,
  shipRow: number,
  expRow: number,
): ShipSupplyView | null {
  if (shipRow < 0 || expRow < 0) return null;
  const o = expRow * EXPEDITION_STRIDE;
  if (!isLiveStatus(snap.expeditions[o + X_STATUS])) return null;
  const supplies = snap.shipSupplies[shipRow];
  const colonists = snap.shipColonists[shipRow];
  const days = colonists > 0 ? Math.floor(supplies / colonists) : 999;
  const factorPct = supplyFactorPct(
    snap.expeditions[o + X_LANDED_SUPPLIES],
    snap.expeditions[o + X_LANDED],
  );
  const reserve = PF.founding.reserveDays;
  const text = `Ship supplies: ${supplies}, enough for ${days} more days (about ${factorPct}% of the founding supplies factor)`;
  const warning =
    days < reserve
      ? `WARNING: the ship feeds ${colonists} colonists every day. ${days} days of food is under the ${reserve} reserve days founding needs, so the supplies factor is already ${factorPct}% and falls with every day on the ground. Found soon.`
      : '';
  return { supplies, colonists, days, factorPct, text, warning };
}
