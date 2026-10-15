import { createWorld } from '../../src/sim/world';
import { RunOutcome } from '../../src/sim/components';
import {
  ARCHETYPES,
  PLANET_TYPES,
  playArchetype,
  type Archetype,
  type RunMetrics,
} from './archetypes';

/**
 * Sweep, aggregate and band checks of the headless balance harness (M7b, D-133). Pure functions
 * over `RunMetrics`: the vitest file and the report writer use the same code, so the table in
 * docs/BALANCE_REPORT.md is exactly what the assertions see.
 */

export interface SweepResult {
  runs: RunMetrics[];
  seeds: number;
  /** True when the time budget stopped the sweep before all seeds ran. */
  truncated: boolean;
  elapsedMs: number;
}

/** Run every archetype on seeds 1..`seeds`. The budget (ms) is checked between seeds, so a seed is always complete for every archetype. */
export function runSweep(
  seeds: number,
  budgetMs: number,
  archetypes: readonly Archetype[] = ARCHETYPES,
  firstSeed = 1,
): SweepResult {
  const runs: RunMetrics[] = [];
  const t0 = Date.now();
  let done = 0;
  let truncated = false;
  for (let i = 0; i < seeds; i++) {
    if (i > 0 && Date.now() - t0 > budgetMs) {
      truncated = true;
      break;
    }
    for (const a of archetypes) runs.push(playArchetype(createWorld(firstSeed + i), a));
    done++;
  }
  return { runs, seeds: done, truncated, elapsedMs: Date.now() - t0 };
}

export interface Row {
  id: string;
  name: string;
  n: number;
  wins: number;
  lostHome: number;
  lostDead: number;
  timeouts: number;
  winRate: number;
  medianDay: number;
  medianWinDay: number;
  colonies: number;
  foundShare: number;
  avgOdds: number;
  highShare: number;
  firstShare: number;
  firstTries: number;
  highAttempts: number;
  popPeak: number;
  peakSustain: number;
  shipsLost: number;
  lossRate: number;
  launches: number;
  cards: number;
  score: number;
  runMin: number;
  playMin: number;
  minAt1x: number;
  /** Founding attempts, successes and wins (by the type of the first colony) per planet type. */
  attemptsByType: number[];
  okByType: number[];
  runsByType: number[];
  winsByType: number[];
  bestSeeds: number;
}

function median(v: number[]): number {
  if (v.length === 0) return 0;
  const a = [...v].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}
function mean(v: number[]): number {
  return v.length === 0 ? 0 : v.reduce((x, y) => x + y, 0) / v.length;
}
const pct = (a: number, b: number): number => (b === 0 ? 0 : (100 * a) / b);

export function aggregate(
  runs: readonly RunMetrics[],
  archetypes: readonly Archetype[] = ARCHETYPES,
): Row[] {
  const rows: Row[] = archetypes.map((a) => {
    const r = runs.filter((x) => x.archetype === a.id);
    const wins = r.filter((x) => x.outcome === RunOutcome.Won);
    const att = r.reduce((x, y) => x + y.foundAttempts, 0);
    const ok = r.reduce((x, y) => x + y.foundOk, 0);
    const attH = r.reduce((x, y) => x + y.attemptsHigh, 0);
    const okH = r.reduce((x, y) => x + y.okHigh, 0);
    const launches = r.reduce((x, y) => x + y.launches, 0);
    const lost = r.reduce((x, y) => x + y.shipsLost, 0);
    const by = (f: (m: RunMetrics) => number[]): number[] =>
      Array.from({ length: PLANET_TYPES }, (_, t) => r.reduce((x, y) => x + f(y)[t], 0));
    const runsByType = new Array<number>(PLANET_TYPES).fill(0);
    const winsByType = new Array<number>(PLANET_TYPES).fill(0);
    for (const m of r) {
      if (m.firstType >= 0) {
        runsByType[m.firstType]++;
        if (m.outcome === RunOutcome.Won) winsByType[m.firstType]++;
      }
    }
    return {
      id: a.id,
      name: a.name,
      n: r.length,
      wins: wins.length,
      lostHome: r.filter((x) => x.outcome === RunOutcome.LostHomeworld).length,
      lostDead: r.filter((x) => x.outcome === RunOutcome.LostAllDead).length,
      timeouts: r.filter((x) => x.outcome === RunOutcome.Running).length,
      winRate: pct(wins.length, r.length),
      medianDay: median(r.map((x) => x.days)),
      medianWinDay: median(wins.map((x) => x.days)),
      colonies: mean(r.map((x) => x.colonies)),
      foundShare: pct(ok, att),
      avgOdds: att === 0 ? 0 : r.reduce((x, y) => x + y.chanceSum, 0) / att,
      highShare: pct(okH, attH),
      firstShare: pct(
        r.reduce((x, y) => x + y.firstOk, 0),
        r.reduce((x, y) => x + y.firstTries, 0),
      ),
      firstTries: r.reduce((x, y) => x + y.firstTries, 0),
      highAttempts: attH,
      popPeak: mean(r.map((x) => x.popPeak)),
      peakSustain: mean(r.map((x) => x.peakSustain)),
      shipsLost: mean(r.map((x) => x.shipsLost)),
      lossRate: pct(lost, launches),
      launches: mean(r.map((x) => x.launches)),
      cards: mean(r.map((x) => x.cards)),
      score: mean(r.map((x) => x.score)),
      runMin: median(r.map((x) => x.runMin)),
      playMin: median(r.map((x) => x.playMin)),
      minAt1x: median(r.map((x) => x.minAt1x)),
      attemptsByType: by((m) => m.attemptsByType),
      okByType: by((m) => m.okByType),
      runsByType,
      winsByType,
      bestSeeds: 0,
    };
  });
  // Best-scoring archetype per seed (ties share the seed).
  const seeds = [...new Set(runs.map((x) => x.seed))];
  for (const seed of seeds) {
    const here = runs.filter((x) => x.seed === seed);
    // A win beats any loss; then the colonists alive off-world (the score) decide.
    const key = (x: RunMetrics): number => (x.outcome === RunOutcome.Won ? 1e9 : 0) + x.score;
    const top = Math.max(...here.map(key));
    if (top <= 0) continue;
    const best = here.filter((x) => key(x) === top);
    for (const b of best) {
      const row = rows.find((x) => x.id === b.archetype);
      if (row) row.bestSeeds += 1 / best.length;
    }
  }
  return rows;
}

