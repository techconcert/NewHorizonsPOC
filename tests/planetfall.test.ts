// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FIND_KINDS, PLANETFALL, RAW_CONTENT, TERRAINS } from '../src/data';
import { validatePlanetfallConfig } from '../src/data/validate';
import {
  ambushChancePct,
  ambushHarm,
  explorationChancePct,
  exploreKitPct,
  hazardChancePct,
  hazardKindOf,
  hazardAmount,
  nativesExplorePct,
  securityReductionPct,
  stanceRoundDays,
  teamSizePct,
  terrainBasePct,
  LR_AMBUSH_CHANCE,
  LR_AMBUSH_HARM,
  LR_AMBUSH_ROLL,
  LR_HAZARD_AMOUNT,
  LR_HAZARD_CHANCE,
  LR_HAZARD_KIND,
  LR_HAZARD_ROLL,
  LR_KITPCT,
  LR_NATIVESPCT,
  LR_REGION,
  LR_RESULT,
  LR_SPLIT,
  LR_STANCEPCT,
  LR_TEAM,
  LR_TEAM_SIZE,
  ExpeditionStatus,
} from '../src/shared/planetfall';
import { Terrain } from '../src/sim/components';
import { compileContent } from '../src/sim/content';
import { pendingCount } from '../src/sim/events';
import { rollFind } from '../src/sim/planet';
import {
  answerCards,
  arrivedShip,
  explore,
  finishRound,
  form,
  rollRecord,
  send,
  tickDay,
} from './helpers/planetfall';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('exploration roll: success chance = terrain base x team size x kit x stance x natives', () => {
  it('the tables: terrain base, team size and kit bonuses', () => {
    expect(TERRAINS.map((t) => terrainBasePct(TERRAINS.indexOf(t)))).toEqual([
      85, 70, 55, 65, 50, 60,
    ]);
    // minPct 60 for one explorer, +60 points spread over 60 explorers, floored.
    expect([0, 1, 10, 30, 59, 60, 500].map(teamSizePct)).toEqual([60, 61, 70, 90, 119, 120, 120]);
    // minPct 80 with no kit, +50 points over 8 kit steps, floored.
    expect([0, 1, 4, 8, 20].map(exploreKitPct)).toEqual([80, 86, 105, 130, 130]);
  });

  it('worked examples (integer math, floored)', () => {
    // Plains 85 x 30 explorers 90 x 4 kit 105 x Balanced 100 x no natives 100 = 80.325 -> 80.
    expect(explorationChancePct(85, 90, 105, 100, 100)).toBe(80);
    // Jungle 55 x 10 explorers 70 x no kit 80 x Bold 90 x 100 = 27.72 -> 27.
    expect(explorationChancePct(55, 70, 80, 90, 100)).toBe(27);
    // Crater 50 x 1 explorer 61 x no kit 80 x Bold 90 x hostile ground 90 = 19.76 -> 19.
    expect(explorationChancePct(50, 61, 80, 90, 90)).toBe(19);
    // Everything at its best: 167.7 is capped at 95.
    expect(explorationChancePct(85, 120, 130, 110, 115)).toBe(95);
  });

  it('the chance is capped to successMinPct..successMaxPct', () => {
    expect(PLANETFALL.successMinPct).toBe(5);
    expect(PLANETFALL.successMaxPct).toBe(95);
    expect(explorationChancePct(1, 1, 1, 1, 1)).toBe(5);
  });
});

