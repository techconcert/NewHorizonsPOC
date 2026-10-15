// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import { G_LOG, HOMEWORLD_CLOCK_DAYS } from '../src/sim/components';
import { tickDay, advanceReal, applyCommandsNow, createAccumulator } from '../src/sim/tick';
import { createWorld, submit, type World } from '../src/sim/world';

const GOLDEN_SEED42_DAY100 = 2299795016; // M7c re-record (D-136, SIM_VERSION 5): clock 8000, win 10 colonies; earlier: M7a re-record (D-132, SIM_VERSION 3): 30 cards, native variants, find tables; earlier: M5 review 2 (D-107 to D-111, SIM_VERSION 2): new flow stores, balance retune; earlier: M5 (D-098), review fixes (D-101 to D-106)

function runDays(w: World, days: number): number {
  for (let i = 0; i < days; i++) tickDay(w);
  return w.stores.run.stateHash[0] as number;
}

describe('determinism', () => {
  it('same seed, no commands: same hash after the whole 8000-day clock (run twice)', () => {
    const a = createWorld(42);
    const b = createWorld(42);
    const ha = runDays(a, HOMEWORLD_CLOCK_DAYS);
    const hb = runDays(b, HOMEWORLD_CLOCK_DAYS);
    expect(ha).toBe(hb);
    expect(a.stores.run.day[0]).toBe(HOMEWORLD_CLOCK_DAYS);
    expect(a.stores.run.homeDays[0]).toBe(0);
  });

  it('different seeds give different hashes', () => {
    const hashes = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5]) hashes.add(runDays(createWorld(seed), 100));
    expect(hashes.size).toBe(5);
  });

  it('the hash changes as days pass', () => {
    const w = createWorld(9);
    const h0 = w.stores.run.stateHash[0];
    expect(runDays(w, 1)).not.toBe(h0);
  });
});

describe('replay', () => {
  it('a scripted command list replays from the log to the same hash at checkpoints', () => {
    const script: Record<number, 0 | 1 | 2 | 4> = { 10: 4, 250: 0, 251: 2, 900: 1, 3000: 4 };
    const checkpoints = [0, 100, 500, 1000, 2000, 4000, 5000];
    const live = createWorld(777);
    const liveHashes: number[] = [];
    for (let day = 0; day <= 5000; day++) {
      if (checkpoints.includes(day)) liveHashes.push(live.stores.run.stateHash[0] as number);
      const sp = script[day];
      if (sp !== undefined) expect(submit(live, { type: 'SetGameSpeed', speed: sp }).ok).toBe(true);
      if (day < 5000) tickDay(live);
    }
    expect(live.stores.counts[G_LOG]).toBe(5);

    // Replay from seed + log only.
    const replay = createWorld(777);
    const replayHashes: number[] = [];
    let next = 0;
    const logCount = live.stores.counts[G_LOG] as number;
    for (let day = 0; day <= 5000; day++) {
      if (checkpoints.includes(day)) replayHashes.push(replay.stores.run.stateHash[0] as number);
      while (next < logCount && live.stores.log.day[next] === day) {
        expect(submit(replay, getLoggedCommand(live.stores, next)).ok).toBe(true);
        next++;
      }
      if (day < 5000) tickDay(replay);
    }
    expect(replayHashes).toEqual(liveHashes);
    expect(replay.stores.run.speed[0]).toBe(live.stores.run.speed[0]);
  });

  it('SetGameSpeed changes the hash (speed is part of state)', () => {
    const a = createWorld(5);
    const b = createWorld(5);
    submit(b, { type: 'SetGameSpeed', speed: 4 });
    tickDay(a);
    tickDay(b);
    expect(a.stores.run.stateHash[0]).not.toBe(b.stores.run.stateHash[0]);
  });
});

describe('fixed-step accumulator', () => {
  it('converts real ms into whole days at 1x, 2x, 4x and pauses at 0', () => {
    const w = createWorld(3);
    const acc = createAccumulator();
    expect(advanceReal(w, acc, 1500)).toBe(1); // 1x: 1.5 s -> 1 day, 500 ms carried
    expect(advanceReal(w, acc, 500)).toBe(1);
    submit(w, { type: 'SetGameSpeed', speed: 2 });
    applyCommandsNow(w);
    expect(advanceReal(w, acc, 1000)).toBe(2);
    submit(w, { type: 'SetGameSpeed', speed: 4 });
    applyCommandsNow(w);
    expect(advanceReal(w, acc, 1000)).toBe(4);
    submit(w, { type: 'SetGameSpeed', speed: 0 });
    applyCommandsNow(w);
    const day = w.stores.run.day[0];
    expect(advanceReal(w, acc, 10000)).toBe(0);
    expect(w.stores.run.day[0]).toBe(day);
  });

  it('caps catch-up after a long stall', () => {
    const w = createWorld(3);
    expect(advanceReal(w, createAccumulator(), 60000)).toBe(8);
  });
});

describe('paused commands', () => {
  it('commands apply while paused via applyCommandsNow and replay to the same hash', () => {
    const live = createWorld(2026);
    const acc = createAccumulator();
    runDays(live, 10);
    submit(live, { type: 'SetGameSpeed', speed: 0 });
    applyCommandsNow(live);
    expect(live.stores.run.speed[0]).toBe(0);
    expect(live.stores.run.day[0]).toBe(10);
    expect(advanceReal(live, acc, 5000)).toBe(0);

    // Paused: resume through the accumulator path alone, no manual tick.
    expect(submit(live, { type: 'SetGameSpeed', speed: 1 }).ok).toBe(true);
    expect(advanceReal(live, acc, 16)).toBe(0); // drains the queue while paused
    expect(live.stores.run.speed[0]).toBe(1);
    expect(live.stores.run.day[0]).toBe(10);
    // Pause and resume on the same day collapse into one entry holding the last speed (D-108).
    expect(live.stores.counts[G_LOG]).toBe(1);
    expect(live.stores.log.day[0]).toBe(10);
    const hLive = runDays(live, 20);

    const replay = createWorld(2026);
    runDays(replay, 10);
    for (let i = 0; i < live.stores.counts[G_LOG]; i++) replayLogged(replay, live.stores, i);
    const hReplay = runDays(replay, 20);
    expect(hReplay).toBe(hLive);
    expect(replay.stores.run.speed[0]).toBe(1);
  });
});

describe('golden hash', () => {
  it('seed 42 at day 100 matches the recorded hash', () => {
    // Changing this value means the simulation state layout or rules changed: review on purpose.
    expect(runDays(createWorld(42), 100)).toBe(GOLDEN_SEED42_DAY100);
  });
});
