// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  colonistsFactorPct,
  foundingChanceOf,
  foundingKitPct,
  nativesFoundingPct,
  siteQualityPct,
} from '../src/shared/planetfall';
import { createWorld } from '../src/sim/world';
import { newBotStats, playBot } from './helpers/bot';

/** Founding chance of a typical landing: an Explored survey (level 3) and a site score of 50 (docs/BALANCE.md). */
function chance(o: {
  hab: number;
  colonists: number;
  supplies: number;
  kit: number;
  disp?: number;
  guards?: number;
}): number {
  return foundingChanceOf(
    o.hab,
    siteQualityPct(50, 3),
    o.supplies,
    colonistsFactorPct(o.colonists),
    nativesFoundingPct(o.disp ?? 0, false, o.guards ?? 0),
    foundingKitPct(o.kit),
    0,
  );
}

describe('balance report: founding chance by archetype (docs/BALANCE.md, M5 review 2 retune)', () => {
  it('Ark, Scout, Gambler and Armed landing', () => {
    const ark = chance({ hab: 75, colonists: 400, supplies: 100, kit: 6 });
    const scout = chance({ hab: 60, colonists: 100, supplies: 80, kit: 0 });
    const gambler = chance({ hab: 50, colonists: 100, supplies: 50, kit: 0 });
    const armed = chance({ hab: 70, colonists: 200, supplies: 100, kit: 4, disp: 3, guards: 10 });
    expect([ark, scout, gambler, armed]).toEqual([62, 26, 13, 41]);
  });
});

describe('balance report: scripted bot over seeds', () => {
  // outcome 1 = Won, 2 = LostHomeworld (RunOutcome). Literal record; re-record on purpose when numbers change.
  const EXPECTED: [number, number, number, number, string][] = [
    // seed, outcome, day, colonies, top populations (re-recorded for M7c, D-136)
    [1, 2, 8000, 1, '2200'],
    [2, 2, 8000, 3, '2200/2200/2200'],
    [3, 2, 8000, 5, '2200/2200/2200'],
    [5, 2, 8000, 6, '2200/2200/2200'],
    [7, 2, 8000, 1, '2200'],
    [11, 2, 8000, 0, ''],
    [42, 2, 8000, 3, '2200/2200/2200'],
  ];
  it('wins none of seven seeds under the M7c win rule (10 colonies of 2600 for 90 days, clock 8000; the archetype bots do win, see balanceHarness)', () => {
    const got = EXPECTED.map(([seed]) => {
      const r = playBot(createWorld(seed), newBotStats(), 9000);
      return [seed, r.outcome, r.days, r.colonies, r.topPops.join('/')];
    });
    expect(got).toEqual(EXPECTED);
  }, 120_000);
});
