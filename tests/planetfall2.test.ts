// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PLANETFALL } from '../src/data';
import {
  colonistsFactorPct,
  ExpeditionStatus,
  FoundTier,
  foundingChanceOf,
  foundingChancePct,
  foundingTier,
  FR_SURVIVORS,
  LR_CHANCE,
  LR_KIND,
  LR_RESULT,
  LR_ROLL,
  nativesFoundingPct,
  siteScore,
  supplyFactorPct,
  LR_FIND,
} from '../src/shared/planetfall';
import { getLoggedCommand, replayLogged } from '../src/sim/commands';
import { G_LOG, MAX_EVENT_DEFS } from '../src/sim/components';
import { hashState } from '../src/sim/hash';
import { tickDay } from '../src/sim/tick';
import {
  answerCards,
  arrivedShip,
  explore,
  finishRound,
  form,
  found,
  rollRecord,
  send,
  type Landing,
} from './helpers/planetfall';

describe('founding factors: habitability x site x supplies x colonists x natives x kit', () => {
  it('supplies factor: days of food left against the 30 day reserve, capped at 100', () => {
    // 3000 supplies for 100 colonists = 30 days; 1500 = 15 days = 50 percent.
    expect([0, 1500, 3000, 9000].map((s) => supplyFactorPct(s, 100))).toEqual([0, 50, 100, 100]);
    expect(supplyFactorPct(5, 0)).toBe(100); // nobody to feed
  });

  it('colonists factor: 40 for a handful, 100 from 400 colonists', () => {
    expect([0, 100, 200, 400, 1000].map(colonistsFactorPct)).toEqual([
      PLANETFALL.founding.colonistsMinPct,
      PLANETFALL.founding.colonistsMinPct +
        Math.floor(((100 - PLANETFALL.founding.colonistsMinPct) * 100) / 400),
      PLANETFALL.founding.colonistsMinPct +
        Math.floor(((100 - PLANETFALL.founding.colonistsMinPct) * 200) / 400),
      100,
      100,
    ]);
  });

  it('natives factor table', () => {
    const n = PLANETFALL.founding.nativesPct;
    expect(nativesFoundingPct(0, false, 0)).toBe(100);
    expect(nativesFoundingPct(1, false, 0)).toBe(n[1]);
    expect(nativesFoundingPct(3, false, 0)).toBe(n[3]);
    expect(nativesFoundingPct(3, true, 0)).toBeLessThan(n[3]);
    // Security helps against Hostile natives, up to the cap.
    expect(nativesFoundingPct(3, false, 4)).toBeGreaterThan(n[3]);
    expect(nativesFoundingPct(3, false, 99)).toBeLessThanOrEqual(100);
  });

  it('chance is the floored product, capped at 100, with the research bonus on top', () => {
    expect(foundingChanceOf(80, 76, 100, 100, 100, 94, 0)).toBe(57);
    expect(foundingChanceOf(100, 100, 100, 100, 100, 100, 0)).toBe(100);
    expect(foundingChanceOf(100, 100, 100, 100, 100, 100, 50)).toBe(100);
    expect(foundingChanceOf(50, 50, 100, 100, 100, 100, 20)).toBe(30);
    expect(
      foundingChancePct({
        habitability: 80,
        site: 76,
        supplies: 100,
        colonists: 100,
        natives: 100,
        kit: 94,
        research: 0,
      }),
    ).toBe(57);
  });

  it('tiers: Thriving below 60% of the chance, Struggling below the chance, otherwise Failed', () => {
    // Chance 20: Thriving below 12.
    expect([0, 11, 12, 19, 20, 99].map((r) => foundingTier(r, 20))).toEqual([2, 2, 1, 1, 0, 0]);
    expect(foundingTier(0, 0)).toBe(FoundTier.Failed);
    expect(foundingTier(99, 100)).toBe(FoundTier.Struggling);
  });

  it('site score blends the find with the explored share', () => {
    expect(siteScore(-1, 0, 14)).toBeLessThan(siteScore(-1, 14, 14));
  });
});