export interface Check {
  id: string;
  ok: boolean;
  detail: string;
}

export interface Bands {
  /** Win rate band (percent) for the competent baseline (the Ark) and the outer limits for the rest. */
  arkWin: [number, number];
  anyWin: [number, number];
  /** Best win rate over the second best. */
  dominance: number;
  /** Largest share (percent) of seeds one archetype may score best on. */
  bestShare: number;
  arkOdds: [number, number];
  /** Gambler first-roll founding success (BALANCE.md: 25 to 45 percent on an Unknown planet). */
  gamblerOdds: [number, number];
  runMin: [number, number];
  /** Founding success share (percent) a planet type needs, with at least `viableRuns` runs, to count as viable. */
  viableWin: number;
  viableRuns: number;
}

export const BANDS: Bands = {
  arkWin: [30, 60],
  anyWin: [10, 75],
  dominance: 2,
  bestShare: 40,
  arkOdds: [60, 75],
  gamblerOdds: [25, 45],
  runMin: [90, 150],
  viableWin: 25,
  viableRuns: 4,
};

/** Band checks over a sweep (docs/BALANCE.md target bands). */
export function checkBands(rows: readonly Row[], seeds: number, b: Bands = BANDS): Check[] {
  const out: Check[] = [];
  const ark = rows.find((r) => r.id === 'ark');
  if (ark) {
    out.push({
      id: 'ark-win',
      ok: ark.winRate >= b.arkWin[0] && ark.winRate <= b.arkWin[1],
      detail: `Ark win rate ${ark.winRate.toFixed(0)}% (band ${b.arkWin[0]}-${b.arkWin[1]}%)`,
    });
    out.push({
      id: 'ark-odds',
      ok: ark.highShare >= b.arkOdds[0] && ark.highShare <= b.arkOdds[1],
      detail: `Ark founding success at habitability 70+ ${ark.highShare.toFixed(0)}% over ${ark.highAttempts} tries (band ${b.arkOdds[0]}-${b.arkOdds[1]}%)`,
    });
    out.push({
      id: 'run-length',
      ok: ark.runMin >= b.runMin[0] && ark.runMin <= b.runMin[1],
      detail: `Ark median run ${ark.runMin.toFixed(0)} min with decisions (${ark.playMin.toFixed(0)} min playing; ${ark.minAt1x.toFixed(0)} min at 1x), band ${b.runMin[0]}-${b.runMin[1]}`,
    });
  }
  const gambler = rows.find((r) => r.id === 'gambler');
  if (gambler) {
    out.push({
      id: 'gambler-odds',
      ok: gambler.firstShare >= b.gamblerOdds[0] && gambler.firstShare <= b.gamblerOdds[1],
      detail: `Gambler first-roll founding success ${gambler.firstShare.toFixed(0)}% over ${gambler.firstTries} ships (band ${b.gamblerOdds[0]}-${b.gamblerOdds[1]}%)`,
    });
  }
  const bad = rows.filter((r) => r.winRate < b.anyWin[0] || r.winRate > b.anyWin[1]);
  out.push({
    id: 'every-win',
    ok: bad.length === 0,
    detail:
      bad.length === 0
        ? `every archetype wins ${b.anyWin[0]}-${b.anyWin[1]}%`
        : `outside ${b.anyWin[0]}-${b.anyWin[1]}%: ${bad.map((r) => `${r.id} ${r.winRate.toFixed(0)}%`).join(', ')}`,
  });
  const sorted = [...rows].sort((x, y) => y.winRate - x.winRate);
  const top = sorted[0];
  const second = sorted[1];
  out.push({
    id: 'dominance',
    ok: top !== undefined && second !== undefined && top.winRate <= b.dominance * second.winRate,
    detail: `best ${top?.id} ${top?.winRate.toFixed(0)}% vs next ${second?.id} ${second?.winRate.toFixed(0)}% (limit x${b.dominance})`,
  });
  const share = [...rows].sort((x, y) => y.bestSeeds - x.bestSeeds)[0];
  out.push({
    id: 'best-share',
    ok: share !== undefined && pct(share.bestSeeds, seeds) <= b.bestShare,
    detail: `${share?.id} is the best score on ${pct(share?.bestSeeds ?? 0, seeds).toFixed(0)}% of seeds (limit ${b.bestShare}%)`,
  });
  const notViable = rows.filter(
    (r) =>
      !r.runsByType.some((n, t) => n >= b.viableRuns && pct(r.winsByType[t], n) >= b.viableWin),
  );
  out.push({
    id: 'viable',
    ok: notViable.length === 0,
    detail:
      notViable.length === 0
        ? `every archetype wins at least ${b.viableWin}% on some planet type (first colony, ${b.viableRuns}+ runs)`
        : `no planet type reaches ${b.viableWin}% wins for: ${notViable.map((r) => r.id).join(', ')}`,
  });
  return out;
}

