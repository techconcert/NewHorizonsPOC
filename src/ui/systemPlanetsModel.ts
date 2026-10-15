import { META_SYSTEM_COUNT, C_POPULATION, COLONY_STRIDE, type Snapshot } from '../shared/snapshot';
import {
  colonyRowOfPlanet,
  liveExpeditionRowOfShip,
  parkedShipRowAt,
} from '../shared/planetSnapshot';
import { colonyTierText } from './colonyModel';
import { surveyLabel } from './missionModel';
import { canLand } from './planetSession';

/** Rows of the "Planets" panel for the selected star: one per planet, with a Land button when it can open. */

export interface PlanetRowView {
  planet: number;
  slot: number;
  label: string;
  status: string;
  canLand: boolean;
}

/** Rows for `system` (empty when it does not exist). Allocates; call when the system or the data changed. */
export function buildPlanetRows(snap: Snapshot, system: number): PlanetRowView[] {
  const rows: PlanetRowView[] = [];
  if (system < 0 || system >= snap.meta[META_SYSTEM_COUNT]) return rows;
  const start = snap.systemPlanetStart[system];
  const n = snap.planetCount[system];
  for (let slot = 0; slot < n; slot++) {
    const p = start + slot;
    const parked = parkedShipRowAt(snap, p);
    const parts: string[] = [];
    const colony = colonyRowOfPlanet(snap, p);
    if (colony >= 0) {
      parts.push(
        `Colony: ${colonyTierText(snap, colony)}, population ${snap.colonies[colony * COLONY_STRIDE + C_POPULATION]}`,
      );
    }
    if (parked >= 0) {
      const live = liveExpeditionRowOfShip(snap, snap.shipEntity[parked]) >= 0;
      parts.push(live ? 'Expedition on the ground' : 'Ship waiting in orbit');
    }
    rows.push({
      planet: p,
      slot,
      label: `Planet ${slot + 1}: ${surveyLabel(snap.planetSurvey[p])}, habitability ${snap.planetHabLo[p]} to ${snap.planetHabHi[p]}%`,
      status: parts.join('. '),
      canLand: canLand(snap, p),
    });
  }
  return rows;
}
