import { createWorld as createEcsWorld } from 'bitecs';
import type { Command, CommandResult } from '../shared/commands';
import { createCommandQueue, submitCommand, type CommandQueue } from './commands';
import {
  createStores,
  HOMEWORLD_CLOCK_DAYS,
  RNG_GAME,
  RunOutcome,
  type Stores,
} from './components';
import { compileContent, type Content } from './content';
import { spawnEntity } from './entities';
import { findHomeworld, generateGalaxy } from './galaxy';
import { hashGalaxy, hashState } from './hash';
import { seedSlot } from './rng';

/** Placeholder starting values for the homeworld (see docs/BALANCE.md). */
export const HOME_START_POPULATION = 100000;
export const HOME_START_SUPPLIES = 500000;
export const HOME_START_FUEL = 20000;
export const HOME_START_PRODUCTION = 5000;

export interface World {
  seed: number;
  /** bitecs world: allocates entity ids; component data lives in `stores` typed arrays. */
  ecs: ReturnType<typeof createEcsWorld>;
  content: Content;
  stores: Stores;
  queue: CommandQueue;
  /** Entity id of colony 0, the homeworld. */
  homeColony: number;
  homePlanet: number;
}

export { spawnEntity };

export function createWorld(seed: number): World {
  const s32 = seed >>> 0;
  const stores = createStores();
  const content = compileContent();
  const ecs = createEcsWorld();
  const w: World = {
    seed: s32,
    ecs,
    content,
    stores,
    queue: createCommandQueue(),
    homeColony: -1,
    homePlanet: -1,
  };

  stores.run.seed[0] = s32;
  stores.run.speed[0] = 1;
  stores.run.homeDays[0] = HOMEWORLD_CLOCK_DAYS;
  stores.run.outcome[0] = RunOutcome.Running;
  seedSlot(stores.rng, RNG_GAME, s32);

  generateGalaxy(stores, content, s32);
  w.homePlanet = findHomeworld(stores);

  // Homeworld as colony 0.
  const eid = spawnEntity(w);
  w.homeColony = eid;
  stores.run.homeColony[0] = eid;
  stores.colony.planet[eid] = w.homePlanet;
  stores.colony.population[eid] = HOME_START_POPULATION;
  stores.colony.spaceport[eid] = 1;
  stores.colony.tier[eid] = 2; // the homeworld counts as Thriving
  stores.stockpile.supplies[eid] = HOME_START_SUPPLIES;
  stores.stockpile.fuel[eid] = HOME_START_FUEL;
  stores.stockpile.production[eid] = HOME_START_PRODUCTION;
  stores.planet.owner[w.homePlanet] = eid;

  stores.run.galaxyHash[0] = hashGalaxy(stores);
  hashState(stores);
  return w;
}

export function submit(w: World, cmd: Command | unknown): CommandResult {
  return submitCommand(w, cmd);
}
