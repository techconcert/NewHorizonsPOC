import { addEntity } from 'bitecs';
import { G_ENTITY, G_RNG, MAX_ENTITIES, RNG_ENTITY_BASE } from './components';
import { seedSlot } from './rng';
import type { World } from './world';

/** Allocate a new entity id (ascending, never reused in M1) and seed its RNG slot. */
export function spawnEntity(w: World): number {
  const eid = addEntity(w.ecs);
  if (eid >= MAX_ENTITIES) {
    throw new Error(
      `entity capacity exceeded: id ${eid} >= MAX_ENTITIES ${MAX_ENTITIES} (id recycling is planned for M3)`,
    );
  }
  const s = w.stores;
  if (eid + 1 > s.counts[G_ENTITY]) s.counts[G_ENTITY] = eid + 1;
  s.counts[G_RNG] = RNG_ENTITY_BASE + s.counts[G_ENTITY];
  seedSlot(s.rng, RNG_ENTITY_BASE + eid, w.seed);
  return eid;
}
