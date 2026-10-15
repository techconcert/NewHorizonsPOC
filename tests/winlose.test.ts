// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { G_ENTITY, RunOutcome, ShipStateId } from '../src/sim/components';
import { tickDay } from '../src/sim/tick';
import { offworldColonists } from '../src/sim/winlose';
import { submit } from '../src/sim/world';
import { addColony } from './helpers/colony';
import { addShip, lineWorld, ticks } from './helpers/transit';

const reason = (r: ReturnType<typeof submit>): string => (r.ok ? 'ACCEPTED' : r.reason);

describe('score: colonists alive off-world', () => {
  it('counts other colonies, people on ships (colonists and security) and on expeditions; not the homeworld', () => {
    const w = lineWorld();
    const s = w.stores;
    expect(offworldColonists(s)).toBe(0);
    addColony(w, { population: 1000 });
    addColony(w, { system: 3, population: 500 });
    const ship = addShip(w, { colonists: 60, security: 3 });
    expect(offworldColonists(s)).toBe(1563);
    // A Lost ship's people are gone.
    s.shipState.state[ship] = ShipStateId.Lost;
    expect(offworldColonists(s)).toBe(1500);
    expect(s.counts[G_ENTITY]).toBeGreaterThan(3);
  });
});

describe('score and all-dead with ships parked at home or serving as depots (D-104)', () => {
  it('crew of a ship parked at the homeworld is at home, not off-world', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { dest: 0, colonists: 0, security: 4 });
    s.shipState.state[e] = ShipStateId.Arrived;
    expect(offworldColonists(s)).toBe(0);
    s.shipState.state[e] = ShipStateId.InTransit;
    expect(offworldColonists(s)).toBe(4);
  });

  it('a depot ship in orbit of a colony keeps its remaining crew in the score, without double counting', () => {
    const w = lineWorld();
    const s = w.stores;
    addColony(w, { system: 2, population: 500 });
    const e = addShip(w, { dest: 2, colonists: 0, security: 3 });
    s.shipState.state[e] = ShipStateId.Arrived;
    expect(offworldColonists(s)).toBe(503);
  });

  it('people aboard a ship parked at home still let the homeworld send a party', () => {
    const w = lineWorld();
    const s = w.stores;
    s.colony.population[w.homeColony] = 19;
    const e = addShip(w, { dest: 0, colonists: 0, security: 4 });
    s.shipState.state[e] = ShipStateId.Arrived;
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.Running);
    s.shipManifest.security[e] = 0;
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.LostAllDead);
  });
});

describe('lose: the homeworld collapses', () => {
  it('on the day the clock runs out the run ends, the game stops and commands are refused', () => {
    const w = lineWorld();
    const s = w.stores;
    const c = addColony(w, { population: 700, supplies: 1_000_000 });
    s.run.homeDays[0] = 2;
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.Running);
    tickDay(w);
    expect(s.run.homeDays[0]).toBe(0);
    expect(s.run.outcome[0]).toBe(RunOutcome.LostHomeworld);
    expect(s.run.endDay[0]).toBe(2);
    expect(s.run.speed[0]).toBe(0);
    // Even a loss ranks the colonists who were saved.
    expect(s.run.score[0]).toBe(s.colony.population[c]);
    expect(reason(submit(w, { type: 'SetGameSpeed', speed: 1 }))).toBe('GAME_ENDED');
    expect(reason(submit(w, { type: 'ChooseTech', tech: 0 }))).toBe('GAME_ENDED');
  });

  it('the outcome is fixed: later days do not change it or the score', () => {
    const w = lineWorld();
    const s = w.stores;
    s.run.homeDays[0] = 1;
    tickDay(w);
    const score = s.run.score[0];
    const day = s.run.endDay[0];
    ticks(w, 10);
    expect(s.run.outcome[0]).toBe(RunOutcome.LostHomeworld);
    expect(s.run.endDay[0]).toBe(day);
    expect(s.run.score[0]).toBe(score);
  });

  it('a full 8000-day run with no commands ends in collapse on day 8000 with score 0', () => {
    const w = lineWorld(9);
    ticks(w, 8000);
    expect(w.stores.run.outcome[0]).toBe(RunOutcome.LostHomeworld);
    expect(w.stores.run.endDay[0]).toBe(8000);
    expect(w.stores.run.score[0]).toBe(0);
  });
});

describe('lose: every colonist is dead', () => {
  it('nobody off-world and the homeworld cannot send the smallest party (under 20 people)', () => {
    const w = lineWorld();
    const s = w.stores;
    s.colony.population[w.homeColony] = 19;
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.LostAllDead);
    expect(s.run.score[0]).toBe(0);
  });

  it('is not a loss while a ship, an expedition or a colony still holds colonists', () => {
    const w = lineWorld();
    const s = w.stores;
    s.colony.population[w.homeColony] = 0;
    addShip(w, { colonists: 5 });
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.Running);
  });

  it('is not a loss while the homeworld can still launch', () => {
    const w = lineWorld();
    ticks(w, 50);
    expect(w.stores.run.outcome[0]).toBe(RunOutcome.Running);
  });
});

describe('win: a self-sustaining colony network', () => {
  const network = (n: number, pop = 3000) => {
    const w = lineWorld();
    for (let i = 0; i < n; i++)
      addColony(w, { system: 2 + i, population: pop, supplies: 100_000_000 });
    return w;
  };

  it('ten colonies of 2600+ for 90 days in a row win on the 90th day', () => {
    const w = network(10);
    const s = w.stores;
    ticks(w, 89);
    expect(s.run.winStreak[0]).toBe(89);
    expect(s.run.outcome[0]).toBe(RunOutcome.Running);
    tickDay(w);
    expect(s.run.outcome[0]).toBe(RunOutcome.Won);
    expect(s.run.endDay[0]).toBe(90);
    expect(s.run.score[0]).toBe(10 * 3000);
    expect(s.run.speed[0]).toBe(0);
  });

  it('nine colonies are not enough; a Struggling penalty does not count; a dip resets the streak', () => {
    const two = network(9);
    ticks(two, 100);
    expect(two.stores.run.outcome[0]).toBe(RunOutcome.Running);
    expect(two.stores.run.winStreak[0]).toBe(0);

    const pen = network(10);
    pen.stores.colony.penaltyDays[2] = 200;
    ticks(pen, 100);
    expect(pen.stores.run.outcome[0]).toBe(RunOutcome.Running);

    const dip = network(10);
    ticks(dip, 20);
    expect(dip.stores.run.winStreak[0]).toBe(20);
    dip.stores.colony.population[dip.homeColony + 1] = 1500;
    tickDay(dip);
    expect(dip.stores.run.winStreak[0]).toBe(0);
  });

  it('winning on the day the clock runs out beats the collapse', () => {
    const w = network(10);
    w.stores.run.homeDays[0] = 90;
    ticks(w, 90);
    expect(w.stores.run.homeDays[0]).toBe(0);
    expect(w.stores.run.outcome[0]).toBe(RunOutcome.Won);
  });
});
