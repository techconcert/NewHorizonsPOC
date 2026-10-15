import { FOUND_TIER_NAMES, FoundTier } from '../shared/planetfall';
import {
  C_POPULATION,
  CD_PENALTY_DAYS,
  CD_TIER,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  META_COLONY_COUNT,
  type Snapshot,
} from '../shared/snapshot';

/**
 * Colony facts for the HUD and the galaxy view (pure). Colony row 0 is the homeworld (the first
 * entity the world creates); every other row is a colony founded by an expedition.
 */

export interface ColonySummary {
  /** Colonies founded off the homeworld. */
  count: number;
  /** Population living in them. */
  population: number;
  struggling: number;
  text: string;
}

export function colonySummary(snap: Snapshot): ColonySummary {
  const n = snap.meta[META_COLONY_COUNT];
  let count = 0;
  let population = 0;
  let struggling = 0;
  for (let i = 1; i < n; i++) {
    count++;
    population += snap.colonies[i * COLONY_STRIDE + C_POPULATION];
    if (snap.colonyDetail[i * COLONY_DETAIL_STRIDE + CD_TIER] === FoundTier.Struggling)
      struggling++;
  }
  const text =
    count === 0
      ? 'Colonies: none yet'
      : `Colonies: ${count}, population ${population}${struggling > 0 ? ` (${struggling} struggling)` : ''}`;
  return { count, population, struggling, text };
}

/** "Thriving" / "Struggling" with the penalty days left, for a colony detail row. */
export function colonyTierText(snap: Snapshot, row: number): string {
  const tier = snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_TIER];
  const days = snap.colonyDetail[row * COLONY_DETAIL_STRIDE + CD_PENALTY_DAYS];
  const name = FOUND_TIER_NAMES[tier] ?? '?';
  return days > 0 ? `${name}, ${days} penalty days left` : name;
}
