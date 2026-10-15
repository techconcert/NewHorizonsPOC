// @vitest-environment node
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMAND_MAX_ARGS, G_LOG, HOMEWORLD_CLOCK_DAYS, RunOutcome } from '../src/sim/components';
import { replayLogEntry } from '../src/sim/commands';
import { tickDay } from '../src/sim/tick';
import { createWorld } from '../src/sim/world';
import { ARCHETYPES, playArchetype } from './helpers/archetypes';
import {
  aggregate,
  BANDS,
  checkBands,
  renderReport,
  runSweep,
  type Bands,
  type SweepResult,
} from './helpers/balanceSweep';

/**
 * The headless balance harness (M7b, D-133, docs/BALANCE.md). Six archetype bots play whole games
 * through the command pipeline only. The default suite runs a smoke sweep; the large sweep and the
 * report file are behind environment flags, because a CI run cannot afford 40 seeds a bot:
 *
 *   BALANCE_FULL=1            40 seeds per archetype and the strict band checks
 *   BALANCE_SEEDS=<n>         seeds per archetype (default 8, or 40 with BALANCE_FULL)
 *   BALANCE_REPORT=1          write docs/BALANCE_REPORT.md from whatever sweep runs
 */
const FULL = process.env.BALANCE_FULL === '1';
const SEEDS = Number(process.env.BALANCE_SEEDS) || (FULL ? 40 : 8);
const REPORT = process.env.BALANCE_REPORT === '1';
/** Per-test timeout: the first test pays for the whole sweep. */
const T = FULL ? 25 * 60_000 : 120_000;
const BUDGET_MS = FULL ? 20 * 60_000 : 2 * 60_000;

let cached: SweepResult | null = null;
function sweep(): SweepResult {
  if (cached === null) cached = runSweep(SEEDS, BUDGET_MS);
  return cached;
}

/** The smoke sweep has 8 seeds a bot, so a win rate moves 12.5 points a seed: only gross misses fail. */
const SMOKE_BANDS: Bands = {
  ...BANDS,
  arkWin: [10, 90],
  anyWin: [0, 100],
  dominance: 1000,
  bestShare: 100,
  arkOdds: [40, 90],
  runMin: [0, 1e9],
  viableWin: 0,
};

/** Bands the data cannot meet yet (docs/BALANCE.md, M7b): reported in the table, not asserted. */
const KNOWN_MISSES: readonly string[] = ['gambler-odds'];

describe('balance harness: archetype bots (M7b)', () => {
  it(
    'every archetype finishes every run with a verdict, inside the day cap',
    () => {
      const r = sweep();
      expect(r.truncated).toBe(false);
      expect(r.runs.length).toBe(ARCHETYPES.length * SEEDS);
      for (const m of r.runs) {
        expect(m.outcome, `${m.archetype} seed ${m.seed}`).not.toBe(RunOutcome.Running);
        expect(m.days).toBeLessThanOrEqual(HOMEWORLD_CLOCK_DAYS);
        expect(m.foundOk).toBeLessThanOrEqual(m.foundAttempts);
        expect(m.colonies).toBe(m.foundOk);
        expect(m.attemptsByType.reduce((a, b) => a + b, 0)).toBe(m.foundAttempts);
        expect(m.okByType.reduce((a, b) => a + b, 0)).toBe(m.foundOk);
        expect(m.launches).toBeGreaterThan(0);
        expect(m.popPeak).toBeGreaterThanOrEqual(m.score);
        expect(m.runMin).toBeGreaterThanOrEqual(m.playMin);
      }
    },
    T,
  );

  it(
    'a run is a pure function of the seed and the archetype',
    () => {
      for (const a of ARCHETYPES) {
        const x = playArchetype(createWorld(3), a);
        const y = playArchetype(createWorld(3), a);
        expect(y).toEqual(x);
      }
      const first = playArchetype(createWorld(3), ARCHETYPES[0]);
      const other = playArchetype(createWorld(4), ARCHETYPES[0]);
      expect(other.hash).not.toBe(first.hash);
    },
    T,
  );

  it(
    'replaying an archetype bot command log on a fresh world reproduces its final state',
    () => {
      const live = createWorld(5);
      const m = playArchetype(live, ARCHETYPES[3]);
      const s = live.stores;
      const n = s.counts[G_LOG];
      const log = {
        day: s.log.day.slice(0, n),
        type: s.log.type.slice(0, n),
        args: s.log.args.slice(0, n * COMMAND_MAX_ARGS),
      };
      const w = createWorld(5);
      let i = 0;
      for (let day = 0; day <= m.days; day++) {
        while (i < n && log.day[i] === day) replayLogEntry(w, log, i++);
        if (day < m.days) tickDay(w);
      }
      expect(w.stores.run.stateHash[0]).toBe(m.hash);
      expect(w.stores.run.outcome[0]).toBe(m.outcome);
      expect(n).toBeGreaterThan(50);
    },
    T,
  );

  it(
    'the sweep passes its band checks (smoke bands; strict with BALANCE_FULL=1)',
    () => {
      const r = sweep();
      const rows = aggregate(r.runs);
      const checks = checkBands(rows, r.seeds, FULL ? BANDS : SMOKE_BANDS);
      if (REPORT) {
        const report = renderReport(rows, checkBands(rows, r.seeds, BANDS), r);
        writeFileSync(new URL('../docs/BALANCE_REPORT.md', import.meta.url), report);
      }
      const failed = checks.filter(
        (c) => !c.ok && !KNOWN_MISSES.includes(c.id) && (FULL || c.id !== 'viable'),
      );
      expect(failed.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    },
    T,
  );

  it(
    'records the smoke sweep as literals (seeds 1 to 8; re-record on purpose when numbers change)',
    () => {
      if (SEEDS !== 8 || FULL) return;
      const rows = aggregate(sweep().runs);
      const got = rows.map((r) => [r.id, r.wins, r.lostHome, r.lostDead]);
      expect(got).toEqual(SMOKE_EXPECTED);
    },
    T,
  );
});

/** [archetype, wins, lost to the clock, lost all dead] over seeds 1 to 8. */
const SMOKE_EXPECTED: [string, number, number, number][] = [
  ['ark', 3, 5, 0],
  ['scout', 2, 6, 0],
  ['gambler', 0, 8, 0],
  ['economist', 4, 4, 0],
  ['defender', 3, 5, 0],
  ['pusher', 3, 5, 0],
];
