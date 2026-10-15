// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COMMAND_MAX_ARGS, G_LOG, RunOutcome } from '../src/sim/components';
import { replayLogEntry } from '../src/sim/commands';
import { createSave, loadSave } from '../src/sim/save';
import { tickDay } from '../src/sim/tick';
import { createWorld } from '../src/sim/world';
import { newBotStats, playBot } from './helpers/bot';

const MAX_DAYS = 9000;

describe('scripted bot plays whole games', () => {
  it('plays seed 42 to an end state without crashing', () => {
    const w = createWorld(42);
    const r = playBot(w, newBotStats(), MAX_DAYS);
    // Literal record of this bot game (placeholder balance: re-record on purpose when numbers change;
    // re-recorded for the M5 review fixes, D-101 to D-106: both colonies now fill their housing).
    expect(r.outcome).toBe(RunOutcome.LostHomeworld);
    expect(r.days).toBe(8000);
    expect(r.hash).toBe(1579581326); // M7c re-record (D-136: clock 8000, win rule 10 / 2600 / 90)
    expect(r.score).toBe(6600);
    expect(r.colonies).toBe(3);
    expect(r.topPops).toEqual([2200, 2200, 2200]);
    expect(r.stats).toMatchObject({
      launches: 25,
      expeditions: 29,
      districts: 21,
      techsChosen: 10,
      cards: 16,
    });
  });

  it('is deterministic: the same seed gives the same hash, score and day', () => {
    const a = playBot(createWorld(7), newBotStats(), MAX_DAYS);
    const b = playBot(createWorld(7), newBotStats(), MAX_DAYS);
    expect(a.outcome).not.toBe(RunOutcome.Running);
    expect(b).toEqual(a);
  });

  it('different seeds play different games', () => {
    const a = playBot(createWorld(1), newBotStats(), MAX_DAYS);
    const b = playBot(createWorld(2), newBotStats(), MAX_DAYS);
    expect(a.hash).not.toBe(b.hash);
  });

  it('replaying the bot command log on a fresh world reproduces the final hash', () => {
    const live = createWorld(11);
    const r = playBot(live, newBotStats(), MAX_DAYS);
    const s = live.stores;
    const n = s.counts[G_LOG];
    const log = {
      day: s.log.day.slice(0, n),
      type: s.log.type.slice(0, n),
      args: s.log.args.slice(0, n * COMMAND_MAX_ARGS),
    };
    const w = createWorld(11);
    let i = 0;
    for (let day = 0; day <= r.days; day++) {
      while (i < n && log.day[i] === day) replayLogEntry(w, log, i++);
      if (day < r.days) tickDay(w);
    }
    expect(w.stores.run.stateHash[0]).toBe(r.hash);
    expect(w.stores.run.outcome[0]).toBe(r.outcome);
  });

  it('save in the middle of a bot game, load, and finish: same end as the uninterrupted run', () => {
    const full = playBot(createWorld(5), newBotStats(), MAX_DAYS);
    const a = createWorld(5);
    const statsA = newBotStats();
    playBot(a, statsA, MAX_DAYS, 800);
    expect(a.stores.run.day[0]).toBe(800);
    const b = loadSave(structuredClone(createSave(a)));
    expect(b.stores.run.stateHash[0]).toBe(a.stores.run.stateHash[0]);
    const rest = playBot(b, statsA, MAX_DAYS);
    expect(rest.hash).toBe(full.hash);
    expect(rest.days).toBe(full.days);
    expect(rest.outcome).toBe(full.outcome);
  });
});