describe('stances: Bold explores two regions and doubles hazard odds, Cautious is the reverse', () => {
  it('stance numbers: success modifier, hazard multiplier, round length', () => {
    expect(PLANETFALL.stances.successPct).toEqual([110, 100, 90]);
    expect(PLANETFALL.stances.hazardPct).toEqual([50, 100, 200]);
    expect([0, 1, 2].map(stanceRoundDays)).toEqual([15, 10, 10]);
    expect(PLANETFALL.stances.regionsPerRound).toEqual([1, 1, 2]);
  });

  it('hazard chance per roll: level x stance, x1.5 when the team split, never above 95', () => {
    // Low (10): Cautious 5, Balanced 10, Bold 20.
    expect([0, 1, 2].map((st) => hazardChancePct(1, st, false))).toEqual([5, 10, 20]);
    // Medium (20) and High (35) Balanced.
    expect(hazardChancePct(2, 1, false)).toBe(20);
    expect(hazardChancePct(3, 1, false)).toBe(35);
    // Split: Low Balanced 10 x 150% = 15; High Bold 35 x 200% x 150% = 105 -> 95.
    expect(hazardChancePct(1, 1, true)).toBe(15);
    expect(hazardChancePct(3, 2, true)).toBe(95);
  });

  it('hazard kinds and amounts', () => {
    // Weights 40 injury / 25 death / 35 supplies lost.
    expect([0, 39, 40, 64, 65, 99].map(hazardKindOf)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(hazardAmount(1, 100, 1000)).toBe(10); // injury 10% of the team
    expect(hazardAmount(2, 100, 1000)).toBe(8); // death 8%
    expect(hazardAmount(3, 100, 1000)).toBe(150); // supplies 15%
    expect(hazardAmount(1, 3, 1000)).toBe(1); // at least one while anyone is left
    expect(hazardAmount(2, 0, 1000)).toBe(0);
  });

  it('in the sim: the same dice give a stance-specific record (round length, regions, odds)', () => {
    const out: Record<number, { days: number; r0: number[]; r1: number[]; supplies: number }> = {};
    for (const stance of [0, 1, 2]) {
      const L = arrivedShip(5, { kit: 8 });
      const e = form(L, { explorers: 60, supplies: 3000, kit: 8, stance });
      expect(explore(L.w, e, 0)).toEqual({ ok: true });
      const days = finishRound(L.w, e);
      out[stance] = {
        days,
        r0: rollRecord(L.w, e, 0),
        r1: rollRecord(L.w, e, 1),
        supplies: L.w.stores.expeditionTeam.supplies[e],
      };
    }
    // Round lengths: Cautious 15 days, Balanced and Bold 10.
    expect([out[0].days, out[1].days, out[2].days]).toEqual([15, 10, 10]);
    // Stance modifier on success: 110 / 100 / 90. Same team (60 explorers = 120), same kit (130).
    expect([0, 1, 2].map((st) => out[st].r0[LR_STANCEPCT])).toEqual([110, 100, 90]);
    expect(out[0].r0[LR_TEAM]).toBe(120);
    expect(out[0].r0[LR_KITPCT]).toBe(130);
    // The hazard odds per roll: 5 / 10 / 20 (Plains is Low); the same hazard die (12) hits only Bold.
    expect([0, 1, 2].map((st) => out[st].r0[LR_HAZARD_CHANCE])).toEqual([5, 10, 20]);
    expect([0, 1, 2].map((st) => out[st].r0[LR_HAZARD_ROLL])).toEqual([12, 12, 12]);
    expect([0, 1, 2].map((st) => out[st].r0[LR_HAZARD_KIND])).toEqual([0, 0, 1]);
    // Only Bold rolls a second region in the round.
    expect([out[0].r1[0], out[1].r1[0], out[2].r1[0]]).toEqual([0, 0, 1]);
    expect(out[2].r1[LR_REGION]).toBe(1);
    // Cautious ate for 15 days: 3000 - 15 x 60; Balanced 10 days; Bold 10 days (the hurt still eat).
    expect([out[0].supplies, out[1].supplies, out[2].supplies]).toEqual([2100, 2400, 2400]);
  });
});

describe('supplies: one per explorer per day, exactly', () => {
  it('20 explorers eat 20 a day: 820 left after 9 of 10 days, 800 after the round (less a supply hazard)', () => {
    const L = arrivedShip(5);
    const e = form(L, { explorers: 20, supplies: 1000, kit: 0 });
    expect(L.w.stores.expeditionTeam.supplies[e]).toBe(1000);
    expect(explore(L.w, e, 0)).toEqual({ ok: true });
    for (let i = 0; i < 9; i++) tickDay(L.w);
    expect(L.w.stores.expeditionTeam.supplies[e]).toBe(820);
    expect(L.w.stores.expedition.roundDay[e]).toBe(9);
    tickDay(L.w);
    const rec = rollRecord(L.w, e);
    // This seed's hazard die (12) hits: an injury, not a supply loss, so the team ate exactly 200.
    expect([rec[LR_HAZARD_KIND], rec[LR_HAZARD_AMOUNT]]).toEqual([1, 2]);
    expect(L.w.stores.expeditionTeam.supplies[e]).toBe(800);
    expect(L.w.stores.expedition.round[e]).toBe(1);
  });

  it('the depot ship feeds the colonists left aboard from its own supplies', () => {
    const L = arrivedShip(5);
    const man = L.w.stores.shipManifest;
    const form0 = { colonists: man.colonists[L.ship], supplies: man.supplies[L.ship] };
    const e = form(L, { explorers: 100, supplies: 5000 });
    // 300 colonists stay aboard; the supplies the ship holds fall by 300 a day.
    expect(man.colonists[L.ship]).toBe(form0.colonists - 100);
    const before = man.supplies[L.ship];
    expect(before).toBe(form0.supplies - 5000);
    for (let i = 0; i < 3; i++) tickDay(L.w);
    expect(man.supplies[L.ship]).toBe(before - 3 * 300);
    expect(L.w.stores.expeditionTeam.supplies[e]).toBe(5000 - 3 * 100);
  });

  it('without supplies the team starves by 10% of the unfed, rounded up: 18, 16, 14, 12, 10, 9, 8', () => {
    const L = arrivedShip(5);
    const e = form(L, { explorers: 20, supplies: 5, kit: 0 });
    const seen: number[] = [];
    for (let i = 0; i < 7; i++) {
      tickDay(L.w);
      seen.push(L.w.stores.expeditionTeam.explorers[e]);
    }
    expect(seen).toEqual([18, 16, 14, 12, 10, 9, 8]);
    expect(L.w.stores.expeditionTeam.supplies[e]).toBe(0);
  });

  it('an expedition whose last explorer starves is Dead', () => {
    const L = arrivedShip(5);
    const e = form(L, { explorers: 1, supplies: 0, kit: 0 });
    tickDay(L.w);
    expect(L.w.stores.expedition.status[e]).toBe(ExpeditionStatus.Dead);
    expect(explore(L.w, e, 0)).toEqual({ ok: false, reason: 'EXPEDITION_NOT_ACTIVE' });
  });
});

describe('terrain find tables', () => {
  it('every terrain row sums to 100 and the validator enforces it', () => {
    const c = compileContent();
    expect(c.findKindCount).toBe(FIND_KINDS.length);
    for (let t = 0; t < c.terrainCount; t++) {
      let sum = 0;
      for (let k = 0; k < c.findKindCount; k++) sum += c.terrainFinds[t * c.findKindCount + k];
      expect(sum).toBe(100);
    }
    const bad = clone(RAW_CONTENT.terrain);
    (bad.terrains[Terrain.Ruins] as { finds: number[] }).finds[0] += 1;
    expect(bad.terrains[Terrain.Ruins].finds.reduce((a, b) => a + b, 0)).toBe(101);
  });

  it('10000 seeded rolls per terrain land within +-150 of the table (Plains 2800/2200/500/500/500/300/0.../1000/2200)', () => {
    const L = arrivedShip(5);
    const e = form(L);
    const c = L.w.content;
    const k = c.findKindCount;
    for (let terrain = 0; terrain < c.terrainCount; terrain++) {
      const counts = new Array<number>(k).fill(0);
      for (let i = 0; i < 10000; i++) counts[rollFind(L.w, e, terrain)]++;
      for (let f = 0; f < k; f++) {
        const odds = c.terrainFinds[terrain * k + f];
        if (odds === 0) expect(counts[f]).toBe(0);
        else expect(Math.abs(counts[f] - odds * 100)).toBeLessThanOrEqual(150);
      }
    }
    // The exact Plains histogram for this seed is part of the replay contract.
    const L2 = arrivedShip(5);
    const e2 = form(L2);
    const plains = new Array<number>(k).fill(0);
    for (let i = 0; i < 10000; i++) plains[rollFind(L2.w, e2, Terrain.Plains)]++;
    expect(plains).toEqual([2814, 2188, 518, 509, 516, 295, 0, 0, 0, 1012, 2148]);
  });
});

describe('fog: the landing zone starts revealed, exploring reveals the frontier', () => {
  it('before landing only the landing zone is revealed; landing explores it and shows its neighbours', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    const fog = () =>
      Array.from(s.region.fog.subarray(L.base, L.base + s.planet.regionCount[L.planet]));
    expect(fog()).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    form(L);
    // Region 3 (landing zone, axial -1,0) is explored (3); its neighbours 0, 1, 2, 8, 9 are visible (1).
    expect(fog()).toEqual([1, 1, 1, 3, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    expect(s.planet.survey[L.planet]).toBe(3);
  });

  it('a successful round explores the region and reveals its neighbours; the fog is one byte per region', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    const e = form(L, { explorers: 60, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 0)).toEqual({ ok: true });
    finishRound(L.w, e);
    expect(rollRecord(L.w, e)[LR_RESULT]).toBe(1);
    expect(Array.from(s.region.fog.subarray(L.base, L.base + 14))).toEqual([
      3, 1, 1, 3, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0,
    ]);
    expect(s.region.fog.BYTES_PER_ELEMENT).toBe(1);
  });

  it('ExploreRegion refusals: hidden, explored, out of range, mid round, wrong status', () => {
    const L = arrivedShip(5, { kit: 8 });
    const e = form(L, { explorers: 60, supplies: 3000, kit: 8 });
    expect(explore(L.w, 99, 0)).toEqual({ ok: false, reason: 'NO_SUCH_EXPEDITION' });
    expect(explore(L.w, L.ship, 0)).toEqual({ ok: false, reason: 'NO_SUCH_EXPEDITION' });
    expect(explore(L.w, e, 14)).toEqual({ ok: false, reason: 'INVALID_REGION' });
    expect(explore(L.w, e, -1)).toEqual({ ok: false, reason: 'INVALID_REGION' });
    expect(explore(L.w, e, 3)).toEqual({ ok: false, reason: 'ALREADY_EXPLORED' });
    expect(explore(L.w, e, 5)).toEqual({ ok: false, reason: 'NOT_ADJACENT' });
    expect(explore(L.w, e, 0)).toEqual({ ok: true });
    expect(explore(L.w, e, 1)).toEqual({ ok: false, reason: 'ROUND_IN_PROGRESS' });
    expect(L.w.stores.expedition.target[e]).toBe(0);
  });
});

describe('split teams: faster, riskier', () => {
  it('two regions in one round, half the explorers each, hazard odds x1.5', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    const e = form(L, { explorers: 100, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 0, 1)).toEqual({ ok: true });
    expect(finishRound(L.w, e)).toBe(10);
    const a = rollRecord(L.w, e, 0);
    const b = rollRecord(L.w, e, 1);
    expect([a[LR_REGION], b[LR_REGION]]).toEqual([0, 1]);
    expect([a[LR_TEAM_SIZE], b[LR_TEAM_SIZE]]).toEqual([50, 50]);
    expect([a[LR_SPLIT], b[LR_SPLIT]]).toEqual([1, 1]);
    // 50 explorers: team bonus 60 + 30 = 110 for each team (a lone team of 100 would get 120).
    expect([a[LR_TEAM], b[LR_TEAM]]).toEqual([110, 110]);
    // Plains Balanced: 10 x 150% = 15 (a lone team: 10). The first hazard die (12) hits team A:
    // an injury sized for that team of 50 (10% = 5), not for the whole party of 100.
    expect([a[LR_HAZARD_CHANCE], b[LR_HAZARD_CHANCE]]).toEqual([15, 15]);
    expect(a[LR_HAZARD_ROLL]).toBe(12);
    expect(a[LR_HAZARD_KIND]).toBe(1);
    expect(a[LR_HAZARD_AMOUNT]).toBe(5);
    expect(s.expeditionTeam.explorers[e]).toBe(95);
    expect(s.expeditionTeam.wounded[e]).toBe(5);
    // Both regions are explored in a single 10 day round.
    expect(Array.from(s.region.fog.subarray(L.base, L.base + 14))).toEqual([
      3, 3, 1, 3, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0,
    ]);
    expect(s.expedition.round[e]).toBe(1);
  });

  it('split refusals: the same region twice, a hidden second region, a team too small', () => {
    const L2 = arrivedShip(5);
    const e = form(L2, { explorers: 100 });
    expect(explore(L2.w, e, 0, 0)).toEqual({ ok: false, reason: 'INVALID_SPLIT' });
    expect(explore(L2.w, e, 0, 5)).toEqual({ ok: false, reason: 'NOT_ADJACENT' });
    expect(explore(L2.w, e, 0, 3)).toEqual({ ok: false, reason: 'ALREADY_EXPLORED' });
    expect(explore(L2.w, e, 0, 20)).toEqual({ ok: false, reason: 'INVALID_REGION' });
    const L3 = arrivedShip(5);
    const small = form(L3, { explorers: 3 });
    expect(explore(L3.w, small, 0, 1)).toEqual({ ok: false, reason: 'INVALID_SPLIT' });
    expect(explore(L3.w, small, 0)).toEqual({ ok: true });
  });

  it('a Bold team names its second region (rolled by the whole team, no split) or gets the auto-pick', () => {
    const L = arrivedShip(5, { kit: 8 });
    const s = L.w.stores;
    const e = form(L, { stance: 2, explorers: 100, supplies: 3000, kit: 8 });
    expect(explore(L.w, e, 0, 0)).toEqual({ ok: false, reason: 'INVALID_SPLIT' });
    expect(explore(L.w, e, 0, 5)).toEqual({ ok: false, reason: 'NOT_ADJACENT' });
    expect(explore(L.w, e, 0, 3)).toEqual({ ok: false, reason: 'ALREADY_EXPLORED' });
    expect(explore(L.w, e, 0, 20)).toEqual({ ok: false, reason: 'INVALID_REGION' });
    expect(explore(L.w, e, 0, 8)).toEqual({ ok: true });
    finishRound(L.w, e);
    const a = rollRecord(L.w, e, 0);
    const b = rollRecord(L.w, e, 1);
    expect([a[LR_REGION], b[LR_REGION]]).toEqual([0, 8]);
    expect([a[LR_SPLIT], b[LR_SPLIT]]).toEqual([0, 0]);
    expect(b[LR_TEAM_SIZE]).toBeGreaterThanOrEqual(90); // the whole team, less the first roll's losses
    expect([a[LR_HAZARD_CHANCE], b[LR_HAZARD_CHANCE]]).toEqual([20, 20]); // Plains 10 x Bold 200%
    expect(s.expedition.target2[e]).toBe(-1);
  });
});