describe('FoundColony in the sim: Thriving, Struggling, Failed', () => {
  // Fixed landings (world seed -> dice): 100 explorers, 8000 supplies, kit 8, found at the landing zone.
  const setup = (seed: number): { L: Landing; e: number } => {
    const L = arrivedShip(seed, { kit: 8 });
    const e = form(L, { explorers: 100, supplies: 8000, kit: 8 });
    return { L, e };
  };

  it('seed 3 is Thriving: chance 64, roll 12; the colony is founded with all 400 colonists', () => {
    const { L, e } = setup(3);
    const s = L.w.stores;
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    expect([r[LR_KIND], r[LR_CHANCE], r[LR_ROLL], r[LR_RESULT], r[FR_SURVIVORS]]).toEqual([
      2,
      64,
      12,
      FoundTier.Thriving,
      400,
    ]);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Founded);
    expect(s.planet.owner[L.planet]).toBeGreaterThanOrEqual(0);
    expect(s.shipManifest.colonists[L.ship]).toBe(0);
  });

  it('seed 7 is Struggling: chance 64, roll 61; founded, with a penalty period', () => {
    const { L, e } = setup(7);
    const s = L.w.stores;
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    expect([r[LR_CHANCE], r[LR_ROLL], r[LR_RESULT], r[FR_SURVIVORS]]).toEqual([
      64,
      61,
      FoundTier.Struggling,
      400,
    ]);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Founded);
    const colony = s.planet.owner[L.planet];
    expect(s.colony.tier[colony]).toBe(FoundTier.Struggling);
    expect(s.colony.penaltyDays[colony]).toBe(PLANETFALL.founding.strugglingPenaltyDays);
  });

  it('seed 5 with no survey kit is Failed: chance 59, roll 63; half the landed party dies and the survivors are stranded', () => {
    const L = arrivedShip(5, { kit: 8 });
    const e = form(L, { explorers: 100, supplies: 8000, kit: 0 });
    const s = L.w.stores;
    expect(found(L.w, e, L.lz)).toEqual({ ok: true });
    const r = rollRecord(L.w, e);
    expect([r[LR_CHANCE], r[LR_ROLL], r[LR_RESULT], r[FR_SURVIVORS]]).toEqual([
      59,
      63,
      FoundTier.Failed,
      50,
    ]);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Stranded);
    expect(s.planet.owner[L.planet]).toBe(-1);
    expect(s.shipManifest.colonists[L.ship]).toBe(300);
    // A failed expedition can re-embark, and the survivors are counted back aboard.
    expect(send(L.w, { type: 'ReEmbark', expedition: e })).toEqual({ ok: true });
    expect(s.shipManifest.colonists[L.ship]).toBe(350);
    expect(send(L.w, { type: 'ReEmbark', expedition: e })).toEqual({
      ok: false,
      reason: 'EXPEDITION_NOT_ACTIVE',
    });
    expect(found(L.w, e, L.lz)).toEqual({ ok: false, reason: 'EXPEDITION_NOT_ACTIVE' });
  });

  it('ReEmbark of an idle expedition returns the explorers and the supplies left to the ship', () => {
    const { L, e } = setup(3);
    const s = L.w.stores;
    const colonistsBefore = s.shipManifest.colonists[L.ship];
    const suppliesBefore = s.shipManifest.supplies[L.ship];
    expect(send(L.w, { type: 'ReEmbark', expedition: e })).toEqual({ ok: true });
    expect(s.shipManifest.colonists[L.ship]).toBe(colonistsBefore + 100);
    expect(s.shipManifest.supplies[L.ship]).toBe(suppliesBefore + 8000);
  });

  it('FoundColony refusals', () => {
    const { L, e } = setup(3);
    expect(found(L.w, 99, 0)).toEqual({ ok: false, reason: 'NO_SUCH_EXPEDITION' });
    expect(found(L.w, e, 99)).toEqual({ ok: false, reason: 'INVALID_REGION' });
    expect(found(L.w, e, (L.lz + 7) % 14 === L.lz ? 0 : (L.lz + 7) % 14)).toMatchObject({
      ok: false,
    });
  });
});

// ---- A scripted full run: land, explore, answer cards, found, re-embark --------------------------

const RUN_DAYS = 160;

function decide(L: Landing, e: number, done: { founded: boolean }): void {
  const w = L.w;
  const s = w.stores;
  answerCards(w, 0);
  if (s.expedition.status[e] !== ExpeditionStatus.Active || done.founded) return;
  const n = s.planet.regionCount[L.planet];
  let explored = 0;
  let next = -1;
  for (let i = 0; i < n; i++) {
    const fog = s.region.fog[L.base + i];
    if (fog === 3) explored++;
    else if (fog === 1 && next < 0) next = i;
  }
  if (explored >= 4 || next < 0) {
    if (found(w, e, L.lz).ok) done.founded = true;
    return;
  }
  explore(w, e, next);
}

function liveRun(): { L: Landing; hashes: number[]; e: number } {
  const L = arrivedShip(4, { kit: 8 });
  const e = form(L, { explorers: 60, supplies: 6000, kit: 8, stance: 1 });
  const done = { founded: false };
  const hashes: number[] = [];
  for (let d = 0; d < RUN_DAYS; d++) {
    decide(L, e, done);
    tickDay(L.w);
    hashes.push(L.w.stores.run.stateHash[0]);
  }
  return { L, hashes, e };
}