const TYPE_NAMES = ['Temperate', 'Arid', 'Jungle', 'Frozen', 'Barren', 'Ancient'];

/** Markdown of the report: the archetype table, the planet type table and the band checks. */
export function renderReport(
  rows: readonly Row[],
  checks: readonly Check[],
  sweep: SweepResult,
): string {
  const f0 = (v: number): string => v.toFixed(0);
  const f1 = (v: number): string => v.toFixed(1);
  const lines: string[] = [];
  lines.push('# Balance report');
  lines.push('');
  lines.push(
    `Generated by tests/balanceHarness.test.ts (M7b, D-133): ${sweep.seeds} seeds per archetype (seeds 1..${sweep.seeds}), ${sweep.runs.length} runs${sweep.truncated ? ', stopped early by the time budget' : ''}. Integer sim only, commands only. Do not edit by hand: run the sweep with BALANCE_REPORT=1.`,
  );
  lines.push('');
  lines.push('## Archetype by metric');
  lines.push('');
  lines.push(
    '| Archetype | Win % | Lost clock | Lost dead | Median day | Median win day | Colonies | Found % | Avg odds % | Peak pop | Ships lost | Loss % of launches | Cards | Score | Run min | Play min | Min at 1x | Best on % seeds |',
  );
  lines.push(
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${f0(r.winRate)} | ${r.lostHome} | ${r.lostDead} | ${f0(r.medianDay)} | ${f0(r.medianWinDay)} | ${f1(r.colonies)} | ${f0(r.foundShare)} | ${f0(r.avgOdds)} | ${f0(r.popPeak)} | ${f1(r.shipsLost)} | ${f0(r.lossRate)} | ${f1(r.cards)} | ${f0(r.score)} | ${f0(r.runMin)} | ${f0(r.playMin)} | ${f0(r.minAt1x)} | ${f0(pct(r.bestSeeds, sweep.seeds))} |`,
    );
  }
  lines.push('');
  lines.push('## Founding success and wins by planet type');
  lines.push('');
  lines.push(
    'Each cell: founding successes / attempts, then wins / runs whose first colony was on that type.',
  );
  lines.push('');
  lines.push(`| Archetype | ${TYPE_NAMES.join(' | ')} |`);
  lines.push(`| --- |${TYPE_NAMES.map(() => ' ---:').join(' |')} |`);
  for (const r of rows) {
    lines.push(
      `| ${r.name} | ${TYPE_NAMES.map((_, t) => `${r.okByType[t]}/${r.attemptsByType[t]}, ${r.winsByType[t]}/${r.runsByType[t]}`).join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push('## Band checks');
  lines.push('');
  for (const c of checks) lines.push(`- ${c.ok ? 'PASS' : 'MISS'} ${c.id}: ${c.detail}`);
  lines.push('');
  return lines.join('\n');
}