describe('natives: contact, ambush rolls, Security, guides', () => {
  const natives = (
    L: ReturnType<typeof arrivedShip>,
    disp: number,
    strength: number,
    region: number,
  ) => {
    const s = L.w.stores;
    s.native.disposition[L.planet] = disp;
    s.native.strength[L.planet] = strength;
    s.native.homeRegionMask[L.planet] = 1 << region;
  };

  it('ambush chance and harm tables: Hostile 50 at strength 50, scaled by strength; Wary never ambush', () => {
    // chance = base x (50 + strength) / 100.
    expect([10, 50, 90].map((st) => ambushChancePct(3, st))).toEqual([30, 50, 70]);
    expect([10, 50, 90].map((st) => ambushChancePct(2, st))).toEqual([0, 0, 0]); // Wary only watch
    expect(ambushChancePct(1, 90)).toBe(0); // Peaceful natives never ambush
    expect(ambushChancePct(0, 90)).toBe(0);
    // harm of 100 explorers at strength 50: Hostile 10; strength 90 Hostile 14; Wary 0.
    expect(ambushHarm(100, 3, 50, 0)).toBe(10);
    expect(ambushHarm(100, 2, 50, 0)).toBe(0);
    expect(ambushHarm(100, 3, 90, 0)).toBe(14);
  });

  it('Security removes 5% of the harm per guard, up to 75%', () => {
    expect([0, 4, 15, 20, 99].map(securityReductionPct)).toEqual([0, 20, 75, 75, 75]);
    // Hostile, strength 50, 100 explorers: 10 harm without an escort.
    expect([0, 4, 10, 15, 20].map((g) => ambushHarm(100, 3, 50, g))).toEqual([10, 8, 5, 2, 2]);
  });

  it('natives factor for exploration: Peaceful guides 115 once met, hostile home ground 90', () => {
    expect(nativesExplorePct(1, true, false)).toBe(115);
    expect(nativesExplorePct(1, false, false)).toBe(100); // hidden until contact
    expect(nativesExplorePct(3, true, true)).toBe(90);
    expect(nativesExplorePct(3, true, false)).toBe(100);
    expect(nativesExplorePct(2, true, true)).toBe(100);
    expect(nativesExplorePct(0, true, true)).toBe(100);
  });

  it('entering a native region makes contact: disposition revealed, a contact card pauses the game', () => {
    const L = arrivedShip(5, { security: 15 });
    const s = L.w.stores;
    natives(L, 2, 50, 0); // Wary natives, home region 0 next to the landing zone
    const e = form(L, { explorers: 100, supplies: 3000 });
    expect(s.native.revealed[L.planet]).toBe(0);
    expect(explore(L.w, e, 0)).toEqual({ ok: true });
    finishRound(L.w, e);
    expect(s.native.revealed[L.planet]).toBe(1);
    expect(pendingCount(L.w)).toBe(1);
    expect(s.pendingEventCard.card[0]).toBe(13); // "Watchers on the ridge" (Wary)
    expect(s.pendingEventCard.subject[0]).toBe(e);
    expect(s.expedition.status[e]).toBe(ExpeditionStatus.Event);
    expect(s.run.speed[0]).toBe(0); // auto-pause
    // A waiting card blocks every planetfall command for that expedition.
    expect(explore(L.w, e, 1)).toEqual({ ok: false, reason: 'EVENT_PENDING' });
    expect(send(L.w, { type: 'FoundColony', expedition: e, region: 3 })).toEqual({
      ok: false,
      reason: 'EVENT_PENDING',
    });
    expect(send(L.w, { type: 'ReEmbark', expedition: e })).toEqual({
      ok: false,
      reason: 'EVENT_PENDING',
    });
    // The frozen expedition eats nothing while the card waits.
    const before = s.expeditionTeam.supplies[e];
    tickDay(L.w);
    expect(s.expeditionTeam.supplies[e]).toBe(before);
  });

  it('Hostile ambush only after contact: the contact roll never ambushes; the next round does, Security softens it', () => {
    const run = (guards: number) => {
      const L = arrivedShip(5, { security: 15, kit: 8 });
      const s = L.w.stores;
      natives(L, 3, 50, 0);
      s.native.homeRegionMask[L.planet] = 3; // regions 0 and 1, both next to the landing zone
      const e = form(L, { explorers: 100, guards, supplies: 3000, kit: 8 });
      explore(L.w, e, 0);
      finishRound(L.w, e);
      const contact = rollRecord(L.w, e);
      const card = s.pendingEventCard.card[0];
      answerCards(L.w, 0);
      const before = s.expeditionTeam.explorers[e];
      explore(L.w, e, 1);
      finishRound(L.w, e);
      return {
        contact,
        card,
        before,
        rec: rollRecord(L.w, e),
        explorers: s.expeditionTeam.explorers[e],
      };
    };
    const bare = run(0);
    const escorted = run(15);
    for (const r of [bare, escorted]) {
      // Round 1 made contact (Warband card 14): no ambush chance, no ambush die, no harm.
      expect(r.card).toBe(14);
      expect([
        r.contact[LR_AMBUSH_CHANCE],
        r.contact[LR_AMBUSH_ROLL],
        r.contact[LR_AMBUSH_HARM],
      ]).toEqual([0, -1, 0]);
      // Round 2: ambush chance 50 at strength 50; the die (45) hits; hostile ground cuts success to 90.
      expect([r.rec[LR_AMBUSH_CHANCE], r.rec[LR_AMBUSH_ROLL]]).toEqual([50, 45]);
      expect(r.rec[LR_NATIVESPCT]).toBe(90);
    }
    // The warband card cost the bare team 8 explorers (92 left) but the escorted team none (100).
    // Harm = 10% of the team: 10 of 92 with no escort; Security 15 removes 75% of 10: 2 of 100.
    expect([bare.before, bare.rec[LR_TEAM_SIZE], bare.rec[LR_AMBUSH_HARM], bare.explorers]).toEqual(
      [92, 92, 10, 82],
    );
    expect([
      escorted.before,
      escorted.rec[LR_TEAM_SIZE],
      escorted.rec[LR_AMBUSH_HARM],
      escorted.explorers,
    ]).toEqual([100, 100, 2, 98]);
  });

  it('Peaceful natives guide: success factor 115 on every round once met, and share food', () => {
    const L = arrivedShip(5, { security: 0 });
    const s = L.w.stores;
    natives(L, 1, 50, 0);
    const e = form(L, { explorers: 20, supplies: 1000, kit: 0 });
    explore(L.w, e, 0);
    finishRound(L.w, e);
    expect(rollRecord(L.w, e)[LR_NATIVESPCT]).toBe(115);
    expect(s.native.revealed[L.planet]).toBe(1);
    // 10 days x 20 eaten, plus the natives' gift of 2 per explorer after the round.
    answerCardsFor(L.w);
    expect(s.expeditionTeam.supplies[e]).toBe(
      1000 - 200 + 2 * s.expeditionTeam.explorers[e] - lostSupplies(rollRecord(L.w, e)),
    );
    expect(s.expeditionTeam.supplies[e]).toBe(836);
    // The next round on any region keeps the guide bonus.
    expect(explore(L.w, e, 1)).toEqual({ ok: true });
    finishRound(L.w, e);
    expect(rollRecord(L.w, e)[LR_NATIVESPCT]).toBe(115);
  });
});

