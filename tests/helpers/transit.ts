import { FP_SCALE, G_SYSTEM } from '../../src/sim/components';
import { queueEventCard } from '../../src/sim/events';
import { spawnShip, type ShipSpawn } from '../../src/sim/launch';
import { applyCommandsNow, tickDay } from '../../src/sim/tick';
import { createWorld, submit, type World } from '../../src/sim/world';
import type { Command, CommandResult } from '../../src/shared/commands';

/** Grid units per world unit. */
export const U = FP_SCALE;

/** Event card indices in src/data/events.json order. */
export const CARD = {
  Micrometeor: 0,
  Illness: 1,
  EngineFault: 2,
  Derelict: 3,
  Stowaways: 4,
  StrangeSignal: 5,
} as const;

/**
 * A world with a known geometry: systems 0 to 5 on a line, 100 world units apart (system 0 is
 * the homeworld at x = 100, y = 500); every other system is parked far away at y = 900. Hazard of
 * every system is `hazard` (default 0: no random events). Distances between line systems are exact
 * multiples of 25600 grid units.
 */
export function lineWorld(seed = 1, hazard = 0): World {
  const w = createWorld(seed);
  const s = w.stores;
  for (let i = 0; i < s.counts[G_SYSTEM]; i++) {
    if (i <= 5) {
      s.system.x[i] = (100 + 100 * i) * U;
      s.system.y[i] = 500 * U;
    } else {
      s.system.x[i] = 25 * i * U;
      s.system.y[i] = 900 * U;
    }
    s.system.hazard[i] = hazard;
  }
  return w;
}

/** First planet of system `i`. */
export function planetOf(w: World, i: number): number {
  return w.stores.system.planetStart[i];
}

/** Add a ship directly (no stockpile is touched): a Scout, Economy, 60 colonists, 5000 supplies,
 *  4000 fuel, no kit, flying from system 0 to system `dest` (default 1). Returns the entity id. */
export function addShip(w: World, over: Partial<ShipSpawn> & { dest?: number } = {}): number {
  const { dest, ...rest } = over;
  return spawnShip(w, {
    hull: 0,
    speed: 0,
    colonists: 60,
    supplies: 5000,
    fuel: 4000,
    kit: 0,
    security: 0,
    destPlanet: planetOf(w, dest ?? 1),
    originSystem: 0,
    ...rest,
  });
}

export function ticks(w: World, n: number): void {
  for (let i = 0; i < n; i++) tickDay(w);
}

/** Submit a command and apply it at once, like the worker does for card choices and reroutes. */
export function send(w: World, cmd: Command): CommandResult {
  const r = submit(w, cmd);
  if (r.ok) applyCommandsNow(w);
  return r;
}

/** Stage card `card` for ship `e` in the next free pending slot. */
export function stage(w: World, e: number, card: number): void {
  let slot = 0;
  while (w.stores.pendingEventCard.card[slot] >= 0) slot++;
  queueEventCard(w, e, card, slot);
}

/** Answer the card in pending slot `slot` (default the oldest) with `choice`, naming its ship. */
export function resolveSlot(w: World, choice: number, slot = 0): CommandResult {
  const ship = w.stores.pendingEventCard.subject[slot];
  return send(w, { type: 'ResolveEventChoice', card: slot, choice, ship });
}