describe('a scripted full run: land, explore, found, with replay', () => {
  it('two live runs give the same hash on every day', () => {
    const a = liveRun();
    const b = liveRun();
    expect(a.hashes).toEqual(b.hashes);
  });

  it('the run really lands, explores several regions and founds a colony', () => {
    const { L, e } = liveRun();
    const s = L.w.stores;
    let explored = 0;
    for (let i = 0; i < s.planet.regionCount[L.planet]; i++)
      if (s.region.fog[L.base + i] === 3) explored++;
    expect(explored).toBeGreaterThanOrEqual(4);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Founded);
    expect(rollRecord(L.w, e)[LR_KIND]).toBe(2);
    expect(s.planet.owner[L.planet]).toBeGreaterThanOrEqual(0);
  });

  it('replaying the log from the same landing reproduces every daily hash', () => {
    const live = liveRun();
    const L = arrivedShip(4, { kit: 8 });
    const src = live.L.w.stores;
    const n = src.counts[G_LOG];
    let next = 0;
    // Skip log entries from before the landing replay starts (none: setup was direct).
    const hashes: number[] = [];
    for (let d = 0; d < RUN_DAYS; d++) {
      while (next < n && src.log.day[next] === L.w.stores.run.day[0])
        replayLogged(L.w, src, next++);
      tickDay(L.w);
      hashes.push(L.w.stores.run.stateHash[0]);
    }
    expect(next).toBe(n);
    expect(hashes).toEqual(live.hashes);
    const types = new Set<number>();
    for (let i = 0; i < n; i++) types.add(src.log.type[i]);
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(getLoggedCommand(src, 0).type).toBe('FormExpedition');
  });

  it('matches the recorded golden hash after the run', () => {
    expect(liveRun().L.w.stores.run.stateHash[0]).toBe(GOLDEN_FULL_RUN);
  });
});

const GOLDEN_FULL_RUN = 1922861025; // M7c re-record (D-136, SIM_VERSION 5): clock 8000, win 10 colonies; earlier: M7a re-record (D-132, SIM_VERSION 3): 30 cards, native variants, find tables; earlier: M5 review 2 (D-107 to D-111, SIM_VERSION 2); earlier M5 (D-098) and D-101

describe('the state hash covers the planetfall stores', () => {
  it('flipping one value of each new store changes the hash', () => {
    const L = arrivedShip(4, { kit: 8 });
    const s = L.w.stores;
    const e = form(L, { explorers: 60, supplies: 3000, kit: 8 });
    explore(L.w, e, 0);
    finishRound(L.w, e);
    answerCards(L.w, 0);
    const reg = L.base + 2;
    const cases: [string, { [i: number]: number }, number][] = [
      ['region.fog', s.region.fog, reg],
      ['region.find', s.region.find, reg],
      ['native.shift', s.native.shift, L.planet],
      ['native.revealed', s.native.revealed, L.planet],
      ['expedition.region', s.expedition.region, e],
      ['expedition.round', s.expedition.round, e],
      ['expedition.ship', s.expedition.ship, e],
      ['expedition.planet', s.expedition.planet, e],
      ['expeditionStance.stance', s.expeditionStance.stance, e],
      ['expedition.status', s.expedition.status, e],
      ['expedition.target', s.expedition.target, e],
      ['expedition.target2', s.expedition.target2, e],
      ['expedition.roundDay', s.expedition.roundDay, e],
      ['expedition.roundLen', s.expedition.roundLen, e],
      ['expedition.delay', s.expedition.delay, e],
      ['expedition.landedDay', s.expedition.landedDay, e],
      ['expeditionTeam.wounded', s.expeditionTeam.wounded, e],
      ['expeditionTeam.supplies', s.expeditionTeam.supplies, e],
      ['expeditionTeam.explorers', s.expeditionTeam.explorers, e],
      ['expeditionRoll.rec', s.expeditionRoll.rec, e * 48 + 5],
      ['colony.tier', s.colony.tier, 1],
      ['colony.penaltyDays', s.colony.penaltyDays, 1],
      ['colony.site', s.colony.site, 1],
    ];
    expect(MAX_EVENT_DEFS).toBeGreaterThan(0);
    for (const [name, arr, idx] of cases) {
      const before = hashState(s);
      const old = arr[idx];
      arr[idx] = old + 1;
      const after = hashState(s);
      arr[idx] = old;
      expect(after, name).not.toBe(before);
      expect(hashState(s), name).toBe(before);
    }
    expect(LR_FIND).toBe(14);
  });
});