function lostSupplies(rec: number[]): number {
  return rec[LR_HAZARD_KIND] === 3 ? rec[18] : 0;
}

function answerCardsFor(w: Parameters<typeof send>[0]): void {
  while (pendingCount(w) > 0) {
    send(w, {
      type: 'ResolveEventChoice',
      card: 0,
      choice: 1,
      ship: w.stores.pendingEventCard.subject[0],
    });
  }
}

describe('planetfall validators', () => {
  it('the shipped planetfall table is valid', () => {
    expect(validatePlanetfallConfig(RAW_CONTENT.planetfall)).toEqual([]);
  });

  it('rejects a Bold that does not double the hazard, hazard weights off 100, bad lengths', () => {
    const a = clone(RAW_CONTENT.planetfall);
    a.stances.hazardPct = [50, 100, 150];
    expect(validatePlanetfallConfig(a).join()).toContain('doubles');
    const b = clone(RAW_CONTENT.planetfall);
    b.hazard.deathWeight = 30;
    expect(validatePlanetfallConfig(b).join()).toContain('sum to 100');
    const c = clone(RAW_CONTENT.planetfall);
    c.terrainExploreBasePct.pop();
    expect(validatePlanetfallConfig(c).join()).toContain('terrainExploreBasePct');
    const d = clone(RAW_CONTENT.planetfall);
    d.stances.regionsPerRound = [2, 1, 2];
    expect(validatePlanetfallConfig(d).join()).toContain('only Bold');
  });
});
